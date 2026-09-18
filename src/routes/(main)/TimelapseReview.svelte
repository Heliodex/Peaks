<script lang="ts">
import { onMount } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import {
	loadSettings,
	type Settings,
	saveSettings,
} from "#lib/settings-storage.js"
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

// Whether the Ctrl+K project search dialog is open.
let searchOpen = $state(false)

// Review preferences (timeline layout, …).
// Loaded once from local storage and persisted on change; never mirrored into the URL.
let justifyTimeline = $state(true)
let settingsLoaded = $state(false)

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
	justifyTimeline = loadSettings().justifyTimeline
	settingsLoaded = true
})

// Persist review preferences whenever they change.
$effect(() => {
	if (!settingsLoaded) return
	const settings: Settings = { justifyTimeline }
	saveSettings(settings)
})

// Totals and description for the current project.
const summary = new ProjectSummary({
	entries: () => workspace.projectEntries,
	shareLink: () => (session.encodedState ? session.shareUrl : ""),
})
</script>

<svelte:window onkeydown={shortcuts.onKeyDown} />

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
		projectTotals={summary.totals}
		projectDescription={summary.description}
		loadError={workspace.loadError}
		onLoad={loadId}
		onRemoveTimelapse={removeEntry}
		onRenameProject={name => workspace.renameCurrentProject(name)}
		onReorderProject={timelapses =>
			workspace.reorderCurrentProject(timelapses)}
		onSelectProject={id => workspace.selectProject(id)}
		onCreateProject={() => workspace.createNewProject()}
		onRemoveProject={id => workspace.removeProject(id)}
		onNameFocused={() => (workspace.focusNameId = null)}
	/>

	{@render resizeHandle("resize-handle-right", panes.startRightResize)}

	<ReviewDetails
		timelapse={sync.timelapse}
		bind:selections={session.selections}
		idleRanges={idleState.ranges}
		idleAnalyzing={idleState.analyzing}
		ignoreIdle={idleState.ignoreIdle}
		idleThreshold={idleState.threshold}
		{justifyTimeline}
		onToggleIgnoreIdle={value => idleState.setIgnoreIdle(value)}
		onSetIdleThreshold={value => idleState.setThreshold(value)}
		onResetIdleThreshold={() => idleState.resetThreshold()}
		onRecalculateIdle={() => idleState.recalculate()}
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
							bind:idleRanges={idleState.ranges}
							bind:idleAnalyzing={idleState.analyzing}
							bind:idleAnalyzed={idleState.analyzed}
							idleRevision={idleState.revision}
							ignoreIdle={idleState.ignoreIdle}
							idleThreshold={idleState.threshold}
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
