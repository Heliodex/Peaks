<script lang="ts">
import type { Project } from "#lib/project-storage.js"

let {
	projects,
	currentProjectId,
	onSelect,
	onClose,
}: {
	projects: Project[]
	currentProjectId: string
	onSelect: (id: string) => void
	onClose: () => void
} = $props()

// The filter text and the user's chosen row. The dialog is mounted only while
// open, so both start clean every time it appears.
let query = $state("")
let activeIndex = $state(0)

/** Projects matching the query, kept in their stored order. */
const matches = $derived.by(() => {
	const needle = query.trim().toLowerCase()
	if (!needle) return projects
	return projects.filter(project =>
		project.name.toLowerCase().includes(needle)
	)
})

// `activeIndex` is clamped on read, so it can never point past a list that
// filtering has shrunk underneath the user.
const active = $derived(Math.min(activeIndex, Math.max(0, matches.length - 1)))

/** Focus the search field as soon as it mounts. */
function autofocus(node: HTMLInputElement) {
	node.focus()
}

/** Move the highlight by `step`, wrapping around at either end. */
function move(step: number) {
	if (matches.length === 0) return
	activeIndex = (active + step + matches.length) % matches.length
}

/** Open the project at `index`, then dismiss the dialog. */
function choose(index: number) {
	const project = matches[index]
	if (!project) return
	onSelect(project.id)
	onClose()
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "ArrowDown") {
		event.preventDefault()
		move(1)
	} else if (event.key === "ArrowUp") {
		event.preventDefault()
		move(-1)
	} else if (event.key === "Enter") {
		event.preventDefault()
		choose(active)
	} else if (event.key === "Escape") {
		event.preventDefault()
		onClose()
	}
}
</script>

<!-- Invisible backdrop: clicking anywhere outside the panel dismisses. -->
<button
	type="button"
	tabindex="-1"
	aria-label="Close project search"
	onclick={onClose}
	class="fixed inset-0 z-40 cursor-default bg-black/60"
></button>
<div
	class="fixed inset-x-0 top-[12vh] z-50 mx-auto flex max-h-[70vh] w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-neutral-600 bg-neutral-900 shadow-2xl"
>
	<div
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Search projects"
		onkeydown={handleKeydown}
		class="flex min-h-0 flex-col"
	>
		<input
			type="text"
			value={query}
			oninput={event => {
				query = event.currentTarget.value
				activeIndex = 0
			}}
			{@attach autofocus}
			placeholder="Search projects…"
			aria-label="Search projects"
			class="w-full border-b border-neutral-700 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-neutral-500"
		>
		<div
			class="min-h-0 overflow-y-auto py-1"
			role="listbox"
			aria-label="Projects"
		>
			{#each matches as project, index (project.id)}
				<button
					type="button"
					role="option"
					aria-selected={index === active}
					onclick={() => choose(index)}
					onmouseenter={() => (activeIndex = index)}
					class="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm {index ===
					active
						? 'bg-blue-600/30'
						: ''}"
				>
					<span
						class="truncate {project.id === currentProjectId
							? 'font-medium text-blue-400'
							: ''}"
					>
						{project.name}
					</span>
					<span class="shrink-0 text-xs text-neutral-500">
						{project.timelapses.length}
						{project.timelapses.length === 1
							? "timelapse"
							: "timelapses"}
					</span>
				</button>
			{:else}
				<div class="px-3 py-2 text-sm text-neutral-500">
					No projects found
				</div>
			{/each}
		</div>
	</div>
</div>
