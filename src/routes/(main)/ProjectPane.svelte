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
	projectName = "",
	projectEntries = [],
	submittedId,
	projectTotals,
	projectDescription,
	onLoad,
	onRemoveTimelapse,
	onRenameProject,
	onReorderProject,
	onSelectProject,
	onCreateProject,
	onRemoveProject,
}: {
	projects: Project[]
	currentProjectId: string
	projectName: string
	projectEntries: ProjectTimelapse[]
	submittedId: string
	projectTotals: ProjectTotals
	projectDescription: string
	onLoad: (id: string) => void
	onRemoveTimelapse: (id: string) => void
	onRenameProject: (name: string) => void
	onReorderProject: (entries: ProjectTimelapse[]) => void
	onSelectProject: (id: string) => void
	onCreateProject: () => void
	onRemoveProject: (id: string) => void
} = $props()

let draggingId = $state<string | null>(null)

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
				class="flex items-center gap-2 border-b border-neutral-800 pb-1"
			>
				{#if project.id === currentProjectId}
					<span
						class="min-w-0 flex-1 truncate font-medium text-blue-400"
						title={project.name}
						aria-current="true"
					>
						{project.name}
					</span>
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
						class="shrink-0 cursor-pointer border border-neutral-500 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-red-500 hover:text-red-500"
					>
						×
					</button>
				{/if}
			</li>
		{/each}
	</ul>

	<label class="flex flex-col gap-1 border-t border-neutral-700 pt-3 text-sm">
		<span class="text-xs uppercase tracking-wide text-neutral-500">
			Name
		</span>
		<input
			type="text"
			value={projectName}
			onchange={e => onRenameProject(e.currentTarget.value)}
			placeholder={DEFAULT_PROJECT_NAME}
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
						class="shrink-0 cursor-pointer border border-neutral-500 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-red-500 hover:text-red-500"
					>
						×
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-neutral-500">
			No timelapses yet. Open one to add it to this project.
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
