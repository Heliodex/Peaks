<script lang="ts">
import { prefersReducedMotion } from "svelte/motion"
import type { Project } from "#lib/project-storage.js"

let {
	projects,
	mode,
	active,
	expandedProjectId,
	currentProjectId,
	onOpen,
	onExpand,
	onHover,
}: {
	projects: Project[]
	mode: "projects" | "timelapses"
	active: number
	expandedProjectId: string | null
	currentProjectId: string
	onOpen: (project: Project) => void
	onExpand: (project: Project) => void
	onHover: (index: number) => void
} = $props()

// Motion is skipped for reduced-motion users.
const scrollBehavior = $derived(
	prefersReducedMotion.current ? "auto" : "smooth"
)

function scrollProjectIntoView(node: HTMLDivElement) {
	if (mode !== "projects" || projects.length === 0) return
	node.children[active]?.scrollIntoView({
		block: "nearest",
		behavior: scrollBehavior,
	})
}
</script>

<div
	class="flex min-h-0 flex-col overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none {mode ===
	"timelapses"
		? 'w-2/5 shrink-0 border-r border-neutral-700'
		: 'w-full'}"
>
	<div
		class="min-h-0 overflow-y-auto py-1"
		role="listbox"
		aria-label="Projects"
		{@attach scrollProjectIntoView}
	>
		{#each projects as project, index (project.id)}
			{const selected =
				mode === "projects"
					? index === active
					: project.id === expandedProjectId}
			<div
				role="presentation"
				class="flex h-9 items-center {selected
					? 'bg-primary-600/30'
					: ''}"
			>
				<button
					type="button"
					role="option"
					aria-selected={selected}
					onclick={() => onOpen(project)}
					onpointermove={() => {
						if (mode === "projects" && active !== index)
							onHover(index)
					}}
					class="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left text-sm"
				>
					<span
						class="truncate {project.id === currentProjectId
							? 'font-medium text-primary-400'
							: ''}"
					>
						{project.name}
					</span>
					<span class="shrink-0 text-xs text-neutral-500">
						{project.timelapses.length}
					</span>
				</button>
				{#if mode === "projects" && project.timelapses.length > 0}
					<button
						type="button"
						onclick={() => onExpand(project)}
						title="Show timelapses"
						aria-label="Show timelapses for {project.name}"
						class="shrink-0 cursor-pointer p-2 pr-4 text-sm text-neutral-500 hover:text-white"
					>
						›
					</button>
				{/if}
			</div>
		{:else}
			<div class="px-3 py-2 text-sm text-neutral-500">
				No projects found
			</div>
		{/each}
	</div>
</div>
