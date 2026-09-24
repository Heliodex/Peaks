<script lang="ts">
import { prefersReducedMotion } from "svelte/motion"
import { fade, type SlideParams, scale, slide } from "svelte/transition"
import type { Project } from "#lib/project-storage.js"
import ProjectSearchProjects from "./ProjectSearchProjects.svelte"
import ProjectSearchTimelapses from "./ProjectSearchTimelapses.svelte"

let {
	projects,
	currentProjectId,
	currentTimelapseId,
	onSelect,
	onLoadTimelapse,
	onClose,
}: {
	projects: Project[]
	currentProjectId: string
	currentTimelapseId: string
	onSelect: (id: string) => void
	onLoadTimelapse: (projectId: string, timelapseId: string) => void
	onClose: () => void
} = $props()

// Which list the arrow keys and the search field act on.
// The timelapse pane only appears once a project has been expanded with the right arrow.
let mode = $state<"projects" | "timelapses">("projects")
let projectQuery = $state("")
let timelapseQuery = $state("")
let projectIndex = $state(0)
let timelapseIndex = $state(0)
let expandedProjectId = $state<string | null>(null)

const filteredProjects = $derived.by(() => {
	const needle = projectQuery.trim().toLowerCase()
	if (!needle) return projects
	return projects.filter(project =>
		project.name.toLowerCase().includes(needle)
	)
})

const expandedProject = $derived(
	projects.find(project => project.id === expandedProjectId) ?? null
)

const filteredTimelapses = $derived.by(() => {
	const entries = expandedProject?.timelapses ?? []
	const needle = timelapseQuery.trim().toLowerCase()
	if (!needle) return entries
	return entries.filter(entry =>
		(entry.name || entry.id).toLowerCase().includes(needle)
	)
})

// Each highlight is clamped on read, so filtering can never leave it pointing past the end of a list that just shrank.
const activeProject = $derived(
	Math.min(projectIndex, Math.max(0, filteredProjects.length - 1))
)
const activeTimelapse = $derived(
	Math.min(timelapseIndex, Math.max(0, filteredTimelapses.length - 1))
)

// The list the search field is driving, and the highlighted row within it, exposed to assistive tech as a combobox.
const activeListId = $derived(
	mode === "projects" ? "search-projects-list" : "search-timelapses-list"
)
const activeOptionId = $derived(
	mode === "projects"
		? filteredProjects.length > 0
			? `search-project-${activeProject}`
			: undefined
		: filteredTimelapses.length > 0
			? `search-timelapse-${activeTimelapse}`
			: undefined
)

// Appearance animations for the timelapse pane and its breadcrumb.
// Both become instant for reduced-motion users.
const breadcrumbTransition = $derived<SlideParams>(
	prefersReducedMotion.current
		? { duration: 0 }
		: { duration: 150, axis: "x" }
)
const dialogTransition = $derived(
	prefersReducedMotion.current
		? { duration: 0 }
		: { duration: 150, start: 0.97, opacity: 0 }
)
const backdropTransition = $derived(
	prefersReducedMotion.current ? { duration: 0 } : { duration: 150 }
)

// The search field, so collapsing (or expanding) can put the caret back in it after a click moves focus to a row button.
let inputEl: HTMLInputElement | null = null

/** Focus the search field as soon as it mounts. */
function autofocus(node: HTMLInputElement) {
	inputEl = node
	node.focus()
}

/** Show `project`'s timelapses and move the keyboard into the right pane. */
function expand(project: Project) {
	expandedProjectId = project.id
	mode = "timelapses"
	timelapseQuery = ""
	timelapseIndex = 0
	// Keep the project list's highlight on it, so collapsing returns there.
	const index = filteredProjects.findIndex(item => item.id === project.id)
	if (index !== -1) projectIndex = index
	inputEl?.focus()
}

/** Hide the timelapse pane and return to the project list. */
function collapse() {
	mode = "projects"
	expandedProjectId = null
	inputEl?.focus()
}

/** Move the highlight in the active list, wrapping around at either end. */
function move(step: number) {
	if (mode === "projects") {
		if (filteredProjects.length === 0) return
		projectIndex =
			(activeProject + step + filteredProjects.length) %
			filteredProjects.length
	} else {
		if (filteredTimelapses.length === 0) return
		timelapseIndex =
			(activeTimelapse + step + filteredTimelapses.length) %
			filteredTimelapses.length
	}
}

/** Make the project the current one and close the dialog. */
function openProject(project: Project) {
	onSelect(project.id)
	onClose()
}

/** Load the given timelapse from the expanded project and close the dialog. */
function openTimelapse(timelapseId: string) {
	if (!expandedProjectId) return
	onLoadTimelapse(expandedProjectId, timelapseId)
	onClose()
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "ArrowDown") {
		event.preventDefault()
		move(1)
	} else if (event.key === "ArrowUp") {
		event.preventDefault()
		move(-1)
	} else if (event.key === "ArrowRight") {
		// Right opens the timelapse pane; in it, the caret moves normally.
		if (mode !== "projects") return
		const project = filteredProjects[activeProject]
		if (!project) return
		event.preventDefault()
		expand(project)
	} else if (event.key === "ArrowLeft") {
		// Left closes the pane; in the project list, the caret moves normally.
		if (mode !== "timelapses") return
		event.preventDefault()
		collapse()
	} else if (event.key === "Enter") {
		event.preventDefault()
		if (mode === "projects") {
			const project = filteredProjects[activeProject]
			if (project) openProject(project)
		} else {
			const entry = filteredTimelapses[activeTimelapse]
			if (entry) openTimelapse(entry.id)
		}
	} else if (event.key === "Escape") {
		event.preventDefault()
		onClose()
	} else if (event.key === "Tab") {
		// The field is the dialog's only tab stop; keep focus there so it can't wander behind the overlay.
		event.preventDefault()
		inputEl?.focus()
	}
}
</script>

<!-- Invisible backdrop: clicking anywhere outside the panel dismisses. -->
<button
	type="button"
	tabindex="-1"
	aria-label="Close search"
	onclick={onClose}
	in:fade={backdropTransition}
	out:fade={backdropTransition}
	class="fixed inset-0 z-40 cursor-default bg-black/70 backdrop-blur-sm"
></button>
<div
	in:scale={dialogTransition}
	out:scale={dialogTransition}
	class="fixed inset-x-0 top-[12vh] z-50 mx-auto flex max-h-[70vh] w-[min(40rem,calc(100vw-2rem))] flex-col overflow-hidden border border-line bg-surface shadow-2xl shadow-black/60"
>
	<div
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Search projects and timelapses"
		onkeydown={handleKeydown}
		class="flex min-h-0 flex-col"
	>
		<div class="flex h-10 items-center gap-1 border-b border-line-soft">
			{#if mode === "timelapses"}
				<div
					class="flex items-center gap-1"
					transition:slide={breadcrumbTransition}
				>
					<button
						type="button"
						tabindex="-1"
						onclick={collapse}
						title="Back to projects"
						aria-label="Back to projects"
						class="shrink-0 cursor-pointer px-2 py-2.5 text-sm text-neutral-400 transition-colors hover:text-white"
					>
						‹
					</button>
					<span
						class="max-w-36 shrink-0 truncate text-sm font-medium text-primary-300"
						title={expandedProject?.name}
					>
						{expandedProject?.name}
					</span>
				</div>
			{/if}
			<input
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls={activeListId}
				aria-activedescendant={activeOptionId}
				value={mode === "projects" ? projectQuery : timelapseQuery}
				oninput={event => {
					if (mode === "projects") {
						projectQuery = event.currentTarget.value
						projectIndex = 0
					} else {
						timelapseQuery = event.currentTarget.value
						timelapseIndex = 0
					}
				}}
				{@attach autofocus}
				placeholder={mode === "projects"
					? "Search projects…"
					: "Search timelapses…"}
				autocomplete="off"
				spellcheck="false"
				aria-label={mode === "projects"
					? "Search projects"
					: "Search timelapses"}
				class="w-full flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-neutral-500"
			>
		</div>

		<div class="flex min-h-0">
			<ProjectSearchProjects
				projects={filteredProjects}
				{mode}
				active={activeProject}
				{expandedProjectId}
				{currentProjectId}
				onOpen={openProject}
				onExpand={expand}
				onHover={index => (projectIndex = index)}
			/>

			{#if mode === "timelapses"}
				<ProjectSearchTimelapses
					entries={filteredTimelapses}
					active={activeTimelapse}
					{currentTimelapseId}
					onOpen={openTimelapse}
					onHover={index => (timelapseIndex = index)}
				/>
			{/if}
		</div>

		<div
			class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft px-3 py-1.5 text-xs text-neutral-500"
		>
			<span class="flex items-center gap-1">
				<kbd>↑</kbd>
				<kbd>↓</kbd>
				navigate
			</span>
			<span class="flex items-center gap-1">
				<kbd>→</kbd>
				timelapses
			</span>
			<span class="flex items-center gap-1">
				<kbd>↵</kbd> open
			</span>
			<span class="flex items-center gap-1">
				<kbd>esc</kbd> close
			</span>
		</div>
	</div>
</div>
