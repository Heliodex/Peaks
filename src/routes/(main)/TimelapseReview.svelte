<script lang="ts">
import {
	ANNOTATION_REASONS,
	describeTimelapse,
	findAnnotationReason,
	nonIdleDuration,
} from "#lib/annotations.js"
import Timeline from "#lib/components/Timeline.svelte"
import { loadIgnoreIdle, saveIgnoreIdle } from "#lib/idle-override.js"
import type { IdleRange } from "#lib/idle-time.js"
import {
	loadCurrentProject,
	loadProject,
	type ProjectTimelapse,
	saveCurrentProject,
	saveProject,
} from "#lib/project-storage.js"
import { loadSelections, saveSelections } from "#lib/selection-storage.js"
import { decodeShare, encodeShare } from "#lib/share.js"
import {
	formatClock,
	PLAYBACK_TO_RECORDED,
	type TimelineSelection,
} from "#lib/timeline.js"
import { goto } from "$app/navigation"
import { page } from "$app/state"
import { flip } from "svelte/animate"
import { getLapseData, getTimelapse, logout } from "./api.remote.js"

/** Query parameter holding the compressed selections. */
const SHARE_PARAM = "tl"

/** Canonical origin used when a summary links back to the review. */
const SITE_ORIGIN = "https://peaks.heliodex.cf"

/** Timelapse id taken from the `/{id}` path (empty on the `/home` landing). */
const submittedId = $derived(page.params.id ?? "")

// Bound to the input; typed edits override it until the path id changes.
let timelapseId = $derived(page.params.id ?? "")
let videoEl = $state<HTMLVideoElement>()
let selections = $state<TimelineSelection[]>([])
let idleRanges = $state<IdleRange[]>([])
let idleAnalyzing = $state(false)
// When set, idle detection is ignored entirely for the actual-time maths.
let ignoreIdle = $state(false)

function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "—"
	const total = Math.round(seconds)
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const secs = total % 60
	if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
	if (minutes > 0) return `${minutes}m ${secs}s`
	return `${secs}s`
}

function formatCreatedAt(timestamp: number): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown"
	// Lapse returns a Unix timestamp; accept either seconds or milliseconds.
	const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
	return new Date(ms).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	})
}

const sortedSelections = $derived(
	[...selections].sort((a, b) => a.start - b.start)
)

/** Idle ranges that count towards the maths (none while overridden). */
const effectiveIdleRanges = $derived(ignoreIdle ? [] : idleRanges)

/** Time removed from the actual duration by the chosen annotation reasons, in recorded seconds. */
const annotationDeflation = $derived(
	selections.reduce((sum, selection) => {
		const reason = findAnnotationReason(selection.reason)
		if (!reason) return sum
		return (
			sum +
			nonIdleDuration(selection, effectiveIdleRanges) * reason.deflation
		)
	}, 0) * PLAYBACK_TO_RECORDED
)

/** Time removed from the actual duration as idle, in recorded seconds. */
const idleDuration = $derived(
	effectiveIdleRanges.reduce(
		(sum, range) => sum + (range.end - range.start),
		0
	) * PLAYBACK_TO_RECORDED
)

function setSelectionReason(id: string, reason: string) {
	selections = selections.map(selection =>
		selection.id === id ? { ...selection, reason } : selection
	)
}

// Copy-to-clipboard feedback for the description card.
let copied = $state(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		copied = true
		clearTimeout(copyTimer)
		copyTimer = setTimeout(() => {
			copied = false
		}, 1500)
	} catch {
		// Clipboard access may be denied; leave the button unchanged.
	}
}

$effect(() => {
	return () => clearTimeout(copyTimer)
})

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
		ignoreIdle = false
		loaded = true
		return
	}
	const shared = new URL(window.location.href).searchParams.get(SHARE_PARAM)
	if (shared) {
		void decodeShare(shared).then(decoded => {
			if (token !== loadToken) return
			selections = decoded?.selections ?? loadSelections(id)
			ignoreIdle = decoded?.ignoreIdle ?? loadIgnoreIdle(id)
			loaded = true
		})
	} else {
		selections = loadSelections(id)
		ignoreIdle = loadIgnoreIdle(id)
		loaded = true
	}
})

function loadTimelapse(event: SubmitEvent) {
	event.preventDefault()
	loadId(timelapseId)
}

function loadId(value: string) {
	const id = value.trim()
	if (!id || id === submittedId) return
	void goto(`/${encodeURIComponent(id)}`)
}

async function pasteAndLoad() {
	let text = ""
	try {
		text = await navigator.clipboard.readText()
	} catch {
		return
	}
	loadId(text)
}

// Guards against an older async encode resolving after a newer one.
let urlToken = 0

async function syncShareUrl(
	id: string,
	value: TimelineSelection[],
	ignoreIdle: boolean
) {
	const token = ++urlToken
	// Nothing to store? Drop the parameter entirely rather than writing an
	// encoded empty payload.
	const encoded =
		value.length > 0 || ignoreIdle
			? await encodeShare(value, ignoreIdle)
			: null
	if (token !== urlToken) return
	const url = new URL(window.location.href)
	if (encoded) {
		url.searchParams.set(SHARE_PARAM, encoded)
	} else {
		url.searchParams.delete(SHARE_PARAM)
	}
	url.pathname = `/${encodeURIComponent(id)}`
	const target = `${url.pathname}${url.search}`
	if (target === `${window.location.pathname}${window.location.search}`)
		return
	await goto(target, {
		replace: true,
		shallow: true,
		reset: false,
	})
}

// Persist selections (and their reasons) per timelapse, and mirror the review
// state into the `?tl=` parameter so it can be shared.
$effect(() => {
	const id = submittedId
	const value = $state.snapshot(selections)
	const overridden = ignoreIdle
	if (!id || !loaded) return
	saveSelections(id, value)
	const timer = setTimeout(() => {
		void syncShareUrl(id, value, overridden)
	}, 300)
	return () => clearTimeout(timer)
})

// Persist the idle override for this timelapse.
$effect(() => {
	const id = submittedId
	if (!id || !loaded) return
	saveIgnoreIdle(id, ignoreIdle)
})

// The sidebar shows one named project at a time. Its name and its list of
// timelapses live in local storage, so the group survives reloads.
let projectName = $state("Untitled project")
let projectEntries = $state<ProjectTimelapse[]>([])
let addedId = $state<string | null>(null)
let addedTimer: ReturnType<typeof setTimeout> | undefined
let draggingId = $state<string | null>(null)

// Restore the last-used project name after mount; local storage isn't available
// during SSR, so this must not run in the initial render.
$effect(() => {
	const saved = loadCurrentProject()
	if (saved) projectName = saved
})

// Switching the project name swaps the visible list.
$effect(() => {
	const name = projectName.trim()
	projectEntries = name ? loadProject(name) : []
})

/** Rename/switch the project and remember the choice. */
function selectProject(name: string) {
	projectName = name
	saveCurrentProject(name.trim())
}

$effect(() => {
	return () => clearTimeout(addedTimer)
})

/** Totals for the current project, in recorded seconds. */
const projectTotals = $derived.by(() => {
	let recorded = 0
	let idle = 0
	let annotations = 0
	let final = 0
	for (const entry of projectEntries) {
		recorded += entry.duration
		idle += entry.idleDuration
		annotations += entry.annotationDeflation
		final += Math.max(
			0,
			entry.duration - entry.idleDuration - entry.annotationDeflation
		)
	}
	return {
		recorded,
		idle,
		annotations,
		deducted: idle + annotations,
		final,
	}
})

/** Whether the timelapse currently open is already in the project. */
const inProject = $derived(
	projectEntries.some(entry => entry.id === submittedId)
)

// Keep the open timelapse's project entry in sync with its current idle time
// and annotation deductions, so edits appear without a manual update.
$effect(() => {
	const id = submittedId
	const idle = idleDuration
	const annotations = annotationDeflation
	if (!id || !loaded) return
	const index = projectEntries.findIndex(entry => entry.id === id)
	if (index === -1) return
	const entry = projectEntries[index]
	if (
		entry.idleDuration === idle &&
		entry.annotationDeflation === annotations
	) {
		return
	}
	const updated = [...projectEntries]
	updated[index] = {
		...entry,
		idleDuration: idle,
		annotationDeflation: annotations,
	}
	projectEntries = updated
	const name = projectName.trim()
	if (name) saveProject(name, $state.snapshot(updated))
})

/** Add the open timelapse to the current project. */
function addToProject(entry: ProjectTimelapse) {
	const name = projectName.trim()
	if (!name) return
	projectEntries = [
		...projectEntries.filter(item => item.id !== entry.id),
		entry,
	]
	saveProject(name, $state.snapshot(projectEntries))
	addedId = entry.id
	clearTimeout(addedTimer)
	addedTimer = setTimeout(() => {
		addedId = null
	}, 1500)
}

/** Remove a timelapse from the current project. */
function removeFromProject(id: string) {
	const name = projectName.trim()
	projectEntries = projectEntries.filter(entry => entry.id !== id)
	if (name) saveProject(name, $state.snapshot(projectEntries))
	if (addedId === id) addedId = null
}

/** Persist the current project order. */
function persistOrder() {
	const name = projectName.trim()
	if (name) saveProject(name, $state.snapshot(projectEntries))
}

/**
 * Move `sourceId` so it lands at `targetIndex` in the list. Only updates
 * state (the caller persists once the drag ends), so drag-over can call it
 * repeatedly while `animate:flip` animates each shift.
 */
function moveToIndex(sourceId: string, targetIndex: number): boolean {
	const from = projectEntries.findIndex(entry => entry.id === sourceId)
	if (from === -1) return false
	let insert = targetIndex
	if (from < insert) insert -= 1
	if (insert === from) return false
	const updated = [...projectEntries]
	const [moved] = updated.splice(from, 1)
	updated.splice(insert, 0, moved)
	projectEntries = updated
	return true
}

// Reordering on every dragover would thrash the FLIP animations, so wait for
// the current shift to settle before allowing the next one.
const REORDER_COOLDOWN = 160
let lastReorder = 0

/** Reorder the dragged entry from the pointer's vertical position. */
function reorderFromPointer(event: DragEvent, force: boolean) {
	if (!draggingId) return
	if (!force && performance.now() - lastReorder < REORDER_COOLDOWN) return
	const list = event.currentTarget as HTMLElement
	const items = Array.from(list.children) as HTMLElement[]
	let targetIndex = items.length
	for (let i = 0; i < items.length; i++) {
		const rect = items[i].getBoundingClientRect()
		if (event.clientY < rect.top + rect.height / 2) {
			targetIndex = i
			break
		}
	}
	if (moveToIndex(draggingId, targetIndex)) {
		lastReorder = performance.now()
	}
}

/** Live-reorder while the pointer moves over the list. */
function handleDragOver(event: DragEvent) {
	if (!draggingId) return
	event.preventDefault()
	if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
	reorderFromPointer(event, false)
}

/** Finish a drag, keeping whatever order the pointer reached. */
function handleDrop(event: DragEvent) {
	event.preventDefault()
	reorderFromPointer(event, true)
	draggingId = null
	persistOrder()
}

/** Nudge an entry by one slot, for keyboard reordering. */
function moveEntryBy(id: string, delta: number) {
	const from = projectEntries.findIndex(entry => entry.id === id)
	if (from === -1) return
	const to = from + delta
	if (to < 0 || to >= projectEntries.length) return
	const updated = [...projectEntries]
	const [moved] = updated.splice(from, 1)
	updated.splice(to, 0, moved)
	projectEntries = updated
	persistOrder()
}
</script>

<main class="flex min-h-screen flex-col">
	<header class="flex items-start justify-between gap-4 p-4">
		<div class="flex flex-col gap-3">
			<svelte:boundary>
				{#snippet pending()}
					<p>Loading profile…</p>
				{/snippet}

				{const profile = $derived(await getLapseData())}
				{#if profile}
					<div class="flex items-center gap-3">
						<img
							src={profile.profilePictureUrl}
							alt={profile.displayName}
							class="h-12 w-12 rounded-full object-cover"
						>
						<div class="flex flex-col">
							<span class="font-medium"
								>{profile.displayName}</span
							>
							<span class="text-sm">@{profile.handle}</span>
						</div>
					</div>
				{/if}
			</svelte:boundary>

			<form class="flex items-center gap-2" onsubmit={loadTimelapse}>
				<label class="flex items-center gap-2">
					<span class="text-sm">Timelapse ID</span>
					<input
						type="text"
						name="timelapseId"
						placeholder="Enter timelapse ID"
						bind:value={timelapseId}
						class="border border-neutral-500 px-2 py-1"
					>
				</label>
				<button
					type="submit"
					disabled={!timelapseId.trim()}
					class="border border-neutral-500 px-2 py-1 disabled:opacity-50"
				>
					Load
				</button>
				<button
					type="button"
					onclick={pasteAndLoad}
					class="border border-neutral-500 px-2 py-1"
				>
					Paste
				</button>
			</form>

			{#if submittedId}
				<p class="text-sm">Viewing: {submittedId}</p>
			{/if}
		</div>

		<form {...logout}>
			<button
				type="submit"
				class="border border-neutral-500 px-2 py-1"
			>
				Log out
			</button>
		</form>
	</header>

	<div
		class="flex flex-1 flex-col items-start justify-center gap-4 p-4 lg:flex-row"
	>
		<section class="flex w-full flex-1 items-start justify-center">
			{#if submittedId}
			{#key submittedId}
				<svelte:boundary>
					{#snippet pending()}
						<p>Loading timelapse…</p>
					{/snippet}

					{#snippet failed(error: unknown, reset: () => void)}
						<div class="flex flex-col items-center gap-2">
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
						</div>
					{/snippet}

					{const timelapse = await getTimelapse(submittedId)}
					{#if timelapse}
						{const actualDuration = $derived(
							Math.max(
								0,
								timelapse.duration -
									idleDuration -
									annotationDeflation
							)
						)}
						{const description = $derived(
							describeTimelapse({
								id: timelapse.id,
								duration: timelapse.duration,
								idleRanges: effectiveIdleRanges,
								selections,
								shareUrl: `${SITE_ORIGIN}${page.url.pathname}${page.url.search}`,
							})
						)}
						<div
							class="flex w-full max-w-5xl flex-col items-left gap-4"
						>
							{#if timelapse.playbackUrl}
								<video
									src={timelapse.playbackUrl}
									poster={timelapse.thumbnailUrl ?? undefined}
									controls
									preload="metadata"
									bind:this={videoEl}
									class="max-h-[70vh] w-full"
								>
									<track kind="captions">
								</video>
								{#if videoEl}
									<Timeline
										bind:selections
										bind:idleRanges
										bind:idleAnalyzing
										{ignoreIdle}
										timelapse={{
											playbackUrl: timelapse.playbackUrl,
											thumbnailUrl: timelapse.thumbnailUrl,
										}}
										video={videoEl}
									/>
									{#if sortedSelections.length > 0}
										<ul
											class="flex flex-col gap-1 pt-2 text-sm"
										>
											{#each sortedSelections as sel, i (sel.id)}
												{const reason = $derived(
													findAnnotationReason(
														sel.reason
													)
												)}
												<li
													class="flex flex-wrap items-center gap-2"
												>
													<span>
														Selection {i + 1}:
														<span
															class="font-medium"
															>{formatClock(
																sel.start
															)}</span
														>-<span
															class="font-medium"
															>{formatClock(
																sel.end
															)}</span
														>
													</span>
													<select
														aria-label="Annotation reason for selection {i +
															1}"
														value={sel.reason ?? ""}
														onchange={e =>
															setSelectionReason(
																sel.id,
																e.currentTarget
																	.value
															)}
														class="border border-neutral-500 bg-neutral-800 px-1 py-0.5 text-sm"
													>
														<option value="">
															Select a reason…
														</option>
														{#each ANNOTATION_REASONS as annotation (annotation.id)}
															<option
																value={annotation.id}
															>
																{annotation.label}
															</option>
														{/each}
													</select>
													{#if reason && reason.deflation > 0}
														<span
															class="text-xs text-neutral-500"
														>
															-{formatDuration(
																nonIdleDuration(
																	sel,
																	effectiveIdleRanges
																) *
																	reason.deflation *
																	PLAYBACK_TO_RECORDED
															)}
														</span>
													{/if}
												</li>
											{/each}
										</ul>
									{:else}
										<p
											class="pt-2 text-sm text-neutral-500"
										>
											Drag across the timeline to select
											an annotation.
										</p>
									{/if}
									{#if idleRanges.length > 0 || ignoreIdle}
										<div
											class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500"
										>
											<label
												class="flex items-center gap-1.5"
											>
												<input
													type="checkbox"
													bind:checked={ignoreIdle}
													class="h-3.5 w-3.5 accent-blue-500"
												>
												Ignore idle time
											</label>
											{#if !ignoreIdle}
												<p
													class="flex items-center gap-2"
												>
													<span
														class="inline-block h-2 w-3 border border-amber-400/50 bg-amber-400/25"
													></span>
													Amber regions have no visual
													changes (time spent away).
												</p>
											{/if}
										</div>
									{/if}
								{/if}
							{:else}
								<p>
									This timelapse is still being processed and
									has no video yet.
								</p>
							{/if}

							<div
								class="flex items-center justify-end gap-2"
							>
								{#if addedId === timelapse.id}
									<span class="text-xs text-green-500"
										> Added to project </span
									>
								{/if}
								<button
									type="button"
									disabled={!projectName.trim()}
									onclick={() =>
										inProject
											? removeFromProject(timelapse.id)
											: addToProject({
													id: timelapse.id,
													name: timelapse.name,
													duration: timelapse.duration,
													idleDuration,
													annotationDeflation,
												})}
									class="border border-neutral-500 px-3 py-1 text-sm hover:bg-neutral-800 disabled:opacity-50"
								>
									{inProject
										? "Remove from project"
										: "Add to project"}
								</button>
							</div>

							<dl
								class="grid w-full grid-cols-2 gap-3 sm:grid-cols-4"
							>
								<div
									class="border border-neutral-500 p-3"
								>
									<dt
										class="text-xs uppercase tracking-wide text-neutral-500"
									>
										Recorded
									</dt>
									<dd class="pt-1 font-medium">
										{formatDuration(timelapse.duration)}
									</dd>
								</div>
								<div
									class="border border-neutral-500 p-3"
								>
									<dt
										class="text-xs uppercase tracking-wide text-neutral-500"
									>
										Actual time
									</dt>
									<dd class="pt-1 font-medium">
										{formatDuration(actualDuration)}
									</dd>
									{#if idleAnalyzing && !ignoreIdle}
										<p
											class="pt-0.5 text-xs text-amber-600"
										>
											Analyzing idle frames…
										</p>
									{:else}
										{#if idleDuration > 0}
											<p
												class="pt-0.5 text-xs text-neutral-500"
											>
												-{formatDuration(idleDuration)}
												idle
											</p>
										{/if}
										{#if annotationDeflation > 0}
											<p
												class="pt-0.5 text-xs text-neutral-500"
											>
												-{formatDuration(
													annotationDeflation
												)}
												annotations
											</p>
										{/if}
									{/if}
								</div>
								<div
									class="border border-neutral-500 p-3"
								>
									<dt
										class="text-xs uppercase tracking-wide text-neutral-500"
									>
										Created
									</dt>
									<dd class="pt-1 font-medium">
										{formatCreatedAt(timelapse.createdAt)}
									</dd>
								</div>
								<div
									class="border border-neutral-500 p-3"
								>
									<dt
										class="text-xs uppercase tracking-wide text-neutral-500"
									>
										Visibility
									</dt>
									<dd class="pt-1 font-medium">
										{timelapse.visibility}
									</dd>
								</div>
							</dl>
							<section
								class="w-full border border-neutral-500 p-3"
							>
								<div
									class="flex items-center justify-between gap-2 pb-1"
								>
									<h2 class="font-medium">Description</h2>
									<button
										type="button"
										onclick={() => copyText(description)}
										class="border border-neutral-500 px-2 py-0.5 text-xs hover:bg-neutral-800"
									>
										{copied ? "Copied!" : "Copy"}
									</button>
								</div>
								<p class="text-sm text-neutral-300 select-text">
									{description}
								</p>
							</section>
						</div>
					{:else}
						<p>No timelapse found for ID “{submittedId}”.</p>
					{/if}
				</svelte:boundary>
			{/key}
		{:else}
			<p class="text-center">
				Enter a timelapse ID above to review it here.
			</p>
		{/if}
		</section>

		<aside
			class="sticky top-4 flex w-full flex-col gap-3 border border-neutral-500 p-3 lg:w-72 lg:shrink-0"
		>
			<h2 class="font-medium">Project</h2>

			<label class="flex flex-col gap-1 text-sm">
				<span class="text-xs uppercase tracking-wide text-neutral-500">
					Name
				</span>
				<input
					type="text"
					value={projectName}
					onchange={e => selectProject(e.currentTarget.value)}
					placeholder="Untitled project"
					class="border border-neutral-500 px-2 py-1"
				>
			</label>

			{#if projectEntries.length > 0}
				<ul
					class="flex flex-col gap-1 text-sm"
					ondragover={handleDragOver}
					ondrop={handleDrop}
				>
					{#each projectEntries as entry (entry.id)}
						<li
							animate:flip={{ duration: 180 }}
							class="flex items-start gap-2 border-b border-neutral-800 pb-1 {draggingId ===
							entry.id
								? 'opacity-50'
								: ''}"
						>
							<button
								type="button"
								draggable="true"
								title="Drag to reorder"
								aria-label="Reorder {entry.name || entry.id}"
								onkeydown={e => {
									if (e.key === "ArrowUp") {
										e.preventDefault()
										moveEntryBy(entry.id, -1)
									} else if (e.key === "ArrowDown") {
										e.preventDefault()
										moveEntryBy(entry.id, 1)
									}
								}}
								ondragstart={e => {
									draggingId = entry.id
									if (e.dataTransfer) {
										const row =
											e.currentTarget.closest("li")
										e.dataTransfer.effectAllowed = "move"
										e.dataTransfer.setData(
											"text/plain",
											entry.id
										)
										if (row) {
											const rect =
												row.getBoundingClientRect()
											e.dataTransfer.setDragImage(
												row,
												e.clientX - rect.left,
												e.clientY - rect.top
											)
										}
									}
								}}
								ondragend={() => {
									draggingId = null
									persistOrder()
								}}
								class="cursor-grab select-none text-neutral-500 hover:text-neutral-300 active:cursor-grabbing"
							>
								⠿
							</button>
							<div class="flex min-w-0 flex-1 flex-col">
								<button
									type="button"
									onclick={() => loadId(entry.id)}
									title={entry.name || entry.id}
									class="w-full cursor-pointer truncate text-left hover:underline {entry.id ===
									submittedId
										? 'font-medium text-blue-400'
										: ''}"
								>
									{entry.name || entry.id}
								</button>
								<span class="text-xs text-neutral-500">
									{formatDuration(
										Math.max(
											0,
											entry.duration -
												entry.idleDuration -
												entry.annotationDeflation
										)
									)}
								</span>
							</div>
							<button
								type="button"
								onclick={() => removeFromProject(entry.id)}
								aria-label="Remove {entry.name ||
									entry.id} from project"
								class="text-xs text-neutral-500 hover:text-red-500"
							>
								✕
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-neutral-500">
					No timelapses yet. Open one and use “Add to project”.
				</p>
			{/if}

			<dl class="flex flex-col gap-1 border-t border-neutral-700 pt-2 text-sm">
				<div class="flex justify-between gap-2">
					<dt class="text-neutral-500">Time spent working</dt>
					<dd class="font-medium">
						{formatDuration(projectTotals.recorded)}
					</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-neutral-500">Time deducted</dt>
					<dd class="font-medium">
						{formatDuration(projectTotals.deducted)}
					</dd>
				</div>
				{#if projectTotals.idle > 0}
					<div class="flex justify-between gap-2 pl-3 text-xs">
						<dt class="text-neutral-500">Idle</dt>
						<dd>{formatDuration(projectTotals.idle)}</dd>
					</div>
				{/if}
				{#if projectTotals.annotations > 0}
					<div class="flex justify-between gap-2 pl-3 text-xs">
						<dt class="text-neutral-500">Annotations</dt>
						<dd>{formatDuration(projectTotals.annotations)}</dd>
					</div>
				{/if}
				<div class="flex justify-between gap-2 border-t border-neutral-800 pt-1">
					<dt class="font-medium">Final time</dt>
					<dd class="font-medium">
						{formatDuration(projectTotals.final)}
					</dd>
				</div>
			</dl>
		</aside>
	</div>
</main>
