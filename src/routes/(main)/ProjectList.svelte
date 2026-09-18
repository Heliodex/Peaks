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
			class="project-row -mx-1.5 flex items-center gap-2 border-b border-line-soft px-1.5 py-0.5 transition-colors hover:bg-neutral-800/40"
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
					class="field flex-1 border-l-2 border-l-primary-500 px-1.5 py-0.5 font-medium text-primary-300"
				>
			{:else}
				<button
					type="button"
					onclick={() => onSelectProject(project.id)}
					title={project.name}
					class="min-w-0 flex-1 cursor-pointer truncate border-l-2 border-l-transparent px-1.5 py-0.5 text-left text-neutral-300 transition-colors hover:border-l-primary-500/60 hover:text-white"
				>
					{project.name}
				</button>
				<button
					type="button"
					onclick={() => onRemoveProject(project.id)}
					title="Delete project"
					aria-label="Delete {project.name}"
					class="row-action btn btn-danger shrink-0 px-1.5 py-0.5 text-xs"
				>
					×
				</button>
			{/if}
		</li>
	{/each}
</ul>
