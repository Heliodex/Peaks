<script lang="ts">
import { prefersReducedMotion } from "svelte/motion"
import type { Project } from "#lib/project-storage.js"
import { entryFinalDuration, formatDuration } from "./review-format.js"

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

// Which list the arrow keys and the search field act on. The timelapse pane
// only appears once a project has been expanded with the right arrow.
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

// Each highlight is clamped on read, so filtering can never leave it pointing
// past the end of a list that just shrank.
const activeProject = $derived(
	Math.min(projectIndex, Math.max(0, filteredProjects.length - 1))
)
const activeTimelapse = $derived(
	Math.min(timelapseIndex, Math.max(0, filteredTimelapses.length - 1))
)

// Keep the highlighted row in view as it moves — attachments re-run when the
// state they read changes. Since the index wraps, this also scrolls to the top
// or bottom when the selection crosses an end of the list. Motion is skipped
// for reduced-motion users.
const scrollBehavior = $derived(
	prefersReducedMotion.current ? "auto" : "smooth"
)

function scrollProjectIntoView(node: HTMLDivElement) {
	if (mode !== "projects" || filteredProjects.length === 0) return
	node.children[activeProject]?.scrollIntoView({
		block: "nearest",
		behavior: scrollBehavior,
	})
}

function scrollTimelapseIntoView(node: HTMLDivElement) {
	if (mode !== "timelapses" || filteredTimelapses.length === 0) return
	node.children[activeTimelapse]?.scrollIntoView({
		block: "nearest",
		behavior: scrollBehavior,
	})
}

// The search field, so collapsing (or expanding) can put the caret back in it
// after a click moves focus to a row button.
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
	}
}
</script>

<!-- Invisible backdrop: clicking anywhere outside the panel dismisses. -->
<button
	type="button"
	tabindex="-1"
	aria-label="Close search"
	onclick={onClose}
	class="fixed inset-0 z-40 cursor-default bg-black/60"
></button>
<div
	class="fixed inset-x-0 top-[12vh] z-50 mx-auto flex max-h-[70vh] w-[min(40rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-neutral-600 bg-neutral-900 shadow-2xl"
>
	<div
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Search projects and timelapses"
		onkeydown={handleKeydown}
		class="flex min-h-0 flex-col"
	>
		<div class="flex items-center gap-1 border-b border-neutral-700">
			{#if mode === "timelapses"}
				<button
					type="button"
					onclick={collapse}
					title="Back to projects"
					aria-label="Back to projects"
					class="shrink-0 cursor-pointer px-2 py-2.5 text-neutral-400 hover:text-white"
				>
					‹
				</button>
				<span
					class="max-w-[9rem] shrink-0 truncate text-sm font-medium text-blue-400"
					title={expandedProject?.name}
				>
					{expandedProject?.name}
				</span>
			{/if}
			<input
				type="text"
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
				aria-label={mode === "projects"
					? "Search projects"
					: "Search timelapses"}
				class="w-full flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-neutral-500"
			>
		</div>

		<div class="flex min-h-0">
			<div
				class="flex min-h-0 flex-col {mode === "timelapses"
					? "w-2/5 shrink-0 border-r border-neutral-700"
					: "w-full"}"
			>
				<div
					class="min-h-0 overflow-y-auto py-1"
					role="listbox"
					aria-label="Projects"
					{@attach scrollProjectIntoView}
				>
					{#each filteredProjects as project, index (project.id)}
						{@const selected =
							mode === "projects"
								? index === activeProject
								: project.id === expandedProjectId}
						<div
							role="presentation"
							class="flex items-center {selected
								? 'bg-blue-600/30'
								: ''}"
						>
							<button
								type="button"
								role="option"
								aria-selected={selected}
								onclick={() => openProject(project)}
								onmouseenter={() => {
									if (mode === "projects") projectIndex = index
								}}
								class="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left text-sm"
							>
								<span
									class="truncate {project.id ===
									currentProjectId
										? 'font-medium text-blue-400'
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
									onclick={() => expand(project)}
									title="Show timelapses"
									aria-label="Show timelapses for {project.name}"
									class="shrink-0 cursor-pointer px-2 py-2 text-neutral-500 hover:text-white"
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

			{#if mode === "timelapses"}
				<div class="flex min-h-0 flex-1 flex-col">
					<div
						class="min-h-0 overflow-y-auto py-1"
						role="listbox"
						aria-label="Timelapses"
						{@attach scrollTimelapseIntoView}
					>
						{#each filteredTimelapses as entry, index (entry.id)}
							<button
								type="button"
								role="option"
								aria-selected={index === activeTimelapse}
								onclick={() => openTimelapse(entry.id)}
								onmouseenter={() => (timelapseIndex = index)}
								class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm {index ===
								activeTimelapse
									? 'bg-blue-600/30'
									: ''}"
							>
								<span
									class="truncate {entry.id === currentTimelapseId
										? 'font-medium text-blue-400'
										: ''}"
								>
									{entry.name || entry.id}
								</span>
								<span class="shrink-0 text-xs text-neutral-500">
									{formatDuration(entryFinalDuration(entry))}
								</span>
							</button>
						{:else}
							<div class="px-3 py-2 text-sm text-neutral-500">
								No timelapses in this project
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
