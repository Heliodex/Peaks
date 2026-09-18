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
		<p class="text-sm text-neutral-500">
			No timelapses yet. Add one below.
		</p>
	{/if}

	<TimelapseAddForm {submittedId} {loadError} {onLoad} />

	<ProjectTotalsPanel totals={projectTotals} />

	{#if projectEntries.length > 0}
		<ProjectDescription description={projectDescription} />
	{/if}
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
