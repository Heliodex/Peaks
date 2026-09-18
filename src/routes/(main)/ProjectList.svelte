<script lang="ts">
import { DEFAULT_PROJECT_NAME, type Project } from "#lib/project-storage.js"

let {
	projects,
	currentProjectId,
	projectName,
	focusNameId = null,
	onRenameProject,
	onSelectProject,
	onRemoveProject,
	onNameFocused,
}: {
	projects: Project[]
	currentProjectId: string
	projectName: string
	/** Project whose name field should take focus, set right after creating one. */
	focusNameId?: string | null
	onRenameProject: (name: string) => void
	onSelectProject: (id: string) => void
	onRemoveProject: (id: string) => void
	onNameFocused: () => void
} = $props()

/**
 * Focus the name field when its project was just created, selecting the placeholder name so it can be typed over.
 * Attachments re-run when the state they read changes, so this fires as the new input mounts (or as the request arrives) and clears the request through `onNameFocused`.
 */
function focusCreatedName(node: HTMLInputElement) {
	if (!focusNameId || focusNameId !== currentProjectId) return
	node.focus()
	node.select()
	onNameFocused()
}
</script>

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
					class="min-w-0 flex-1 border border-neutral-500 px-1 py-0.5 font-medium text-primary-400"
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
