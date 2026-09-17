<script lang="ts">
import { onMount } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import {
	ANNOTATION_REASONS,
	type AnnotationDeflation,
	deflationByReason,
	describeTimelapse,
	effectiveIdleRanges,
	idleRecordedSeconds,
} from "#lib/annotations.js"
import { DEFAULT_IDLE_THRESHOLD, type IdleRange } from "#lib/idle-time.js"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { loadSelections } from "#lib/selection-storage.js"
import {
	loadSettings,
	type Settings,
	saveSettings,
} from "#lib/settings-storage.js"
import { encodeShare } from "#lib/share.js"
import {
	formatClock,
	formatHours,
	type TimelineSelection,
} from "#lib/timeline.js"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { getTimelapse } from "./api.remote.js"
import ProjectPane from "./ProjectPane.svelte"
import ProjectSearch from "./ProjectSearch.svelte"
import ProjectTimelapses from "./ProjectTimelapses.svelte"
import { createPaneLayout } from "./pane-layout.svelte.js"
import { createProjectWorkspace } from "./project-workspace.svelte.js"
import ReviewDetails from "./ReviewDetails.svelte"
import { entryFinalDuration } from "./review-format.js"
import { createReviewSession } from "./review-session.svelte.js"
import type { ReviewTimelapse } from "./review-types.js"
import TimelinePane from "./TimelinePane.svelte"
import VideoPane from "./VideoPane.svelte"

/** Decode a path segment, falling back to the raw text when it is malformed. */
function decodePathParam(pathname: string): string {
	try {
		return decodeURIComponent(pathname.slice(1))
	} catch {
		return pathname.slice(1)
	}
}

/**
 * Encoded project state taken from the `/{state}` path (empty on the `/home` landing).
 * The open timelapse id is carried inside that state, so it no longer needs to live in the URL separately.
 * Shallow writes update `page.shallow.url` rather than `page.url`, so prefer it when present.
 */
const routeParam = $derived(
	page.params.id !== undefined
		? decodePathParam((page.shallow?.url ?? page.url).pathname)
		: ""
)

let videoEl = $state<HTMLVideoElement>()
let idleRanges = $state<IdleRange[]>([])
let idleAnalyzing = $state(false)
// Whether `idleRanges` came from a completed scan or the project's cache.
let idleAnalyzed = $state(false)
// Bumped to request a fresh idle scan; negative means "use the cached ranges".
let idleRevision = $state(0)

const panes = createPaneLayout(() => Boolean(videoEl))

// Every project lives in local storage; the workspace owns the open project and its timelapses.
const workspace = createProjectWorkspace({ closeTimelapse })

// The review session owns the open timelapse's selections and the URL sync.
const session = createReviewSession({
	routeParam: () => routeParam,
	projectId: () => workspace.activeProjectId,
	projectName: () => workspace.projectName,
	project: () => workspace.projectEntries,
	projectLoaded: () => workspace.projectLoaded,
	onDecoded: decoded => workspace.importSharedProject(decoded),
	onResetIdle: () => {
		idleRanges = []
		idleAnalyzing = false
		idleAnalyzed = false
	},
})

// Whether the Ctrl+K project search dialog is open.
let searchOpen = $state(false)

// Review preferences (timeline layout, …).
// Loaded once from local storage and persisted on change; never mirrored into the URL.
let justifyTimeline = $state(true)
let settingsLoaded = $state(false)

/**
 * Whether idle time is ignored for the open timelapse.
 * It lives on the project entry (the single source of truth for timelapse state), defaulting to off.
 */
const ignoreIdle = $derived(
	workspace.projectEntries.find(entry => entry.id === session.submittedId)
		?.ignoreIdle ?? false
)

/**
 * Frame-difference threshold for the open timelapse's idle scan.
 * Like `ignoreIdle` it lives on the project entry, defaulting to the standard sensitivity when unset.
 */
const idleThreshold = $derived(
	workspace.projectEntries.find(entry => entry.id === session.submittedId)
		?.idleThreshold ?? DEFAULT_IDLE_THRESHOLD
)
// Metadata for the open timelapse, resolved from Lapse so it can be added to the project automatically.
// The id is kept alongside it so a late-resolving fetch can never be applied to a different timelapse.
let currentMeta = $state<{
	id: string
	name?: string
	duration: number
} | null>(null)

// The fully resolved timelapse for the info panel.
// The center panes await the same cached query, but the panel renders even before (or without) one.
let currentTimelapse = $state<ReviewTimelapse | null>(null)

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

/**
 * Seed the open timelapse's idle ranges from the project's cache when a scan has run before, so reopening a timelapse doesn't re-analyze its video.
 * A negative revision tells the timeline to reuse the cache instead of scanning.
 */
let idleSeededFor = ""
$effect(() => {
	const id = session.submittedId
	if (!id) {
		idleSeededFor = ""
		return
	}
	if (idleSeededFor === id) return
	const entry = workspace.projectEntries.find(item => item.id === id)
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

/** Resolve each new id against Lapse, grouping them into valid, missing and unchecked. */
async function resolveIds(
	ids: string[],
	current: string,
	known: Set<string>
): Promise<{
	valid: { id: string; meta: ReviewTimelapse | null }[]
	missing: string[]
	unchecked: string[]
}> {
	const valid: { id: string; meta: ReviewTimelapse | null }[] = []
	const missing: string[] = []
	const unchecked: string[] = []
	await Promise.all(
		ids.map(async id => {
			if (id === current || known.has(id)) {
				valid.push({ id, meta: null })
				return
			}
			try {
				const meta = await getTimelapse(id)
				if (meta) valid.push({ id, meta })
				else missing.push(id)
			} catch {
				unchecked.push(id)
			}
		})
	)
	return { valid, missing, unchecked }
}

/** Comparator that restores the order ids appeared in the pasted input. */
function inputOrderComparator(ids: string[]) {
	const order = new Map(ids.map((id, index) => [id, index] as const))
	return (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
}

/** Human-readable errors for ids that couldn't be resolved. */
function idProblems(missing: string[], unchecked: string[]): string[] {
	const problems: string[] = []
	if (missing.length > 0) {
		problems.push(
			`No timelapse found for ID${missing.length > 1 ? "s" : ""} ${formatIdList(missing)}.`
		)
	}
	if (unchecked.length > 0) {
		problems.push(
			`Couldn't check ID${unchecked.length > 1 ? "s" : ""} ${formatIdList(unchecked)}. Please try again.`
		)
	}
	return problems
}

/** Add newly resolved timelapses to the open project, seeding their names and durations. */
function seedResolvedEntries(
	valid: { id: string; meta: ReviewTimelapse | null }[]
): ProjectTimelapse[] {
	const entries = $state.snapshot(workspace.projectEntries)
	let added = false
	for (const { id, meta } of valid) {
		if (meta && !entries.some(entry => entry.id === id)) {
			entries.push({
				...emptyTimelapse(id),
				name: meta.name?.trim() ?? "",
				duration: meta.duration,
			})
			pendingAdds.add(id)
			added = true
		}
	}
	if (added) {
		workspace.updateCurrentProject(project => ({
			...project,
			timelapses: entries,
		}))
	}
	return entries
}

/**
 * Open timelapses by id.
 * The input may hold several space/comma-separated ids: each new one is resolved first so invalid ids are reported in the Project pane instead of being added and then disappearing.
 * Every id that resolves is added to the project and the first of them opens.
 * The URL carries the project state, so the current project is encoded with that timelapse open (using its saved selections) and the app navigates to `/{state}` rather than a bare `/{id}`.
 */
async function loadId(value: string) {
	const ids = [...new Set(value.split(/[\s,]+/).filter(Boolean))]
	if (ids.length === 0) return
	const current = session.submittedId
	if (ids.length === 1 && ids[0] === current) return
	workspace.loadError = null
	// Ids already in the project were validated when added (and the metadata effect re-checks on open), so only new ids need resolving.
	// Everything resolves in parallel; pasted order is restored afterwards.
	const known = new Set(
		$state.snapshot(workspace.projectEntries).map(entry => entry.id)
	)
	const { valid, missing, unchecked } = await resolveIds(ids, current, known)
	const byInputOrder = inputOrderComparator(ids)
	valid.sort((a, b) => byInputOrder(a.id, b.id))
	missing.sort(byInputOrder)
	unchecked.sort(byInputOrder)
	const problems = idProblems(missing, unchecked)
	if (valid.length === 0) {
		// Nothing resolved, so there is nothing to open; just report.
		workspace.loadError = problems.join(" ")
		return
	}
	if (problems.length > 0) workspace.loadError = problems.join(" ")
	const open = valid[0]
	// Add the new timelapses to the open project straight away, so they show up (and travel in the encoded URL) even before the project sync fills in their review data.
	// Names and durations are already known, so seed those.
	const entries = seedResolvedEntries(valid)
	const encoded = await encodeShare({
		projectId: workspace.activeProjectId,
		selections: loadSelections(open.id),
		projectName: workspace.projectName,
		project: entries,
		openId: open.id,
	})
	// Drop any debounced write queued while we were encoding so it can't race this explicit navigation to the new state.
	session.clearPendingWrite()
	void goto(`/${encoded}`)
}

/** Quote ids for an error message: `“a”, “b”`. */
function formatIdList(ids: string[]): string {
	return ids.map(id => `"${id}"`).join(", ")
}

/** Toggle fullscreen playback of the open timelapse's video. */
function toggleFullscreen() {
	const el = videoEl
	if (!el) return
	if (document.fullscreenElement) {
		void document.exitFullscreen().catch(() => {})
	} else {
		void el.requestFullscreen().catch(() => {})
	}
}

/**
 * Ctrl+K (or Cmd+K) toggles the project search dialog – from anywhere, including while a field is focused, so the shortcut can both open and close it.
 * F toggles fullscreen for the open timelapse's video, and N creates a new project (with its name field focused).
 * Tab and Shift+Tab cycle through the open project's timelapses – forwards and backwards respectively, wrapping around at either end.
 * With none open, forwards opens the first entry and backwards the last.
 * These are ignored while a modifier is held (so browser shortcuts still work) and while typing in a form field or contenteditable element, so focus can leave inputs natively.
 */
function onKeyDown(event: KeyboardEvent) {
	if (event.defaultPrevented) return

	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
		event.preventDefault()
		searchOpen = !searchOpen
		return
	}

	const target = event.target as HTMLElement | null
	if (
		target &&
		(target.isContentEditable ||
			target.closest("input, textarea, select, [contenteditable]"))
	) {
		return
	}

	if (event.key.toLowerCase() === "f") {
		if (event.metaKey || event.ctrlKey || event.altKey) return
		if (!videoEl) return
		event.preventDefault()
		toggleFullscreen()
		return
	}

	if (event.key.toLowerCase() === "n") {
		if (event.metaKey || event.ctrlKey || event.altKey) return
		event.preventDefault()
		workspace.createNewProject()
		return
	}

	if (event.key !== "Tab") return
	if (event.metaKey || event.ctrlKey || event.altKey) return

	const entries = workspace.projectEntries
	if (entries.length === 0) return

	const current = entries.findIndex(entry => entry.id === session.submittedId)
	const step = event.shiftKey ? -1 : 1
	// Wrapping keeps the cycle self-contained; with none open, step towards the appropriate end of the list instead.
	const next =
		current === -1
			? event.shiftKey
				? entries.length - 1
				: 0
			: (current + step + entries.length) % entries.length
	// Nothing to cycle to (a lone open timelapse): leave Tab to move focus.
	if (next === current) return

	event.preventDefault()
	void loadId(entries[next].id)
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
		idleThreshold: DEFAULT_IDLE_THRESHOLD,
		description: "",
	}
}

// Ids added optimistically by `loadId` that still need confirming by Lapse.
const pendingAdds = new SvelteSet<string>()

/**
 * Close the open timelapse, if any.
 * Switching projects calls this so the next project doesn't adopt a timelapse that belongs to the previous one.
 */
function closeTimelapse() {
	if (!session.submittedId) return
	session.close()
	idleRanges = []
	idleAnalyzing = false
	idleAnalyzed = false
}

/** Remove a timelapse from the open project, closing it when it was open. */
function removeEntry(id: string) {
	workspace.updateCurrentProject(project => ({
		...project,
		timelapses: project.timelapses.filter(entry => entry.id !== id),
	}))
	if (id === session.submittedId) closeTimelapse()
}

/** Open a specific project's timelapse from the search dialog: make its project current first (so the timelapse is loaded into the right one), then load it. */
function openTimelapseFromSearch(projectId: string, timelapseId: string) {
	workspace.selectProject(projectId)
	void loadId(timelapseId)
}

// Load review preferences once on the client; local storage isn't available during SSR, so this must not run in the initial render.
onMount(() => {
	justifyTimeline = loadSettings().justifyTimeline
	settingsLoaded = true
})

// Persist review preferences whenever they change.
$effect(() => {
	if (!settingsLoaded) return
	const settings: Settings = { justifyTimeline }
	saveSettings(settings)
})

/** Toggle whether idle time is ignored for the open timelapse. */
function setIgnoreIdle(value: boolean) {
	const index = workspace.projectEntries.findIndex(
		entry => entry.id === session.submittedId
	)
	if (index === -1) return
	workspace.updateCurrentProject(project => ({
		...project,
		timelapses: project.timelapses.map((entry, i) =>
			i === index ? { ...entry, ignoreIdle: value } : entry
		),
	}))
}

/**
 * Set the idle-detection threshold for the open timelapse.
 * Changing it invalidates the cached scan, so a fresh one starts with the new sensitivity.
 */
function setIdleThreshold(value: number) {
	const index = workspace.projectEntries.findIndex(
		entry => entry.id === session.submittedId
	)
	if (index === -1) return
	if (value === idleThreshold) return
	workspace.updateCurrentProject(project => ({
		...project,
		timelapses: project.timelapses.map((entry, i) =>
			i === index ? { ...entry, idleThreshold: value } : entry
		),
	}))
	recalculateIdle()
}

/** Restore the standard idle-detection sensitivity for the open timelapse. */
function resetIdleThreshold() {
	setIdleThreshold(DEFAULT_IDLE_THRESHOLD)
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
	for (const entry of workspace.projectEntries) {
		recorded += entry.duration
		idle += entry.idleDuration
		final += entryFinalDuration(entry)
	}
	// Keep catalog order so the breakdown stays stable as entries change.
	const annotations = ANNOTATION_REASONS.map(reason => ({
		reason,
		duration: workspace.projectEntries.reduce(
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

/** The project's description: every timelapse's review text in order (without their individual share links), a summary of the project totals, and finally a share link for the whole project. */
const projectDescription = $derived.by(() => {
	if (workspace.projectEntries.length === 0) return ""
	const parts = workspace.projectEntries.map(entry => entry.description)
	const total = `${formatClock(projectTotals.final)} (${formatHours(projectTotals.final)})`
	// With nothing deducted, original and final time are the same, so the breakdown would just repeat itself.
	parts.push(
		projectTotals.deducted === 0
			? `Total time ${total}.`
			: `Total original time ${formatClock(projectTotals.recorded)}, ` +
					`total time deducted ${formatClock(projectTotals.deducted)}, ` +
					`final total ${total}.`
	)
	if (session.encodedState) parts.push(session.shareUrl)
	return parts.join("\n\n")
})

// Resolve the open timelapse's metadata from Lapse so it can be represented in the project.
// The query is cached, so this dedupes with the template's await.
$effect(() => {
	const id = session.submittedId
	currentMeta = null
	currentTimelapse = null
	if (!id) return
	void getTimelapse(id)
		.then(timelapse => {
			if (session.submittedId === id) {
				currentTimelapse = timelapse ?? null
				currentMeta = timelapse
					? {
							id,
							name: timelapse.name,
							duration: timelapse.duration,
						}
					: null
			}
			if (timelapse) {
				pendingAdds.delete(id)
			} else if (pendingAdds.has(id)) {
				// The id couldn't be resolved, so drop the optimistic entry.
				pendingAdds.delete(id)
				removeEntry(id)
			}
		})
		.catch(() => {
			if (session.submittedId === id) {
				currentTimelapse = null
				currentMeta = null
			}
			if (pendingAdds.has(id)) {
				pendingAdds.delete(id)
				removeEntry(id)
			}
		})
})

/**
 * Build the project entry for a resolved timelapse, or null when the stored entry already matches.
 */
function updatedEntry(
	id: string,
	meta: { id: string; name?: string; duration: number },
	idle: number,
	ranges: IdleRange[],
	currentSelections: TimelineSelection[],
	detected: IdleRange[]
): { index: number; entry: ProjectTimelapse } | null {
	const index = workspace.projectEntries.findIndex(entry => entry.id === id)
	const existing = index === -1 ? undefined : workspace.projectEntries[index]
	// Only cache ranges once a scan has finished (or when reusing a previous cache), so a scan interrupted by navigation can't persist partial results that would then never be recalculated.
	const cachedRanges = idleAnalyzing
		? existing?.idleRanges
		: idleAnalyzed
			? detected
			: existing?.idleRanges
	const annotations = deflationByReason(currentSelections, ranges)
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
		existing.idleThreshold === idleThreshold &&
		existing.description === description &&
		sameIdleRanges(existing.idleRanges, cachedRanges)
	) {
		return null
	}
	return {
		index,
		entry: {
			id,
			name,
			duration,
			idleDuration: idle,
			annotations,
			ignoreIdle,
			idleThreshold,
			description,
			...(cachedRanges !== undefined ? { idleRanges: cachedRanges } : {}),
		},
	}
}

// The project is the single home for every timelapse: opening one adds it (or refreshes its review data), and edits keep its entry in sync.
$effect(() => {
	const id = session.submittedId
	const meta = currentMeta
	const idle = idleDuration
	// Read the raw selection/idle state so reason-only edits still refresh the stored description and breakdown, even when the totals don't change.
	const ranges = $state.snapshot(activeIdleRanges)
	const currentSelections = $state.snapshot(session.selections)
	const detected = $state.snapshot(idleRanges)
	if (!id || !session.loaded || !meta || meta.id !== id) return

	const result = updatedEntry(
		id,
		meta,
		idle,
		ranges,
		currentSelections,
		detected
	)
	if (!result) return
	const { index, entry } = result
	workspace.updateCurrentProject(project => ({
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

<svelte:window onkeydown={onKeyDown} />

{#snippet resizeHandle(modifier: string, onpointerdown: (event: PointerEvent) => void)}
	<div
		class="resize-handle {modifier} hidden transition-colors hover:bg-primary-500/40 lg:block"
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
	class={["dashboard", justifyTimeline
		? "timeline-justified"
		: "timeline-centred"]}
	style="--left-width: {panes.leftWidth}px; --right-width: {panes.rightWidth}px; --timeline-height: {panes.timelineRowHeight};"
>
	<ProjectPane
		projects={workspace.projects}
		currentProjectId={workspace.currentProjectId}
		focusNameId={workspace.focusNameId}
		projectName={workspace.projectName}
		projectEntries={workspace.projectEntries}
		submittedId={session.submittedId}
		{projectTotals}
		{projectDescription}
		loadError={workspace.loadError}
		onLoad={loadId}
		onRemoveTimelapse={removeEntry}
		onRenameProject={workspace.renameCurrentProject}
		onReorderProject={workspace.reorderCurrentProject}
		onSelectProject={workspace.selectProject}
		onCreateProject={workspace.createNewProject}
		onRemoveProject={workspace.removeProject}
		onNameFocused={() => (workspace.focusNameId = null)}
	/>

	{@render resizeHandle("resize-handle-right", panes.startRightResize)}

	<ReviewDetails
		timelapse={currentTimelapse}
		bind:selections={session.selections}
		{idleRanges}
		{idleAnalyzing}
		{ignoreIdle}
		{idleThreshold}
		{justifyTimeline}
		onToggleIgnoreIdle={setIgnoreIdle}
		onSetIdleThreshold={setIdleThreshold}
		onResetIdleThreshold={resetIdleThreshold}
		onRecalculateIdle={recalculateIdle}
		onToggleJustifyTimeline={value => (justifyTimeline = value)}
	/>

	{@render resizeHandle("resize-handle-left", panes.startLeftResize)}

	{#if session.submittedId}
		{#key session.submittedId}
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

				{const timelapse = await getTimelapse(session.submittedId)}
				{#if timelapse}
					<VideoPane {timelapse} bind:videoEl />

					{#if videoEl && timelapse.playbackUrl}
						<TimelinePane
							playbackUrl={timelapse.playbackUrl}
							thumbnailUrl={timelapse.thumbnailUrl}
							{videoEl}
							bind:selections={session.selections}
							bind:idleRanges
							bind:idleAnalyzing
							bind:idleAnalyzed
							{idleRevision}
							{ignoreIdle}
							{idleThreshold}
						/>

						{@render resizeHandle("resize-handle-timeline", panes.startTimelineResize)}
					{/if}
				{:else}
					{@render centeredState(
						`No timelapse found for ID "${session.submittedId}".`
					)}
				{/if}
			</svelte:boundary>
		{/key}
	{:else if routeParam && !session.loaded}
		{@render centeredState("Loading timelapse…")}
	{:else if workspace.projectEntries.length > 0}
		<ProjectTimelapses entries={workspace.projectEntries} onLoad={loadId} />
	{:else}
		{@render centeredState(
			"No timelapses in this project. Add one from the Project panel."
		)}
	{/if}
</main>

{#if searchOpen}
	<ProjectSearch
		projects={workspace.projects}
		currentProjectId={workspace.currentProjectId}
		currentTimelapseId={session.submittedId}
		onSelect={workspace.selectProject}
		onLoadTimelapse={openTimelapseFromSearch}
		onClose={() => (searchOpen = false)}
	/>
{/if}

<style>
.dashboard {
	position: relative;
	display: grid;
	height: 100dvh;
	overflow: hidden;
	grid-template-columns: var(--left-width) minmax(0, 1fr) var(--right-width);
	grid-template-rows: minmax(0, 1fr) var(--timeline-height);
}

.timeline-justified {
	grid-template-areas:
		"right video project"
		"timeline timeline timeline";
}

.timeline-centred {
	grid-template-areas:
		"right video project"
		"right timeline project";
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

.timeline-centred .resize-handle-timeline {
	left: var(--left-width);
	right: var(--right-width);
}

:global(.area-project) {
	grid-area: project;
	container-type: inline-size;
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

@media (width < 1024px) {
	.dashboard {
		height: auto;
		min-height: 100dvh;
		overflow: visible;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: none;
		grid-template-areas: none;
	}

	:global(.area-project),
	:global(.area-video),
	:global(.area-right),
	:global(.area-timeline) {
		grid-area: auto;
	}
}
</style>
