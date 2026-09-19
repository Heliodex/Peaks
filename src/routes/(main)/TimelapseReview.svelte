<script lang="ts">
import { onMount } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import type { Project } from "#lib/project-storage.js"
import {
	clampSeekStep,
	DEFAULT_SETTINGS,
	loadSettings,
	type Settings,
	saveSettings,
} from "#lib/settings-storage.js"
import type { TimelineSelection } from "#lib/timeline.js"
import { page } from "$app/state"
import { getTimelapse } from "./api.remote.js"
import ProjectPane from "./ProjectPane.svelte"
import ProjectSearch from "./ProjectSearch.svelte"
import ProjectTimelapses from "./ProjectTimelapses.svelte"
import { PaneLayout } from "./pane-layout.svelte.js"
import { ProjectSummary } from "./project-summary.svelte.js"
import { ProjectWorkspace } from "./project-workspace.svelte.js"
import ReviewDetails from "./ReviewDetails.svelte"
import { ReviewIdle } from "./review-idle.svelte.js"
import { ReviewSession } from "./review-session.svelte.js"
import { ReviewShortcuts } from "./review-shortcuts.svelte.js"
import { ReviewSync } from "./review-sync.svelte.js"
import TimelinePane from "./TimelinePane.svelte"
import { TimelapseLoader } from "./timelapse-loader.svelte.js"
import VideoPane from "./VideoPane.svelte"
import {
	WorkspaceHistory,
	type WorkspaceSnapshot,
} from "./workspace-history.svelte.js"

/** Decode a path segment, falling back to the raw text when it is malformed. */
const decodePathParam = (pathname: string): string =>
	decodeURIComponent(pathname.slice(1))

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

const panes = new PaneLayout(() => Boolean(videoEl))

// Every project lives in local storage; the workspace owns the open project and its timelapses.
const workspace = new ProjectWorkspace(closeTimelapse)

// The review session owns the open timelapse's selections and the URL sync.
const session = new ReviewSession({
	routeParam: () => routeParam,
	projectId: () => workspace.activeProjectId,
	projectName: () => workspace.projectName,
	project: () => workspace.projectEntries,
	projectLoaded: () => workspace.projectLoaded,
	onDecoded: decoded => workspace.importSharedProject(decoded),
	onResetIdle: () => idleState.reset(),
})

// The open timelapse's idle analysis and per-entry overrides.
const idleState = new ReviewIdle({
	openId: () => session.submittedId,
	entries: () => workspace.projectEntries,
	updateProject: update => workspace.updateCurrentProject(update),
})

/** Restore a history snapshot into the workspace's stores. */
function applySnapshot(snapshot: WorkspaceSnapshot) {
	const previousOpenId = session.submittedId
	// `$state.snapshot` un-wraps the stored snapshot's proxies; `structuredClone` can't clone them.
	workspace.projects = $state.snapshot(snapshot.projects) as Project[]
	workspace.currentProjectId = snapshot.currentProjectId
	session.submittedId = snapshot.openId
	session.selections = $state.snapshot(
		snapshot.selections
	) as TimelineSelection[]
	// When the open timelapse changes, its own seeding effect reloads the idle ranges; otherwise refresh them here.
	if (snapshot.openId === previousOpenId) {
		const entry = snapshot.projects
			.find(project => project.id === snapshot.currentProjectId)
			?.timelapses.find(timelapse => timelapse.id === snapshot.openId)
		idleState.restore(entry?.idleRanges)
	}
}

// Whole-workspace undo/redo. Global settings are intentionally left out of the tracked state.
const history = new WorkspaceHistory({
	read: () => ({
		projects: $state.snapshot(workspace.projects) as Project[],
		currentProjectId: workspace.currentProjectId,
		openId: session.submittedId,
		selections: $state.snapshot(session.selections) as TimelineSelection[],
	}),
	apply: applySnapshot,
})

// Ask the history to record whenever any tracked slice changes, once everything has loaded.
$effect(() => {
	void workspace.projects
	void workspace.currentProjectId
	void session.submittedId
	void session.selections
	if (workspace.projectLoaded && session.loaded) history.observe()
})

// Whether the Ctrl+K project search dialog is open.
let searchOpen = $state(false)

// Review preferences (timeline layout, …).
// Loaded once from local storage and persisted on change; never mirrored into the URL.
let justifyTimeline = $state(true)
let seekStep = $state(DEFAULT_SETTINGS.seekStep)
let settingsLoaded = $state(false)

/** Store the arrow-key seek step, clamped to the supported range. */
function setSeekStep(value: number) {
	seekStep = clampSeekStep(value)
}

/** Pixels a pane separator moves per arrow-key press (tripled while Shift is held). */
const RESIZE_STEP = 16

/**
 * Move one of the pane separators from the keyboard.
 * `deltaForKey` maps the pressed arrow key to a direction (or null when the key is irrelevant).
 */
function keyboardResize(
	event: KeyboardEvent,
	resize: (delta: number) => void,
	deltaForKey: (key: string) => number | null
) {
	const delta = deltaForKey(event.key)
	if (delta === null) return
	event.preventDefault()
	resize(delta * RESIZE_STEP * (event.shiftKey ? 3 : 1))
}

const onLeftHandleKeydown = (event: KeyboardEvent) =>
	keyboardResize(
		event,
		dx => panes.resizeLeftBy(dx),
		key => (key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : null)
	)

const onRightHandleKeydown = (event: KeyboardEvent) =>
	keyboardResize(
		event,
		dx => panes.resizeRightBy(dx),
		key => (key === "ArrowLeft" ? 1 : key === "ArrowRight" ? -1 : null)
	)

const onTimelineHandleKeydown = (event: KeyboardEvent) =>
	keyboardResize(
		event,
		dy => panes.resizeTimelineBy(dy),
		key => (key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : null)
	)

/** Matches the grip's CSS fade-out, so a recentre doesn't happen mid-transition. */
const GRIP_RESET_DELAY_MS = 120
// Pending recentres, per handle, so leaving one handle can't cancel another's.
const gripResetTimers = new WeakMap<
	HTMLElement,
	ReturnType<typeof setTimeout>
>()

/** Move the resize grip to sit next to the pointer, so it reads as the grab point rather than a centred rail. */
function moveGrip(event: PointerEvent, orientation: "vertical" | "horizontal") {
	const handle = event.currentTarget as HTMLElement
	const pending = gripResetTimers.get(handle)
	if (pending !== undefined) {
		clearTimeout(pending)
		gripResetTimers.delete(handle)
	}

	const rect = handle.getBoundingClientRect()
	const offset =
		orientation === "vertical"
			? event.clientY - rect.top
			: event.clientX - rect.left
	handle.style.setProperty("--grip-position", `${offset}px`)
}

/** Recentre the grip once the pointer has left and its fade-out has finished. */
function resetGrip(event: PointerEvent) {
	const handle = event.currentTarget as HTMLElement
	clearTimeout(gripResetTimers.get(handle))
	gripResetTimers.set(
		handle,
		setTimeout(() => {
			gripResetTimers.delete(handle)
			handle.style.removeProperty("--grip-position")
		}, GRIP_RESET_DELAY_MS)
	)
}

/**
 * Open timelapses by id.
 * The input may hold several space/comma-separated ids: each new one is resolved first so invalid ids are reported in the Project pane instead of being added and then disappearing.
 * Every id that resolves is added to the project and the first of them opens.
 * The URL carries the project state, so the current project is encoded with that timelapse open (using its saved selections) and the app navigates to `/{state}` rather than a bare `/{id}`.
 */
function loadId(value: string) {
	void loader.load(value)
}

/** Toggle fullscreen playback of the open timelapse's video. */
function toggleFullscreen() {
	const el = videoEl
	if (!el) return
	if (document.fullscreenElement)
		void document.exitFullscreen().catch(() => {})
	else void el.requestFullscreen().catch(() => {})
}

const shortcuts = new ReviewShortcuts({
	toggleSearch: () => (searchOpen = !searchOpen),
	hasVideo: () => Boolean(videoEl),
	toggleFullscreen,
	createProject: () => workspace.createNewProject(),
	entries: () => workspace.projectEntries,
	openId: () => session.submittedId,
	open: loadId,
	undo: () => history.undo(),
	redo: () => history.redo(),
})

// Ids added optimistically by the loader that still need confirming by Lapse.
const pendingAdds = new SvelteSet<string>()

const loader = new TimelapseLoader({
	openId: () => session.submittedId,
	entries: () => workspace.projectEntries,
	projectId: () => workspace.activeProjectId,
	projectName: () => workspace.projectName,
	setError: error => (workspace.loadError = error),
	updateProject: update => workspace.updateCurrentProject(update),
	markPending: id => pendingAdds.add(id),
	clearPendingWrites: () => session.clearPendingWrite(),
})

// The project is the single home for every timelapse: opening one adds it (or refreshes its review data), and edits keep its entry in sync.
const sync = new ReviewSync({
	openId: () => session.submittedId,
	loaded: () => session.loaded,
	entries: () => workspace.projectEntries,
	selections: () => session.selections,
	idle: idleState,
	pendingAdds,
	updateProject: update => workspace.updateCurrentProject(update),
	removeEntry: id => removeEntry(id),
})

/**
 * Close the open timelapse, if any.
 * Switching projects calls this so the next project doesn't adopt a timelapse that belongs to the previous one.
 */
function closeTimelapse() {
	if (!session.submittedId) return
	session.close()
	idleState.reset()
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
	const settings = loadSettings()
	justifyTimeline = settings.justifyTimeline
	seekStep = settings.seekStep
	settingsLoaded = true
})

// Persist review preferences whenever they change.
$effect(() => {
	if (!settingsLoaded) return
	const settings: Settings = { justifyTimeline, seekStep }
	saveSettings(settings)
})

// Totals and description for the current project.
const summary = new ProjectSummary({
	entries: () => workspace.projectEntries,
	shareLink: () => (session.encodedState ? session.shareUrl : ""),
})
</script>

<svelte:window onkeydown={shortcuts.onKeyDown} />

{#snippet resizeHandle(options: {
	modifier: string
	orientation: "vertical" | "horizontal"
	label: string
	value: number
	min: number
	max: number
	onpointerdown: (event: PointerEvent) => void
	onkeydown: (event: KeyboardEvent) => void
})}
	<!-- A focusable separator is a window splitter: the resize handle is keyboard-operable, which the linters can't tell from a static separator. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- biome-ignore lint/a11y/useSemanticElements: A window splitter is not an <hr>. -->
	<div
		class={[
			"resize-handle",
			options.modifier,
			"hidden hover:bg-primary-500/10 lg:block",
		]}
		role="separator"
		tabindex="0"
		aria-orientation={options.orientation}
		aria-label={options.label}
		aria-valuenow={Math.round(options.value)}
		aria-valuemin={Math.round(options.min)}
		aria-valuemax={Math.round(options.max)}
		onpointerdown={options.onpointerdown}
		onpointermove={event => moveGrip(event, options.orientation)}
		onpointerleave={resetGrip}
		onkeydown={options.onkeydown}
	>
		<span class="resize-grip" aria-hidden="true"></span>
	</div>
{/snippet}

{#snippet centeredState(message: string, loading = false)}
	<section
		class="area-video flex flex-col items-center justify-center gap-3 p-4 text-center"
	>
		{#if loading}
			<span class="spinner" aria-hidden="true"></span>
		{/if}
		<p class="text-sm text-neutral-400">{message}</p>
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
		projectEntries={workspace.projectEntries}
		submittedId={session.submittedId}
		projectTotals={summary.totals}
		projectDescription={summary.description}
		loadError={workspace.loadError}
		onLoad={loadId}
		onRemoveTimelapse={removeEntry}
		onRenameProject={(id, name) => workspace.renameProject(id, name)}
		onReorderProject={timelapses =>
			workspace.reorderCurrentProject(timelapses)}
		onSelectProject={id => workspace.selectProject(id)}
		onCreateProject={() => workspace.createNewProject()}
		onRemoveProject={id => workspace.removeProject(id)}
		onNameFocused={() => (workspace.focusNameId = null)}
	/>

	{@render resizeHandle({
		modifier: "resize-handle-right",
		orientation: "vertical",
		label: "Resize project panel",
		value: panes.rightWidth,
		min: panes.bounds.right.min,
		max: panes.bounds.right.max,
		onpointerdown: panes.startRightResize,
		onkeydown: onRightHandleKeydown,
	})}

	<ReviewDetails
		timelapse={sync.timelapse}
		hasTimelapse={Boolean(session.submittedId)}
		bind:selections={session.selections}
		idleRanges={idleState.ranges}
		idleAnalyzing={idleState.analyzing}
		ignoreIdle={idleState.ignoreIdle}
		idleThreshold={idleState.threshold}
		{justifyTimeline}
		{seekStep}
		{history}
		onToggleIgnoreIdle={value => idleState.setIgnoreIdle(value)}
		onSetIdleThreshold={value => idleState.setThreshold(value)}
		onResetIdleThreshold={() => idleState.resetThreshold()}
		onRecalculateIdle={() => idleState.recalculate()}
		onToggleJustifyTimeline={value => (justifyTimeline = value)}
		onSetSeekStep={setSeekStep}
	/>

	{@render resizeHandle({
		modifier: "resize-handle-left",
		orientation: "vertical",
		label: "Resize timelapse data panel",
		value: panes.leftWidth,
		min: panes.bounds.left.min,
		max: panes.bounds.left.max,
		onpointerdown: panes.startLeftResize,
		onkeydown: onLeftHandleKeydown,
	})}

	{#if session.submittedId}
		{#key session.submittedId}
			<svelte:boundary>
				{#snippet pending()}
					{@render centeredState("Loading timelapse…", true)}
				{/snippet}

				{#snippet failed(error: unknown, reset: () => void)}
					<section
						class="area-video flex flex-col items-center justify-center gap-3 p-4 text-center"
					>
						<p class="text-sm text-neutral-300">
							Couldn't load timelapse:
							{(error as Error)?.message ?? error}
						</p>
						<button
							type="button"
							onclick={reset}
							class="btn btn-primary"
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
							{seekStep}
							bind:selections={session.selections}
							bind:idleRanges={idleState.ranges}
							bind:idleAnalyzing={idleState.analyzing}
							bind:idleAnalyzed={idleState.analyzed}
							idleRevision={idleState.revision}
							ignoreIdle={idleState.ignoreIdle}
							idleThreshold={idleState.threshold}
						/>

						{@render resizeHandle({
							modifier: "resize-handle-timeline",
							orientation: "horizontal",
							label: "Resize timeline",
							value: panes.timelineHeight,
							min: panes.bounds.timeline.min,
							max: panes.bounds.timeline.max,
							onpointerdown: panes.startTimelineResize,
							onkeydown: onTimelineHandleKeydown,
						})}
					{/if}
				{:else}
					{@render centeredState(
						`No timelapse found for ID "${session.submittedId}".`
					)}
				{/if}
			</svelte:boundary>
		{/key}
	{:else if routeParam && !session.loaded}
		{@render centeredState("Loading timelapse…", true)}
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
		onSelect={id => workspace.selectProject(id)}
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

/* A faint grip along each separator hints that the pane can be dragged; it lights up on hover and keyboard focus. */
.resize-grip {
	position: absolute;
	top: 50%;
	left: 50%;
	translate: -50% -50%;
	background: var(--color-neutral-600);
	opacity: 0.35;
	transition:
		opacity 120ms ease,
		background-color 120ms ease;
}

/* On the vertical separators the grip tracks the pointer's height (falling back to the centre). */
.resize-handle-left .resize-grip,
.resize-handle-right .resize-grip {
	width: 2px;
	height: 2.5rem;
	top: var(--grip-position, 50%);
}

/* On the timeline separator it tracks the pointer's horizontal position instead. */
.resize-handle-timeline .resize-grip {
	width: 2.5rem;
	height: 2px;
	left: var(--grip-position, 50%);
}

.resize-handle:hover .resize-grip,
.resize-handle:focus-visible .resize-grip,
.resize-handle:active .resize-grip {
	opacity: 1;
	background: var(--color-primary-500);
}

.spinner {
	width: 1.25rem;
	height: 1.25rem;
	border: 2px solid var(--color-neutral-700);
	border-top-color: var(--color-primary-500);
	border-radius: 50%;
	animation: spin 0.7s linear infinite;
}

@keyframes spin {
	to {
		rotate: 360deg;
	}
}

@media (prefers-reduced-motion: reduce) {
	.spinner {
		animation: none;
	}
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
