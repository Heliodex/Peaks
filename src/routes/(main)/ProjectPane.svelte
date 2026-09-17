<script lang="ts">
import { flip } from "svelte/animate"
import CopyButton from "#lib/components/CopyButton.svelte"
import {
	DEFAULT_PROJECT_NAME,
	type Project,
	type ProjectTimelapse,
} from "#lib/project-storage.js"
import { entryFinalDuration, formatDuration } from "./review-format.js"
import type { ProjectTotals } from "./review-types.js"

let {
	projects = [],
	currentProjectId = "",
	focusNameId = null,
	projectName = "",
	projectEntries = [],
	submittedId,
	projectTotals,
	projectDescription,
	loadError = null,
	onLoad,
	onRemoveTimelapse,
	onRenameProject,
	onReorderProject,
	onSelectProject,
	onCreateProject,
	onRemoveProject,
	onNameFocused,
}: {
	projects: Project[]
	currentProjectId: string
	/** Project whose name field should take focus, set right after creating one. */
	focusNameId?: string | null
	projectName: string
	projectEntries: ProjectTimelapse[]
	submittedId: string
	projectTotals: ProjectTotals
	projectDescription: string
	/** Validation failure from the last attempt to add a timelapse by id. */
	loadError?: string | null
	onLoad: (id: string) => void
	onRemoveTimelapse: (id: string) => void
	onRenameProject: (name: string) => void
	onReorderProject: (entries: ProjectTimelapse[]) => void
	onSelectProject: (id: string) => void
	onCreateProject: () => void
	onRemoveProject: (id: string) => void
	onNameFocused: () => void
} = $props()

let draggingId = $state<string | null>(null)

/**
 * Focus the name field when its project was just created, selecting the
 * placeholder name so it can be typed over. Attachments re-run when the state
 * they read changes, so this fires as the new input mounts (or as the request
 * arrives) and clears the request through `onNameFocused`.
 */
function focusCreatedName(node: HTMLInputElement) {
	if (!focusNameId || focusNameId !== currentProjectId) return
	node.focus()
	node.select()
	onNameFocused()
}

/**
 * Move the entry at `from` so it lands at `insert`. Only asks the parent to
 * update the order (its persistence effect saves it) so drag-over can call it
 * repeatedly while `animate:flip` animates each shift. Returns whether it moved.
 */
function moveEntryTo(from: number, insert: number): boolean {
	if (
		from === -1 ||
		insert < 0 ||
		insert >= projectEntries.length ||
		insert === from
	) {
		return false
	}
	const updated = [...projectEntries]
	const [moved] = updated.splice(from, 1)
	updated.splice(insert, 0, moved)
	onReorderProject(updated)
	return true
}

/** Move `sourceId` so it lands before the entry currently at `targetIndex`. */
function moveToIndex(sourceId: string, targetIndex: number): boolean {
	const from = projectEntries.findIndex(entry => entry.id === sourceId)
	if (from === -1) return false
	let insert = targetIndex
	if (from < insert) insert -= 1
	return moveEntryTo(from, insert)
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
}

/** Nudge an entry by one slot, for keyboard reordering. */
function moveEntryBy(id: string, delta: number) {
	const from = projectEntries.findIndex(entry => entry.id === id)
	if (from === -1) return
	moveEntryTo(from, from + delta)
}

// Editable copy of the path id. Typed edits override it; when the path id
// changes the derived value resyncs the field.
let timelapseId = $derived(submittedId)

function loadTimelapse(event: SubmitEvent) {
	event.preventDefault()
	onLoad(timelapseId)
}

/** Add the timelapse id currently on the clipboard. */
async function pasteAndLoad() {
	let text = ""
	try {
		text = await navigator.clipboard.readText()
	} catch {
		return
	}
	onLoad(text)
}
</script>

<aside
	class="area-project flex min-h-0 flex-col gap-3 overflow-y-auto border-neutral-500 p-3 lg:border-l"
>
	<div class="flex items-center justify-between">
		<h2 class="font-medium">Projects</h2>
		<button
			type="button"
			onclick={onCreateProject}
			class="cursor-pointer border border-neutral-500 px-2 py-1 text-sm hover:bg-neutral-800"
		>
			+
		</button>
	</div>

	<ul class="flex flex-col gap-1 text-sm">
		{#each projects as project (project.id)}
			<li
				class="project-row flex items-center gap-2 border-b border-neutral-800 pb-1"
			>
				{#if project.id === currentProjectId}
					<input
						type="text"
						value={projectName}
						onchange={e => onRenameProject(e.currentTarget.value)}
						{@attach focusCreatedName}
						placeholder={DEFAULT_PROJECT_NAME}
						title={project.name}
						aria-label="Project name"
						class="min-w-0 flex-1 border border-neutral-500 px-1 py-0.5 font-medium text-blue-400"
					>
				{:else}
					<button
						type="button"
						onclick={() => onSelectProject(project.id)}
						title={project.name}
						class="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline"
					>
						{project.name}
					</button>
					<button
						type="button"
						onclick={() => onRemoveProject(project.id)}
						title="Delete project"
						aria-label="Delete {project.name}"
						class="row-action shrink-0 cursor-pointer border border-neutral-500 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-red-500 hover:text-red-500"
					>
						×
					</button>
				{/if}
			</li>
		{/each}
	</ul>

	{#if projectEntries.length > 0}
		<ul
			class="flex flex-col gap-1 text-sm"
			ondragover={handleDragOver}
			ondrop={handleDrop}
		>
			{#each projectEntries as entry (entry.id)}
				<li
					animate:flip={{ duration: 180 }}
					class="entry-row flex items-start gap-2 border-b border-neutral-800 pb-1 {draggingId ===
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
								const row = e.currentTarget.closest("li")
								e.dataTransfer.effectAllowed = "move"
								e.dataTransfer.setData("text/plain", entry.id)
								if (row) {
									const rect = row.getBoundingClientRect()
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
						}}
						class="cursor-grab select-none text-neutral-500 hover:text-neutral-300 active:cursor-grabbing"
					>
						⠿
					</button>
					<div class="flex min-w-0 flex-1 flex-col">
						{#if entry.id === submittedId}
							<span
								class="w-full truncate font-medium text-blue-400"
								title={entry.name || entry.id}
								aria-current="true"
							>
								{entry.name || entry.id}
							</span>
						{:else}
							<button
								type="button"
								onclick={() => onLoad(entry.id)}
								title={entry.name || entry.id}
								class="w-full cursor-pointer truncate text-left hover:underline"
							>
								{entry.name || entry.id}
							</button>
						{/if}
						<span class="text-xs text-neutral-500">
							{formatDuration(entryFinalDuration(entry))}
						</span>
					</div>
					<button
						type="button"
						onclick={() => onRemoveTimelapse(entry.id)}
						title="Remove from project"
						aria-label="Remove {entry.name || entry.id} from project"
						class="row-action shrink-0 cursor-pointer border border-neutral-500 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-red-500 hover:text-red-500"
					>
						×
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-neutral-500">
			No timelapses yet. Add one below.
		</p>
	{/if}

	<form
		class="flex gap-2 border-t border-neutral-700 pt-3 text-sm"
		onsubmit={loadTimelapse}
	>
		<label class="flex flex-col gap-1 w-full min-w-0">
			<span class="text-xs uppercase tracking-wide text-neutral-500">
				Timelapse IDs
			</span>
			<input
				type="text"
				name="timelapseId"
				placeholder="IDs separated by spaces or commas"
				bind:value={timelapseId}
				class="border border-neutral-500 px-2 py-1"
			>
		</label>
		<div class="flex gap-2 items-end">
			<button
				type="submit"
				disabled={!timelapseId.trim()}
				class="flex-1 border border-neutral-500 px-2 py-1 disabled:opacity-50"
			>
				Load
			</button>
			<button
				type="button"
				onclick={pasteAndLoad}
				class="flex-1 border border-neutral-500 px-2 py-1"
			>
				Paste
			</button>
		</div>
	</form>
	{#if loadError}
		<p role="alert" class="text-xs text-red-400">
			{loadError}
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
		{#each projectTotals.annotations as annotation (annotation.reason.id)}
			<div class="flex justify-between gap-2 pl-3 text-xs">
				<dt class="text-neutral-500">
					{annotation.reason.label}
				</dt>
				<dd class="shrink-0">
					{formatDuration(annotation.duration)}
				</dd>
			</div>
		{/each}
		<div
			class="flex justify-between gap-2 border-t border-neutral-800 pt-1"
		>
			<dt class="font-medium">Final time</dt>
			<dd class="font-medium">
				{formatDuration(projectTotals.final)}
			</dd>
		</div>
	</dl>

	{#if projectEntries.length > 0}
		<section class="border-t border-neutral-700 pt-2">
			<div class="flex items-center justify-between gap-2 pb-1">
				<h3 class="text-xs uppercase tracking-wide text-neutral-500">
					Project description
				</h3>
				<CopyButton text={projectDescription} />
			</div>
			<p
				class="text-xs text-neutral-300 select-text whitespace-pre-wrap wrap-break-word"
			>
				{projectDescription}
			</p>
		</section>
	{/if}
</aside>

<style>
/*
 * Row actions (delete a project, remove a timelapse) stay out of the way until
 * the row is hovered or a control inside it takes keyboard focus. While hidden
 * they collapse to nothing (and cancel the row's gap) so the row's text can use
 * the full width. They're only hidden on devices that can hover, so touch users
 * always see them.
 */
.row-action {
	transition:
		width 120ms ease,
		padding 120ms ease,
		border-left-width 120ms ease,
		border-right-width 120ms ease,
		margin 120ms ease,
		opacity 120ms ease;
}

@media (hover: hover) {
	.project-row .row-action,
	.entry-row .row-action {
		width: 0;
		/* Pull the collapsed button over the row's gap. */
		margin-left: -0.5rem;
		padding-left: 0;
		padding-right: 0;
		/* Keep the top/bottom border so the row height stays constant. */
		border-left-width: 0;
		border-right-width: 0;
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
	}

	.project-row:hover .row-action,
	.project-row:focus-within .row-action,
	.entry-row:hover .row-action,
	.entry-row:focus-within .row-action {
		width: 1.5rem;
		margin-left: 0;
		padding-left: 0.375rem;
		padding-right: 0.375rem;
		border-left-width: 1px;
		border-right-width: 1px;
		opacity: 1;
		pointer-events: auto;
	}
}

@media (prefers-reduced-motion: reduce) {
	.row-action {
		transition: none;
	}
}
</style>
