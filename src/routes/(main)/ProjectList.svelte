<script lang="ts">
import { flip } from "svelte/animate"
import { prefersReducedMotion } from "svelte/motion"
import { fly } from "svelte/transition"
import { DEFAULT_PROJECT_NAME, type Project } from "#lib/project-storage.js"
import ContextMenu, { contextMenuPosition } from "./ContextMenu.svelte"
import { ListReorder } from "./list-reorder.svelte.js"

let {
	projects,
	currentProjectId,
	focusNameId = null,
	onRenameProject,
	onReorderProjects,
	onSelectProject,
	onRemoveProject,
	onNameFocused,
}: {
	projects: Project[]
	currentProjectId: string
	/** Project whose name field should take focus, set right after creating one. */
	focusNameId?: string | null
	onRenameProject: (id: string, name: string) => void
	onReorderProjects: (projects: Project[]) => void
	onSelectProject: (id: string) => void
	onRemoveProject: (id: string) => void
	onNameFocused: () => void
} = $props()

// Which project is being renamed inline, if any.
let renamingId = $state<string | null>(null)
let menu = $state<{ id: string; name: string; x: number; y: number } | null>(
	null
)
// Focus to restore when the menu is dismissed with Escape.
let previousFocus: HTMLElement | null = null

// Drag-and-drop / keyboard reordering of the projects.
const reorder = new ListReorder(
	() => projects,
	updated => onReorderProjects(updated)
)

// Rows fade and slide in and out; instant for reduced-motion users. Transitions are local, so switching projects doesn't animate them.
const rowTransition = $derived(
	prefersReducedMotion.current ? { duration: 0 } : { duration: 150, y: -6 }
)

// A freshly created project asks for its name field; start renaming it so the request isn't lost.
$effect(() => {
	if (focusNameId) renamingId = focusNameId
})

/** Focus and select the name when its field mounts so it can be typed over. */
function focusNameField(node: HTMLInputElement) {
	node.focus()
	node.select()
	onNameFocused()
}

function startRename(id: string) {
	renamingId = id
}

/** Persist the typed name and stop editing that project. */
function commitRename(id: string, name: string) {
	onRenameProject(id, name)
	if (renamingId === id) renamingId = null
}

/** Stop editing without saving (the change event already saves when the text differs). */
function stopRename(id: string) {
	if (renamingId === id) renamingId = null
}

/** Open a project's context menu at the pointer, or beside the row when triggered from the keyboard. */
function openMenu(event: MouseEvent, project: Project) {
	event.preventDefault()
	previousFocus = document.activeElement as HTMLElement | null
	menu = {
		id: project.id,
		name: project.name,
		...contextMenuPosition(event),
	}
}

function closeMenu(restoreFocus = false) {
	menu = null
	if (restoreFocus) previousFocus?.focus()
}
</script>

<ul
	class="flex flex-col gap-1 text-sm"
	ondragover={reorder.onDragOver}
	ondrop={reorder.onDrop}
>
	{#each projects as project (project.id)}
		<li
			animate:flip={{ duration: 180 }}
			in:fly={rowTransition}
			out:fly={rowTransition}
			oncontextmenu={event => openMenu(event, project)}
			class={[
				"project-row -mx-1.5 flex items-center gap-1 border-b border-l-2 border-line-soft px-1.5 py-0.5 transition-colors hover:bg-neutral-800/40",
				project.id === currentProjectId
					? "border-l-primary-500"
					: "border-l-transparent",
				reorder.draggingId === project.id ? "opacity-50" : "",
			]}
		>
			{#if projects.length > 1}
				<button
					type="button"
					draggable="true"
					title="Drag to reorder"
					aria-label="Reorder {project.name}"
					onkeydown={reorder.gripKeydown(project.id)}
					ondragstart={event => reorder.startDrag(event, project.id)}
					ondragend={reorder.endDrag}
					class="flex cursor-grab items-center px-0.5 select-none text-neutral-500 transition-colors hover:text-neutral-300 active:cursor-grabbing"
				>
					⠿
				</button>
			{/if}
			{#if renamingId === project.id}
				<input
					type="text"
					value={project.name}
					onchange={e => commitRename(project.id, e.currentTarget.value)}
					onblur={() => stopRename(project.id)}
					onkeydown={e => {
						if (e.key === "Escape") {
							e.preventDefault()
							stopRename(project.id)
						} else if (e.key === "Enter") {
							e.preventDefault()
							commitRename(project.id, e.currentTarget.value)
						}
					}}
					{@attach focusNameField}
					placeholder={DEFAULT_PROJECT_NAME}
					title={project.name}
					aria-label="Project name"
					class="field flex-1 px-1.5 py-0.5 font-medium text-primary-300"
				>
			{:else}
				<button
					type="button"
					onclick={() => onSelectProject(project.id)}
					title={project.name}
					class={[
						"min-w-0 flex-1 cursor-pointer truncate px-1.5 py-0.5 text-left transition-colors",
						project.id === currentProjectId
							? "font-medium text-primary-300"
							: "text-neutral-300 hover:text-white",
					]}
				>
					{project.name}
				</button>
			{/if}
		</li>
	{/each}
</ul>

{#if menu}
	{const current = menu}
	<ContextMenu
		x={current.x}
		y={current.y}
		label="{current.name} actions"
		onClose={closeMenu}
		items={[
			{ label: "Rename", onSelect: () => startRename(current.id) },
			{
				label: "Delete project",
				danger: true,
				onSelect: () => onRemoveProject(current.id),
			},
		]}
	/>
{/if}
