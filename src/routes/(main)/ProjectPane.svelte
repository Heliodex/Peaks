<script lang="ts">
import type { Project, ProjectTimelapse } from "#lib/project-storage.js"
import ProjectDescription from "./ProjectDescription.svelte"
import ProjectEntries from "./ProjectEntries.svelte"
import ProjectList from "./ProjectList.svelte"
import ProjectTotalsPanel from "./ProjectTotalsPanel.svelte"
import type { ProjectTotals } from "./review-types.js"
import TimelapseAddForm from "./TimelapseAddForm.svelte"

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
</script>

<aside
	class="area-project flex min-h-0 flex-col bg-surface lg:border-l lg:border-line"
	aria-label="Project"
>
	<header
		class="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-3 py-2"
	>
		<h2 class="text-sm font-medium tracking-wide text-neutral-200">
			Projects
		</h2>
		<button
			type="button"
			onclick={onCreateProject}
			title="New project"
			aria-label="New project"
			class="btn px-1.5 py-0.5 text-xs"
		>
			+
		</button>
	</header>

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
		<ProjectList
			{projects}
			{currentProjectId}
			{projectName}
			{focusNameId}
			{onRenameProject}
			{onSelectProject}
			{onRemoveProject}
			{onNameFocused}
		/>

		{#if projectEntries.length > 0}
			<ProjectEntries
				entries={projectEntries}
				{submittedId}
				{onLoad}
				{onRemoveTimelapse}
				{onReorderProject}
			/>
		{:else}
			<p class="text-sm text-neutral-400">
				No timelapses yet. Add one below.
			</p>
		{/if}

		<TimelapseAddForm {submittedId} {loadError} {onLoad} />

		<ProjectTotalsPanel totals={projectTotals} />

		{#if projectEntries.length > 0}
			<ProjectDescription description={projectDescription} />
		{/if}
	</div>
</aside>

<style>
/*
 * Row actions (delete a project, remove a timelapse) stay out of the way until the row is hovered or a control inside it takes keyboard focus.
 * While hidden they collapse to nothing (and cancel the row's gap) so the row's text can use the full width.
 * They're only hidden on devices that can hover, so touch users always see them.
 * Rows render in child components, so these selectors are global.
 */
:global(.row-action) {
	transition:
		width 120ms ease,
		padding 120ms ease,
		border-left-width 120ms ease,
		border-right-width 120ms ease,
		margin 120ms ease,
		opacity 120ms ease;
}

@media (hover: hover) {
	:global(.project-row .row-action),
	:global(.entry-row .row-action) {
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

	:global(.project-row:hover .row-action),
	:global(.project-row:focus-within .row-action),
	:global(.entry-row:hover .row-action),
	:global(.entry-row:focus-within .row-action) {
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
	:global(.row-action) {
		transition: none;
	}
}
</style>
