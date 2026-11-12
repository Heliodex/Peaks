<script lang="ts">
import { onDestroy, onMount } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import { FramePreviews } from "#lib/frame-previews.svelte.js"
import { getTimelapse } from "#lib/lapse-client.js"
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
import CenteredState from "./CenteredState.svelte"
import ProjectPane from "./ProjectPane.svelte"
import ProjectSearch from "./ProjectSearch.svelte"
import ProjectTimelapses from "./ProjectTimelapses.svelte"
import { PaneLayout } from "./pane-layout.svelte.js"
import { ProjectSummary } from "./project-summary.svelte.js"
import { ProjectWorkspace } from "./project-workspace.svelte.js"
import ResizeHandle from "./ResizeHandle.svelte"
import ReviewDetails from "./ReviewDetails.svelte"
import { keyboardResize } from "./resize-grip.js"
import { ReviewIdle } from "./review-idle.svelte.js"
import { ReviewSession } from "./review-session.svelte.js"
import { ReviewShortcuts } from "./review-shortcuts.svelte.js"
import { ReviewSync } from "./review-sync.svelte.js"
import TimelinePane from "./TimelinePane.svelte"
import { TimelapseLoader } from "./timelapse-loader.svelte.js"
import VideoPane from "./VideoPane.svelte"
import { WorkspaceHistory } from "./workspace-history.svelte.js"
import type { WorkspaceSnapshot } from "./workspace-history-types.js"

/** Decode a path segment, falling back to the raw text when it is malformed. */
const decodePathParam = (pathname: string): string =>
	decodeURIComponent(pathname.slice(1))

/**
 * Encoded project state taken from the `/{state}` path (empty on the `/` landing).
 * The open timelapse id is carried inside that state, so it no longer needs to live in the URL separately.
 * Shallow writes update `page.shallow.url` rather than `page.url`, so prefer it when present.
 */
const routeParam = $derived(
	page.params.id !== undefined
		? decodePathParam((page.shallow?.url ?? page.url).pathname)
		: "",
)

let videoEl = $state<HTMLVideoElement>()

const panes = new PaneLayout(() => Boolean(videoEl))

// Every project lives in local storage; the workspace owns the open project and its timelapses.
const workspace = new ProjectWorkspace(closeTimelapse)

// The review session owns the open timelapse's selections and the URL sync.
const session = new ReviewSession({
	onDecoded: decoded => workspace.importSharedProject(decoded),
	onResetIdle: () => idleState.reset(),
	onStorageError: failed =>
		workspace.reportStorageError("selections", failed),
	project: () => workspace.projectEntries,
	projectId: () => workspace.activeProjectId,
	projectLoaded: () => workspace.projectLoaded,
	projectName: () => workspace.projectName,
	routeParam: () => routeParam,
})

// The open timelapse's idle analysis and per-entry overrides.
const idleState = new ReviewIdle({
	entries: () => workspace.projectEntries,
	openId: () => session.submittedId,
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
		snapshot.selections,
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
	apply: applySnapshot,
	read: () => ({
		currentProjectId: workspace.currentProjectId,
		openId: session.submittedId,
		projects: $state.snapshot(workspace.projects) as Project[],
		selections: $state.snapshot(session.selections) as TimelineSelection[],
	}),
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

const onLeftHandleKeydown = (event: KeyboardEvent) =>
	keyboardResize(
		event,
		dx => panes.resizeLeftBy(dx),
		key => (key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : null),
	)

const onRightHandleKeydown = (event: KeyboardEvent) =>
	keyboardResize(
		event,
		dx => panes.resizeRightBy(dx),
		key => (key === "ArrowLeft" ? 1 : key === "ArrowRight" ? -1 : null),
	)

const onTimelineHandleKeydown = (event: KeyboardEvent) =>
	keyboardResize(
		event,
		dy => panes.resizeTimelineBy(dy),
		key => (key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : null),
	)

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
	createProject: () => workspace.createNewProject(),
	entries: () => workspace.projectEntries,
	hasVideo: () => Boolean(videoEl),
	open: loadId,
	openId: () => session.submittedId,
	redo: () => history.redo(),
	toggleFullscreen,
	toggleSearch: () => (searchOpen = !searchOpen),
	undo: () => history.undo(),
})

// Ids added optimistically by the loader that still need confirming by Lapse.
const pendingAdds = new SvelteSet<string>()

const loader = new TimelapseLoader({
	clearPendingWrites: () => session.clearPendingWrite(),
	entries: () => workspace.projectEntries,
	markPending: id => pendingAdds.add(id),
	openId: () => session.submittedId,
	projectId: () => workspace.activeProjectId,
	projectName: () => workspace.projectName,
	setError: error => (workspace.loadError = error),
	updateProject: update => workspace.updateCurrentProject(update),
})

// Encoded scrubbing previews for the open timelapse; the timeline starts and stops them.
const previews = new FramePreviews()

onDestroy(() => {
	loader.cancel()
	previews.stop()
})

// The project is the single home for every timelapse: opening one adds it (or refreshes its review data), and edits keep its entry in sync.
const sync = new ReviewSync({
	entries: () => workspace.projectEntries,
	idle: idleState,
	loaded: () => session.loaded,
	openId: () => session.submittedId,
	pendingAdds,
	removeEntry: id => removeEntry(id),
	selections: () => session.selections,
	updateProject: update => workspace.updateCurrentProject(update),
})

/**
 * Close the open timelapse, if any.
 * Switching projects calls this so the next project doesn't adopt a timelapse that belongs to the previous one.
 */
function closeTimelapse() {
	loader.cancel()
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

<main
	class={[
		"dashboard",
		justifyTimeline ? "timeline-justified" : "timeline-centred",
	]}
	style="--left-width: {panes.leftWidth}px; --right-width: {panes.rightWidth}px; --timeline-height: {panes.timelineRowHeight};"
>
	<ProjectPane
		currentProjectId={workspace.currentProjectId}
		focusNameId={workspace.focusNameId}
		loadError={workspace.loadError}
		onCreateProject={() => workspace.createNewProject()}
		onLoad={loadId}
		onNameFocused={() => (workspace.focusNameId = null)}
		onRemoveProject={id => workspace.removeProject(id)}
		onRemoveTimelapse={removeEntry}
		onRenameProject={(id, name) => workspace.renameProject(id, name)}
		onReorderProject={timelapses =>
			workspace.reorderCurrentProject(timelapses)}
		onReorderProjects={projects => workspace.reorderProjects(projects)}
		onSelectProject={id => workspace.selectProject(id)}
		projectDescription={summary.description}
		projectEntries={workspace.projectEntries}
		projects={workspace.projects}
		projectTotals={summary.totals}
		storageError={workspace.storageError}
		submittedId={session.submittedId}
	/>

	<ResizeHandle
		label="Resize project panel"
		max={panes.bounds.right.max}
		min={panes.bounds.right.min}
		modifier="resize-handle-right"
		onkeydown={onRightHandleKeydown}
		onpointerdown={panes.startRightResize}
		orientation="vertical"
		value={panes.rightWidth}
	/>

	<ReviewDetails
		hasTimelapse={Boolean(session.submittedId)}
		{history}
		idleAnalyzing={idleState.analyzing}
		idleRanges={idleState.ranges}
		idleThreshold={idleState.threshold}
		ignoreIdle={idleState.ignoreIdle}
		{justifyTimeline}
		onRecalculateIdle={() => idleState.recalculate()}
		onResetIdleThreshold={() => idleState.resetThreshold()}
		onSetIdleThreshold={value => idleState.setThreshold(value)}
		onSetSeekStep={setSeekStep}
		onToggleIgnoreIdle={value => idleState.setIgnoreIdle(value)}
		onToggleJustifyTimeline={value => (justifyTimeline = value)}
		{seekStep}
		timelapse={sync.timelapse}
		bind:selections={session.selections}
	/>

	<ResizeHandle
		label="Resize timelapse data panel"
		max={panes.bounds.left.max}
		min={panes.bounds.left.min}
		modifier="resize-handle-left"
		onkeydown={onLeftHandleKeydown}
		onpointerdown={panes.startLeftResize}
		orientation="vertical"
		value={panes.leftWidth}
	/>

	{#if session.submittedId}
		{#key session.submittedId}
			<svelte:boundary>
				{#snippet pending()}
					<CenteredState loading message="Loading timelapse…" />
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
							class="btn btn-primary"
							onclick={reset}
							type="button"
						>
							Retry
						</button>
					</section>
				{/snippet}

				{const timelapse = await getTimelapse(session.submittedId)}
				{#if timelapse}
					<VideoPane {previews} {timelapse} bind:videoEl />

					{#if videoEl && timelapse.playbackUrl}
						<TimelinePane
							idleRevision={idleState.revision}
							idleThreshold={idleState.threshold}
							ignoreIdle={idleState.ignoreIdle}
							playbackUrl={timelapse.playbackUrl}
							{previews}
							{seekStep}
							thumbnailUrl={timelapse.thumbnailUrl}
							{videoEl}
							bind:idleAnalyzed={idleState.analyzed}
							bind:idleAnalyzing={idleState.analyzing}
							bind:idleRanges={idleState.ranges}
							bind:selections={session.selections}
						/>

						<ResizeHandle
							label="Resize timeline"
							max={panes.bounds.timeline.max}
							min={panes.bounds.timeline.min}
							modifier="resize-handle-timeline"
							onkeydown={onTimelineHandleKeydown}
							onpointerdown={panes.startTimelineResize}
							orientation="horizontal"
							value={panes.timelineHeight}
						/>
					{/if}
				{:else}
					<CenteredState
						message="No timelapse found for ID &quot;{session.submittedId}&quot;."
					/>
				{/if}
			</svelte:boundary>
		{/key}
	{:else if routeParam && !session.loaded}
		<CenteredState loading message="Loading timelapse…" />
	{:else if workspace.projectEntries.length > 0}
		<ProjectTimelapses
			entries={workspace.projectEntries}
			onLoad={loadId}
			onRemoveTimelapse={removeEntry}
			onReorder={timelapses =>
				workspace.reorderCurrentProject(timelapses)}
		/>
	{:else}
		<CenteredState
			message="No timelapses in this project. Add one from the Project panel."
		/>
	{/if}
</main>

{#if searchOpen}
	<ProjectSearch
		currentProjectId={workspace.currentProjectId}
		currentTimelapseId={session.submittedId}
		onClose={() => (searchOpen = false)}
		onLoadTimelapse={openTimelapseFromSearch}
		onSelect={id => workspace.selectProject(id)}
		projects={workspace.projects}
	/>
{/if}

<style>
.dashboard {
	position: relative;
	display: grid;
	grid-template-rows: minmax(0, 1fr) var(--timeline-height);
	grid-template-columns: var(--left-width) minmax(0, 1fr) var(--right-width);
	height: 100dvh;
	overflow: hidden;
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
		grid-template-areas: none;
		grid-template-rows: none;
		grid-template-columns: minmax(0, 1fr);
		height: auto;
		min-height: 100dvh;
		overflow: visible;
	}

	:global(.area-project),
	:global(.area-video),
	:global(.area-right),
	:global(.area-timeline) {
		grid-area: auto;
	}
}
</style>
