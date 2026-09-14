<script lang="ts">
import { untrack } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import {
	ANNOTATION_REASONS,
	type AnnotationDeflation,
	deflationByReason,
	describeTimelapse,
	effectiveIdleRanges,
	idleRecordedSeconds,
} from "#lib/annotations.js"
import type { IdleRange } from "#lib/idle-time.js"
import {
	createProject,
	DEFAULT_PROJECT_NAME,
	loadProjects,
	newProjectId,
	type Project,
	type ProjectStore,
	type ProjectTimelapse,
	saveProjects,
	uniqueProjectName,
} from "#lib/project-storage.js"
import { loadSelections, saveSelections } from "#lib/selection-storage.js"
import { decodeShare, encodeShare, type ShareState } from "#lib/share.js"
import {
	clamp,
	formatClock,
	formatHours,
	type TimelineSelection,
} from "#lib/timeline.js"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { getTimelapse } from "./api.remote.js"
import ProjectPane from "./ProjectPane.svelte"
import ReviewDetails from "./ReviewDetails.svelte"
import ReviewHeader from "./ReviewHeader.svelte"
import { entryFinalDuration } from "./review-format.js"
import TimelinePane from "./TimelinePane.svelte"
import VideoPane from "./VideoPane.svelte"

/** Canonical origin used when a summary links back to the review. */
const SITE_ORIGIN = "https://peaks.heliodex.cf"

/** Decode a path segment, falling back to the raw text when it is malformed. */
function decodePathParam(pathname: string): string {
	try {
		return decodeURIComponent(pathname.slice(1))
	} catch {
		return pathname.slice(1)
	}
}

/**
 * Encoded project state taken from the `/{state}` path (empty on the `/home`
 * landing). The open timelapse id is carried inside that state, so it no
 * longer needs to live in the URL separately. Shallow writes update
 * `page.shallow.url` rather than `page.url`, so prefer it when present.
 */
const routeParam = $derived(
	page.params.id !== undefined
		? decodePathParam((page.shallow?.url ?? page.url).pathname)
		: ""
)

/** Open timelapse id decoded from the path (empty on the `/home` landing). */
let submittedId = $state("")

let videoEl = $state<HTMLVideoElement>()
let selections = $state<TimelineSelection[]>([])
let idleRanges = $state<IdleRange[]>([])
let idleAnalyzing = $state(false)
// Whether `idleRanges` came from a completed scan or the project's cache.
let idleAnalyzed = $state(false)
// Bumped to request a fresh idle scan; negative means "use the cached ranges".
let idleRevision = $state(0)
// Encoded project state currently represented by the review. Kept as its own
// state (rather than read back from `page.url`) so the description always
// reflects what we encoded, even before the address bar catches up.
let encodedState = $state("")

// Pane sizes in pixels, driven by the drag handles on each pane's inner border.
// Each pane's minimum equals its default, so panes can only grow.
const DEFAULT_LEFT_WIDTH = 320
const DEFAULT_RIGHT_WIDTH = 288
const DEFAULT_TIMELINE_HEIGHT = 184
const MIN_CENTER_WIDTH = 320
const MIN_CENTER_HEIGHT = 200
let leftWidth = $state(DEFAULT_LEFT_WIDTH)
let rightWidth = $state(DEFAULT_RIGHT_WIDTH)
let timelineHeight = $state(DEFAULT_TIMELINE_HEIGHT)
// The bottom row only takes up space once a timeline is actually shown, so the
// landing page doesn't reserve an empty strip.
const timelineRowHeight = $derived(videoEl ? `${timelineHeight}px` : "0px")

/**
 * Run a window-level pointer drag, reporting the total movement from the
 * start. Tracking on the window keeps the resize alive when the pointer
 * leaves the narrow handle.
 */
function trackResize(
	event: PointerEvent,
	onMove: (dx: number, dy: number) => void,
	cursor: string
) {
	event.preventDefault()
	const startX = event.clientX
	const startY = event.clientY
	const previousCursor = document.body.style.cursor
	const previousUserSelect = document.body.style.userSelect
	document.body.style.cursor = cursor
	document.body.style.userSelect = "none"

	const handleMove = (moveEvent: PointerEvent) => {
		onMove(moveEvent.clientX - startX, moveEvent.clientY - startY)
	}
	const stop = () => {
		window.removeEventListener("pointermove", handleMove)
		window.removeEventListener("pointerup", stop)
		window.removeEventListener("pointercancel", stop)
		document.body.style.cursor = previousCursor
		document.body.style.userSelect = previousUserSelect
	}
	window.addEventListener("pointermove", handleMove)
	window.addEventListener("pointerup", stop)
	window.addEventListener("pointercancel", stop)
}

/** Drag the stats pane's right (inner) border. */
function startLeftResize(event: PointerEvent) {
	const start = leftWidth
	const max = Math.max(
		DEFAULT_LEFT_WIDTH,
		window.innerWidth - rightWidth - MIN_CENTER_WIDTH
	)
	trackResize(
		event,
		dx => {
			leftWidth = clamp(start + dx, DEFAULT_LEFT_WIDTH, max)
		},
		"col-resize"
	)
}

/** Drag the project pane's left (inner) border. */
function startRightResize(event: PointerEvent) {
	const start = rightWidth
	const max = Math.max(
		DEFAULT_RIGHT_WIDTH,
		window.innerWidth - leftWidth - MIN_CENTER_WIDTH
	)
	trackResize(
		event,
		dx => {
			rightWidth = clamp(start - dx, DEFAULT_RIGHT_WIDTH, max)
		},
		"col-resize"
	)
}

/** Drag the timeline's top (inner) border. */
function startTimelineResize(event: PointerEvent) {
	const start = timelineHeight
	const max = Math.max(
		DEFAULT_TIMELINE_HEIGHT,
		window.innerHeight - MIN_CENTER_HEIGHT - 120
	)
	trackResize(
		event,
		(_dx, dy) => {
			timelineHeight = clamp(start - dy, DEFAULT_TIMELINE_HEIGHT, max)
		},
		"row-resize"
	)
}

/** Shareable link for the current review: the encoded state is the path. */
const shareUrl = $derived(encodedState ? `${SITE_ORIGIN}/${encodedState}` : "")

// Every project lives in local storage; `currentProjectId` names the one open
// in the panel, which is also the only one mirrored into the URL.
let projects = $state<Project[]>([])
let currentProjectId = $state("")
let projectLoaded = $state(false)

/** The project currently open in the panel. */
const currentProject = $derived(
	projects.find(project => project.id === currentProjectId) ?? projects[0]
)
const projectName = $derived(currentProject?.name ?? DEFAULT_PROJECT_NAME)
const projectEntries = $derived(currentProject?.timelapses ?? [])

/** The project the panel is actually showing, and therefore editing. */
const activeProjectId = $derived(currentProject?.id ?? currentProjectId)

/**
 * Whether idle time is ignored for the open timelapse. It lives on the project
 * entry (the single source of truth for timelapse state), defaulting to off.
 */
const ignoreIdle = $derived(
	projectEntries.find(entry => entry.id === submittedId)?.ignoreIdle ?? false
)
// Metadata for the open timelapse, resolved from Lapse so it can be added to
// the project automatically. The id is kept alongside it so a late-resolving
// fetch can never be applied to a different timelapse.
let currentMeta = $state<{
	id: string
	name?: string
	duration: number
} | null>(null)

/** Whether two annotation breakdowns carry the same reasons and durations. */
function sameAnnotations(
	a: AnnotationDeflation[],
	b: AnnotationDeflation[]
): boolean {
	return (
		a.length === b.length &&
		a.every(
			(annotation, i) =>
				annotation.reason === b[i].reason &&
				annotation.duration === b[i].duration
		)
	)
}

/** Whether two cached idle-range lists match (including both being absent). */
function sameIdleRanges(
	a: IdleRange[] | undefined,
	b: IdleRange[] | undefined
): boolean {
	if (a === undefined || b === undefined) return a === b
	return (
		a.length === b.length &&
		a.every(
			(range, i) => range.start === b[i].start && range.end === b[i].end
		)
	)
}

/** Idle ranges that count towards the maths (none while overridden). */
const activeIdleRanges = $derived(effectiveIdleRanges(ignoreIdle, idleRanges))

/** Time removed from the actual duration as idle, in recorded seconds. */
const idleDuration = $derived(idleRecordedSeconds(activeIdleRanges))

// Guards against an older async encode resolving after a newer one.
let urlToken = 0
let urlTimer: ReturnType<typeof setTimeout> | undefined

// Load the state named by the path: it holds an encoded project state whose
// `openId` is the open timelapse. A path that doesn't decode is treated as
// stale or corrupt: the review stays closed and the URL sync rewrites the path
// from the locally stored project. Resets idle analysis because the underlying
// video changes.
let loadToken = 0
let loaded = $state(false)
$effect(() => {
	const param = routeParam
	// Our own shallow URL writes already match the in-memory review, so skip
	// decoding them (reading `encodedState` untracked keeps it from retriggering
	// this effect). Comparing against the *current* state — rather than a value
	// we wrote earlier — means a genuine navigation that happens to encode to
	// the same string still loads.
	if (param && param === untrack(() => encodedState)) return
	const token = ++loadToken
	loaded = false
	encodedState = ""
	idleRanges = []
	idleAnalyzing = false
	idleAnalyzed = false
	if (!param) {
		submittedId = ""
		selections = []
		loaded = true
		return
	}
	void decodeShare(param).then(decoded => {
		if (token !== loadToken) return
		if (decoded) {
			submittedId = decoded.openId
			encodedState = param
			selections = decoded.selections
			importSharedProject(decoded)
		} else {
			// Not an encoded project state. Leave the review closed rather than
			// latching onto the slug, and let the URL sync rewrite the path from
			// the locally stored project so a stale or corrupt link recovers.
			submittedId = ""
			selections = []
		}
		loaded = true
	})
})

/**
 * Seed the open timelapse's idle ranges from the project's cache when a scan
 * has run before, so reopening a timelapse doesn't re-analyze its video. A
 * negative revision tells the timeline to reuse the cache instead of scanning.
 */
let idleSeededFor = ""
$effect(() => {
	const id = submittedId
	if (!id) {
		idleSeededFor = ""
		return
	}
	if (idleSeededFor === id) return
	const entry = currentProject?.timelapses.find(item => item.id === id)
	idleSeededFor = id
	idleAnalyzed = false
	if (entry?.idleRanges) {
		idleRanges = entry.idleRanges.map(range => ({ ...range }))
		idleRevision = -1
	} else {
		idleRanges = []
		idleRevision = 0
	}
})

/**
 * Open a timelapse by id. The URL carries the project state, so encode the
 * current project with that timelapse open (using its saved selections) and
 * navigate to `/{state}` rather than a bare `/{id}`.
 */
async function loadId(value: string) {
	const id = value.trim()
	if (!id || id === submittedId) return
	// Add the timelapse to the open project straight away, so it shows up (and
	// travels in the encoded URL) even before its metadata resolves.
	const entries = $state.snapshot(projectEntries)
	if (!entries.some(entry => entry.id === id)) {
		entries.push(emptyTimelapse(id))
		updateCurrentProject(project => ({ ...project, timelapses: entries }))
		pendingAdds.add(id)
	}
	const encoded = await encodeShare({
		projectId: activeProjectId,
		selections: loadSelections(id),
		projectName,
		project: entries,
		openId: id,
	})
	// Drop any debounced write queued while we were encoding so it can't race
	// this explicit navigation to the new state.
	clearTimeout(urlTimer)
	void goto(`/${encoded}`)
}

/** A project entry for a timelapse whose metadata hasn't resolved yet. */
function emptyTimelapse(id: string): ProjectTimelapse {
	return {
		id,
		name: "",
		duration: 0,
		idleDuration: 0,
		annotations: [],
		ignoreIdle: false,
		description: "",
	}
}

// Ids added optimistically by `loadId` that still need confirming by Lapse.
const pendingAdds = new SvelteSet<string>()

/** Replace the current project with the result of `update`. */
function updateCurrentProject(update: (project: Project) => Project) {
	const id = activeProjectId
	projects = projects.map(project =>
		project.id === id ? update(project) : project
	)
}

/** Rename the open project. */
function renameCurrentProject(name: string) {
	const trimmed = name.trim() || DEFAULT_PROJECT_NAME
	updateCurrentProject(project => ({ ...project, name: trimmed }))
}

/** Replace the open project's timelapse order. */
function reorderCurrentProject(timelapses: ProjectTimelapse[]) {
	updateCurrentProject(project => ({ ...project, timelapses }))
}

/**
 * Close the open timelapse, if any. Switching projects calls this so the next
 * project doesn't adopt a timelapse that belongs to the previous one.
 */
function closeTimelapse() {
	if (!submittedId) return
	submittedId = ""
	selections = []
	idleRanges = []
	idleAnalyzing = false
	idleAnalyzed = false
}

/** Remove a timelapse from the open project, closing it when it was open. */
function removeEntry(id: string) {
	updateCurrentProject(project => ({
		...project,
		timelapses: project.timelapses.filter(entry => entry.id !== id),
	}))
	if (id === submittedId) closeTimelapse()
}

/** Open a different project. */
function selectProject(id: string) {
	if (id === currentProjectId) return
	if (!projects.some(project => project.id === id)) return
	closeTimelapse()
	currentProjectId = id
}

/** Create and open a new empty project. */
function createNewProject() {
	const project = createProject(uniqueProjectName(projects))
	projects = [...projects, project]
	selectProject(project.id)
}

/** Delete a project, always leaving at least one behind. */
function removeProject(id: string) {
	const remaining = projects.filter(project => project.id !== id)
	if (remaining.length === 0) {
		const project = createProject()
		if (id === currentProjectId) closeTimelapse()
		projects = [project]
		currentProjectId = project.id
		return
	}
	projects = remaining
	if (id !== currentProjectId) return
	closeTimelapse()
	currentProjectId = remaining[0].id
}

/**
 * Encode the review and project state, publish it to the description
 * immediately, and (debounced) mirror it into the path so the whole session
 * can be shared.
 */
async function syncShareUrl(state: {
	projectId: string
	id: string
	selections: TimelineSelection[]
	projectName: string
	project: ProjectTimelapse[]
}) {
	const token = ++urlToken
	const encoded = await encodeShare({
		projectId: state.projectId,
		selections: state.selections,
		projectName: state.projectName,
		project: state.project,
		openId: state.id,
	})
	// Bail if a newer encode started, or the open timelapse changed underneath
	// us (otherwise a stale payload could land on the wrong review).
	if (token !== urlToken || state.id !== submittedId) return
	encodedState = encoded
	const target = `/${encoded}`
	// Debounce only the history write, so editing doesn't spam entries.
	const id = state.id
	clearTimeout(urlTimer)
	urlTimer = setTimeout(() => {
		void applyShareUrl(id, target)
	}, 300)
}

/**
 * Mirror the encoded state into the path. Guards ensure a debounced update from
 * a previously open timelapse can only rewrite the URL of the *current* route —
 * it can never navigate back to (or re-apply the project snapshot of) a
 * different timelapse. The load effect recognises the write because it matches
 * the state currently held in `encodedState`.
 */
async function applyShareUrl(id: string, target: string) {
	if (id !== submittedId) return
	if (target === window.location.pathname) return
	await goto(target, { replace: true, shallow: true, reset: false })
}

// Persist the open timelapse's selections (and their reasons) per timelapse.
$effect(() => {
	const id = submittedId
	const value = $state.snapshot(selections)
	if (!id || !loaded) return
	saveSelections(id, value)
})

// Mirror the review — the open project and, when one is open, the timelapse —
// into the URL. Only the current project is encoded; the rest stay in storage.
$effect(() => {
	const id = submittedId
	const value = $state.snapshot(selections)
	const projectId = activeProjectId
	const name = projectName
	const entries = $state.snapshot(projectEntries)
	if (!projectLoaded || !loaded) return
	void syncShareUrl({
		projectId,
		id,
		selections: value,
		projectName: name,
		project: entries,
	})
	return () => clearTimeout(urlTimer)
})

// Load the workspace's projects once on the client; local storage isn't
// available during SSR, so this must not run in the initial render.
$effect(() => {
	const store = loadProjects()
	projects = store.projects
	currentProjectId = store.currentId
	projectLoaded = true
})

// Persist every project whenever anything about them changes.
$effect(() => {
	const store: ProjectStore = {
		projects: $state.snapshot(projects),
		currentId: currentProjectId,
	}
	if (!projectLoaded) return
	saveProjects(store)
})

/** Adopt the project carried by a shared URL and make it current. */
function importSharedProject(shared: ShareState) {
	const id = shared.projectId || newProjectId()
	const project: Project = {
		id,
		name: shared.projectName.trim() || DEFAULT_PROJECT_NAME,
		timelapses: shared.project,
	}
	const index = projects.findIndex(item => item.id === id)
	projects =
		index === -1
			? [...projects, project]
			: projects.map((item, i) => (i === index ? project : item))
	currentProjectId = id
}

/** Toggle whether idle time is ignored for the open timelapse. */
function setIgnoreIdle(value: boolean) {
	const index = projectEntries.findIndex(entry => entry.id === submittedId)
	if (index === -1) return
	updateCurrentProject(project => ({
		...project,
		timelapses: project.timelapses.map((entry, i) =>
			i === index ? { ...entry, ignoreIdle: value } : entry
		),
	}))
}

/** Force a fresh idle scan for the open timelapse, replacing the cached one. */
function recalculateIdle() {
	idleRevision = idleRevision < 0 ? 0 : idleRevision + 1
}

/** Totals for the current project, in recorded seconds. */
const projectTotals = $derived.by(() => {
	let recorded = 0
	let idle = 0
	let final = 0
	for (const entry of projectEntries) {
		recorded += entry.duration
		idle += entry.idleDuration
		final += entryFinalDuration(entry)
	}
	// Keep catalog order so the breakdown stays stable as entries change.
	const annotations = ANNOTATION_REASONS.map(reason => ({
		reason,
		duration: projectEntries.reduce(
			(sum, entry) =>
				sum +
				entry.annotations
					.filter(annotation => annotation.reason === reason.id)
					.reduce((sum, annotation) => sum + annotation.duration, 0),
			0
		),
	})).filter(entry => entry.duration > 0)
	const annotationDeflation = annotations.reduce(
		(sum, annotation) => sum + annotation.duration,
		0
	)
	return {
		recorded,
		idle,
		annotations,
		deducted: idle + annotationDeflation,
		final,
	}
})

/**
 * The project's description: every timelapse's review text in order (without
 * their individual share links), a summary of the project totals, and finally
 * a share link for the whole project.
 */
const projectDescription = $derived.by(() => {
	if (projectEntries.length === 0) return ""
	const parts = projectEntries.map(entry => entry.description)
	const total = `${formatClock(projectTotals.final)} (${formatHours(projectTotals.final)})`
	// With nothing deducted, original and final time are the same, so the
	// breakdown would just repeat itself.
	parts.push(
		projectTotals.deducted === 0
			? `Total time ${total}.`
			: `Total original time ${formatClock(projectTotals.recorded)}, ` +
					`total time deducted ${formatClock(projectTotals.deducted)}, ` +
					`final total ${total}.`
	)
	if (encodedState) parts.push(shareUrl)
	return parts.join("\n\n")
})

// Resolve the open timelapse's metadata from Lapse so it can be represented in
// the project. The query is cached, so this dedupes with the template's await.
$effect(() => {
	const id = submittedId
	currentMeta = null
	if (!id) return
	void getTimelapse(id)
		.then(timelapse => {
			if (timelapse) {
				pendingAdds.delete(id)
				if (submittedId === id) {
					currentMeta = {
						id,
						name: timelapse.name,
						duration: timelapse.duration,
					}
				}
			} else {
				if (submittedId === id) currentMeta = null
				// The id couldn't be resolved, so drop the optimistic entry.
				if (pendingAdds.has(id)) {
					pendingAdds.delete(id)
					removeEntry(id)
				}
			}
		})
		.catch(() => {
			if (submittedId === id) currentMeta = null
			if (pendingAdds.has(id)) {
				pendingAdds.delete(id)
				removeEntry(id)
			}
		})
})

// The project is the single home for every timelapse: opening one adds it (or
// refreshes its review data), and edits keep its entry in sync.
$effect(() => {
	const id = submittedId
	const meta = currentMeta
	const idle = idleDuration
	// Read the raw selection/idle state so reason-only edits still refresh the
	// stored description and breakdown, even when the totals don't change.
	const ranges = $state.snapshot(activeIdleRanges)
	const currentSelections = $state.snapshot(selections)
	const annotations = deflationByReason(currentSelections, ranges)
	const detected = $state.snapshot(idleRanges)
	if (!id || !loaded || !meta || meta.id !== id) return
	const index = projectEntries.findIndex(entry => entry.id === id)
	const existing = index === -1 ? undefined : projectEntries[index]
	// Only cache ranges once a scan has finished (or when reusing a previous
	// cache), so a scan interrupted by navigation can't persist partial results
	// that would then never be recalculated.
	const cachedRanges = idleAnalyzing
		? existing?.idleRanges
		: idleAnalyzed
			? detected
			: existing?.idleRanges
	const name = meta.name?.trim() ?? ""
	const { duration } = meta
	const description = describeTimelapse({
		id,
		duration,
		idleRanges: ranges,
		selections: currentSelections,
	})
	if (
		existing &&
		existing.duration === duration &&
		existing.name === name &&
		existing.idleDuration === idle &&
		sameAnnotations(existing.annotations, annotations) &&
		existing.ignoreIdle === ignoreIdle &&
		existing.description === description &&
		sameIdleRanges(existing.idleRanges, cachedRanges)
	) {
		return
	}
	const entry: ProjectTimelapse = {
		id,
		name,
		duration,
		idleDuration: idle,
		annotations,
		ignoreIdle,
		description,
		...(cachedRanges !== undefined ? { idleRanges: cachedRanges } : {}),
	}
	updateCurrentProject(project => ({
		...project,
		timelapses:
			index === -1
				? [...project.timelapses, entry]
				: project.timelapses.map((item, i) =>
						i === index ? entry : item
					),
	}))
})
</script>

{#snippet resizeHandle(modifier: string, onpointerdown: (event: PointerEvent) => void)}
	<div
		class="resize-handle {modifier} hidden transition-colors hover:bg-blue-500/40 lg:block"
		{onpointerdown}
		role="presentation"
	></div>
{/snippet}

{#snippet centeredState(message: string)}
	<section class="area-video flex items-center justify-center p-4">
		<p class="text-center">{message}</p>
	</section>
{/snippet}

<main
	class="dashboard"
	style="--left-width: {leftWidth}px; --right-width: {rightWidth}px; --timeline-height: {timelineRowHeight};"
>
	<ProjectPane
		{projects}
		{currentProjectId}
		{projectName}
		{projectEntries}
		{submittedId}
		{projectTotals}
		{projectDescription}
		onLoad={loadId}
		onRemoveTimelapse={removeEntry}
		onRenameProject={renameCurrentProject}
		onReorderProject={reorderCurrentProject}
		onSelectProject={selectProject}
		onCreateProject={createNewProject}
		onRemoveProject={removeProject}
	/>

	{@render resizeHandle("resize-handle-right", startRightResize)}

	<ReviewHeader {submittedId} onLoad={loadId} />

	{#if submittedId}
		{#key submittedId}
			<svelte:boundary>
				{#snippet pending()}
					{@render centeredState("Loading timelapse…")}
				{/snippet}

				{#snippet failed(error: unknown, reset: () => void)}
					<section
						class="area-video flex flex-col items-center justify-center gap-2 p-4"
					>
						<p>
							Couldn't load timelapse:
							{(error as Error)?.message ?? error}
						</p>
						<button
							type="button"
							onclick={reset}
							class="border border-neutral-500 px-2 py-1"
						>
							Retry
						</button>
					</section>
				{/snippet}

				{const timelapse = await getTimelapse(submittedId)}
				{#if timelapse}
					<VideoPane {timelapse} bind:videoEl />

					<ReviewDetails
						{timelapse}
						bind:selections
						{idleRanges}
						{idleAnalyzing}
						{ignoreIdle}
						onToggleIgnoreIdle={setIgnoreIdle}
						onRecalculateIdle={recalculateIdle}
					/>

					{@render resizeHandle("resize-handle-left", startLeftResize)}

					{#if videoEl && timelapse.playbackUrl}
						<TimelinePane
							playbackUrl={timelapse.playbackUrl}
							thumbnailUrl={timelapse.thumbnailUrl}
							{videoEl}
							bind:selections
							bind:idleRanges
							bind:idleAnalyzing
							bind:idleAnalyzed
							{idleRevision}
							{ignoreIdle}
						/>

						{@render resizeHandle("resize-handle-timeline", startTimelineResize)}
					{/if}
				{:else}
					{@render centeredState(
						`No timelapse found for ID "${submittedId}".`
					)}
				{/if}
			</svelte:boundary>
		{/key}
	{:else if routeParam && !loaded}
		{@render centeredState("Loading timelapse…")}
	{:else}
		{@render centeredState("Enter a timelapse ID above to review it here.")}
	{/if}
</main>

<style>
.dashboard {
	position: relative;
	display: grid;
	height: 100dvh;
	overflow: hidden;
	grid-template-columns: var(--left-width) minmax(0, 1fr) var(--right-width);
	grid-template-rows: auto minmax(0, 1fr) var(--timeline-height);
	grid-template-areas:
		"right header project"
		"right video project"
		"timeline timeline timeline";
}

.resize-handle {
	position: absolute;
	z-index: 30;
	touch-action: none;
}

.resize-handle-right {
	top: 0;
	bottom: var(--timeline-height);
	right: var(--right-width);
	width: 0.75rem;
	transform: translateX(50%);
	cursor: col-resize;
}

.resize-handle-left {
	top: 0;
	bottom: var(--timeline-height);
	left: var(--left-width);
	width: 0.75rem;
	transform: translateX(-50%);
	cursor: col-resize;
}

.resize-handle-timeline {
	left: 0;
	right: 0;
	bottom: var(--timeline-height);
	height: 0.75rem;
	transform: translateY(50%);
	cursor: row-resize;
}

:global(.area-project) {
	grid-area: project;
}

:global(.area-header) {
	grid-area: header;
}

:global(.area-video) {
	grid-area: video;
}

:global(.area-right) {
	grid-area: right;
}

:global(.area-timeline) {
	grid-area: timeline;
}

@media (max-width: 1023px) {
	.dashboard {
		height: auto;
		min-height: 100dvh;
		overflow: visible;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: none;
		grid-template-areas: none;
	}

	:global(.area-project),
	:global(.area-header),
	:global(.area-video),
	:global(.area-right),
	:global(.area-timeline) {
		grid-area: auto;
	}
}
</style>
