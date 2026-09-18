// The workspace of locally-stored projects: the open project, its timelapses and the CRUD around them.
import { onMount } from "svelte"
import {
	createProject,
	DEFAULT_PROJECT_NAME,
	loadProjects,
	newProjectId,
	type Project,
	type ProjectStore,
	type ProjectTimelapse,
	saveProjects,
	uniqueProjectName,
} from "#lib/project-storage.js"
import type { ShareState } from "#lib/share.js"

export class ProjectWorkspace {
	readonly #closeTimelapse: () => void

	projects = $state<Project[]>([])
	currentProjectId = $state("")
	projectLoaded = $state(false)
	// A project whose name field should take focus, set right after creating one.
	focusNameId = $state<string | null>(null)
	// Validation failure from the last attempt to add a timelapse by id.
	loadError = $state<string | null>(null)

	/** The project currently open in the panel. */
	currentProject = $derived(
		this.projects.find(project => project.id === this.currentProjectId) ??
			this.projects[0]
	)
	projectName = $derived(this.currentProject?.name ?? DEFAULT_PROJECT_NAME)
	projectEntries = $derived(this.currentProject?.timelapses ?? [])
	/** The project the panel is actually showing, and therefore editing. */
	activeProjectId = $derived(this.currentProject?.id ?? this.currentProjectId)

	constructor(closeTimelapse: () => void) {
		this.#closeTimelapse = closeTimelapse

		// Load the workspace once on the client; local storage isn't available during SSR, so this must not run in the initial render.
		onMount(() => {
			const store = loadProjects()
			this.projects = store.projects
			this.currentProjectId = store.currentId
			this.projectLoaded = true
		})

		// Persist every project whenever anything about them changes.
		$effect(() => {
			const store: ProjectStore = {
				projects: $state.snapshot(this.projects),
				currentId: this.currentProjectId,
			}
			if (!this.projectLoaded) return
			saveProjects(store)
		})
	}

	/** Replace the current project with the result of `update`. */
	updateCurrentProject(update: (project: Project) => Project) {
		const id = this.activeProjectId
		this.projects = this.projects.map(project =>
			project.id === id ? update(project) : project
		)
	}

	/** Rename the open project. */
	renameCurrentProject(name: string) {
		const trimmed = name.trim() || DEFAULT_PROJECT_NAME
		this.updateCurrentProject(project => ({ ...project, name: trimmed }))
	}

	/** Replace the open project's timelapse order. */
	reorderCurrentProject(timelapses: ProjectTimelapse[]) {
		this.updateCurrentProject(project => ({ ...project, timelapses }))
	}

	/** Open a different project. */
	selectProject(id: string) {
		if (id === this.currentProjectId) return
		if (!this.projects.some(project => project.id === id)) return
		this.#closeTimelapse()
		this.loadError = null
		this.currentProjectId = id
	}

	/** Create and open a new empty project. */
	createNewProject() {
		const project = createProject(uniqueProjectName(this.projects))
		this.projects = [...this.projects, project]
		this.focusNameId = project.id
		this.selectProject(project.id)
	}

	/** Delete a project, always leaving at least one behind. */
	removeProject(id: string) {
		this.loadError = null
		const remaining = this.projects.filter(project => project.id !== id)
		if (remaining.length === 0) {
			const project = createProject()
			if (id === this.currentProjectId) this.#closeTimelapse()
			this.projects = [project]
			this.currentProjectId = project.id
			return
		}
		this.projects = remaining
		if (id !== this.currentProjectId) return
		this.#closeTimelapse()
		this.currentProjectId = remaining[0].id
	}

	/** Adopt the project carried by a shared URL and make it current. */
	importSharedProject(shared: ShareState) {
		const id = shared.projectId || newProjectId()
		const project: Project = {
			id,
			name: shared.projectName.trim() || DEFAULT_PROJECT_NAME,
			timelapses: shared.project,
		}
		const index = this.projects.findIndex(item => item.id === id)
		this.projects =
			index === -1
				? [...this.projects, project]
				: this.projects.map((item, i) => (i === index ? project : item))
		this.currentProjectId = id
	}
}
