<script lang="ts">
import { DEFAULT_PROJECT_NAME, type Project } from "#lib/project-storage.js"
import ContextMenu, { contextMenuPosition } from "./ContextMenu.svelte"

let {
	projects,
	currentProjectId,
	focusNameId = null,
	onRenameProject,
	onSelectProject,
	onRemoveProject,
	onNameFocused,
}: {
	projects: Project[]
	currentProjectId: string
	/** Project whose name field should take focus, set right after creating one. */
	focusNameId?: string | null
	onRenameProject: (id: string, name: string) => void
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

<ul class="flex flex-col gap-1 text-sm">
	{#each projects as project (project.id)}
		<li
			oncontextmenu={event => openMenu(event, project)}
			class="project-row -mx-1.5 flex items-center gap-2 border-b border-line-soft px-1.5 py-0.5 transition-colors hover:bg-neutral-800/40"
		>
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
					class="field flex-1 border-l-2 border-l-primary-500 px-1.5 py-0.5 font-medium text-primary-300"
				>
			{:else}
				<button
					type="button"
					onclick={() => onSelectProject(project.id)}
					title={project.name}
					class={[
						"min-w-0 flex-1 cursor-pointer truncate border-l-2 px-1.5 py-0.5 text-left transition-colors",
						project.id === currentProjectId
							? "border-l-primary-500 font-medium text-primary-300"
							: "border-l-transparent text-neutral-300 hover:border-l-primary-500/60 hover:text-white",
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
