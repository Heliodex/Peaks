<script lang="ts">
import {
	ANNOTATION_REASONS,
	type AnnotationDeflation,
	deflationByReason,
	describeTimelapse,
} from "#lib/annotations.js"
import type { IdleRange } from "#lib/idle-time.js"
import {
	DEFAULT_PROJECT_NAME,
	loadProject,
	type Project,
	type ProjectTimelapse,
	saveProject,
} from "#lib/project-storage.js"
import { loadSelections, saveSelections } from "#lib/selection-storage.js"
import { decodeShare, encodeShare, type ShareState } from "#lib/share.js"
import {
	clamp,
	formatClock,
	formatHours,
	PLAYBACK_TO_RECORDED,
	type TimelineSelection,
} from "#lib/timeline.js"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { getTimelapse } from "./api.remote.js"
import ProjectPane from "./ProjectPane.svelte"
import ReviewDetails from "./ReviewDetails.svelte"
import ReviewHeader from "./ReviewHeader.svelte"
import { annotationTotal } from "./review-format.js"
import TimelinePane from "./TimelinePane.svelte"
import VideoPane from "./VideoPane.svelte"

/** Query parameter holding the compressed selections. */
const SHARE_PARAM = "tl"

/** Canonical origin used when a summary links back to the review. */
const SITE_ORIGIN = "https://peaks.heliodex.cf"

/** Timelapse id taken from the `/{id}` path (empty on the `/home` landing). */
const submittedId = $derived(page.params.id ?? "")

let videoEl = $state<HTMLVideoElement>()
let selections = $state<TimelineSelection[]>([])
let idleRanges = $state<IdleRange[]>([])
let idleAnalyzing = $state(false)
// Encoded `tl` payload currently represented by the review. Kept as its own
// state (rather than read back from `page.url`) so the description always
// reflects what we encoded, even before the address bar catches up.
let shareParam = $state<string | null>(page.url.searchParams.get(SHARE_PARAM))

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

/** Shareable link for the current review, including the `?tl=` payload. */
const shareUrl = $derived(
	`${SITE_ORIGIN}/${encodeURIComponent(submittedId)}${
		shareParam ? `?${SHARE_PARAM}=${shareParam}` : ""
	}`
)

// The workspace holds a single project. Its name and timelapses are persisted
// locally, so the project survives reloads.
let projectName = $state(DEFAULT_PROJECT_NAME)
let projectEntries = $state<ProjectTimelapse[]>([])
let projectLoaded = $state(false)

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

/** Idle ranges that count towards the maths (none while overridden). */
const effectiveIdleRanges = $derived(ignoreIdle ? [] : idleRanges)

/** Time removed from the actual duration as idle, in recorded seconds. */
const idleDuration = $derived(
	effectiveIdleRanges.reduce(
		(sum, range) => sum + (range.end - range.start),
		0
	) * PLAYBACK_TO_RECORDED
)

// Load selections for the current path id: a `tl` parameter takes precedence,
// otherwise fall back to anything saved locally. Resets idle analysis because
// the underlying video changes.
let loadToken = 0
let loaded = $state(false)
$effect(() => {
	const id = submittedId
	const token = ++loadToken
	loaded = false
	idleRanges = []
	idleAnalyzing = false
	if (!id) {
		selections = []
		shareParam = null
		loaded = true
		return
	}
	const shared = new URL(window.location.href).searchParams.get(SHARE_PARAM)
	// Reflect the incoming payload immediately; the encode below will refresh it.
	shareParam = shared
	if (shared) {
		void decodeShare(shared).then(decoded => {
			if (token !== loadToken) return
			// The payload may name a different open timelapse than the path.
			if (decoded?.openId && decoded.openId !== id) {
				const url = new URL(window.location.href)
				url.pathname = `/${encodeURIComponent(decoded.openId)}`
				void goto(`${url.pathname}${url.search}`)
				return
			}
			selections = decoded?.selections ?? loadSelections(id)
			if (decoded) importSharedProject(decoded)
			loaded = true
		})
	} else {
		selections = loadSelections(id)
		loaded = true
	}
})

function loadId(value: string) {
	const id = value.trim()
	if (!id || id === submittedId) return
	void goto(`/${encodeURIComponent(id)}`)
}

// Guards against an older async encode resolving after a newer one.
let urlToken = 0
let urlTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Encode the review and project state, publish it to the description
 * immediately, and (debounced) mirror it into the address bar so the whole
 * session can be shared.
 */
async function syncShareUrl(state: {
	id: string
	selections: TimelineSelection[]
	projectName: string
	project: ProjectTimelapse[]
}) {
	const token = ++urlToken
	const encoded = await encodeShare({
		selections: state.selections,
		projectName: state.projectName,
		project: state.project,
		openId: state.id,
	})
	// Bail if a newer encode started, or the open timelapse changed underneath
	// us (otherwise a stale payload could land on the wrong review).
	if (token !== urlToken || state.id !== submittedId) return
	shareParam = encoded
	const url = new URL(window.location.href)
	url.searchParams.set(SHARE_PARAM, encoded)
	url.pathname = `/${encodeURIComponent(state.id)}`
	const target = `${url.pathname}${url.search}`
	// Debounce only the history write, so editing doesn't spam entries.
	const id = state.id
	clearTimeout(urlTimer)
	urlTimer = setTimeout(() => {
		void applyShareUrl(id, target)
	}, 300)
}

/**
 * Mirror the `?tl=` payload into the address bar. Guards ensure a debounced
 * update from a previously open timelapse can only rewrite the query string
 * of the *current* route — it can never navigate back to (or re-apply the
 * project snapshot of) a different timelapse.
 */
async function applyShareUrl(id: string, target: string) {
	if (id !== submittedId) return
	const targetUrl = new URL(target, window.location.origin)
	if (targetUrl.pathname !== window.location.pathname) return
	if (targetUrl.search === window.location.search) return
	await goto(target, { replace: true, shallow: true, reset: false })
}

// Persist selections (and their reasons) per timelapse, and mirror the review
// and project state into the `?tl=` parameter so the whole session can be
// shared.
$effect(() => {
	const id = submittedId
	const value = $state.snapshot(selections)
	const name = projectName
	const entries = $state.snapshot(projectEntries)
	if (!id || !loaded) return
	saveSelections(id, value)
	void syncShareUrl({
		id,
		selections: value,
		projectName: name,
		project: entries,
	})
	return () => clearTimeout(urlTimer)
})

// Load the single workspace project once on the client; local storage isn't
// available during SSR, so this must not run in the initial render.
$effect(() => {
	const project = loadProject()
	projectName = project.name
	projectEntries = project.timelapses
	projectLoaded = true
})

// Persist the project whenever its name or timelapses change.
$effect(() => {
	const project: Project = {
		name: projectName,
		timelapses: $state.snapshot(projectEntries),
	}
	if (!projectLoaded) return
	saveProject(project)
})

/** Adopt the project carried by a shared URL. */
function importSharedProject(shared: ShareState) {
	if (shared.projectName.trim()) projectName = shared.projectName.trim()
	projectEntries = shared.project
}

/** Toggle whether idle time is ignored for the open timelapse. */
function setIgnoreIdle(value: boolean) {
	const index = projectEntries.findIndex(entry => entry.id === submittedId)
	if (index === -1) return
	projectEntries = projectEntries.map((entry, i) =>
		i === index ? { ...entry, ignoreIdle: value } : entry
	)
}

/** Totals for the current project, in recorded seconds. */
const projectTotals = $derived.by(() => {
	let recorded = 0
	let idle = 0
	let final = 0
	for (const entry of projectEntries) {
		recorded += entry.duration
		idle += entry.idleDuration
		final += Math.max(
			0,
			entry.duration -
				entry.idleDuration -
				annotationTotal(entry.annotations)
		)
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
	parts.push(
		`Total original time ${formatClock(projectTotals.recorded)}, ` +
			`total time deducted ${formatClock(projectTotals.deducted)}, ` +
			`final total ${formatClock(projectTotals.final)} (${formatHours(projectTotals.final)}).`
	)
	if (submittedId) parts.push(shareUrl)
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
			if (submittedId !== id) return
			currentMeta = timelapse
				? {
						id,
						name: timelapse.name,
						duration: timelapse.duration,
					}
				: null
		})
		.catch(() => {
			if (submittedId !== id) return
			currentMeta = null
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
	const ranges = $state.snapshot(effectiveIdleRanges)
	const currentSelections = $state.snapshot(selections)
	const annotations = deflationByReason(currentSelections, ranges)
	if (!id || !loaded || !meta || meta.id !== id) return
	const index = projectEntries.findIndex(entry => entry.id === id)
	const existing = index === -1 ? undefined : projectEntries[index]
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
		existing.description === description
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
	}
	projectEntries =
		index === -1
			? [...projectEntries, entry]
			: projectEntries.map((item, i) => (i === index ? entry : item))
})
</script>

<main
	class="dashboard"
	style="--left-width: {leftWidth}px; --right-width: {rightWidth}px; --timeline-height: {timelineRowHeight};"
>
	<ProjectPane
		bind:projectName
		bind:projectEntries
		{submittedId}
		{projectTotals}
		{projectDescription}
		onLoad={loadId}
	/>

	<div
		class="resize-handle resize-handle-right hidden transition-colors hover:bg-blue-500/40 lg:block"
		onpointerdown={startRightResize}
		role="presentation"
	></div>

	<ReviewHeader {submittedId} onLoad={loadId} />

	{#if submittedId}
		{#key submittedId}
			<svelte:boundary>
				{#snippet pending()}
					<section
						class="area-video flex items-center justify-center p-4"
					>
						<p>Loading timelapse…</p>
					</section>
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
					/>

					<div
						class="resize-handle resize-handle-left hidden transition-colors hover:bg-blue-500/40 lg:block"
						onpointerdown={startLeftResize}
						role="presentation"
					></div>

					{#if videoEl && timelapse.playbackUrl}
						<TimelinePane
							playbackUrl={timelapse.playbackUrl}
							thumbnailUrl={timelapse.thumbnailUrl}
							{videoEl}
							bind:selections
							bind:idleRanges
							bind:idleAnalyzing
							{ignoreIdle}
						/>

						<div
							class="resize-handle resize-handle-timeline hidden transition-colors hover:bg-blue-500/40 lg:block"
							onpointerdown={startTimelineResize}
							role="presentation"
						></div>
					{/if}
				{:else}
					<section
						class="area-video flex items-center justify-center p-4"
					>
						<p>No timelapse found for ID “{submittedId}”.</p>
					</section>
				{/if}
			</svelte:boundary>
		{/key}
	{:else}
		<section class="area-video flex items-center justify-center p-4">
			<p class="text-center">
				Enter a timelapse ID above to review it here.
			</p>
		</section>
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
