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

type ProjectWorkspaceOptions = {
	/** Close the open timelapse, e.g. because its project or entry is being removed. */
	closeTimelapse: () => void
}

export function createProjectWorkspace({
	closeTimelapse,
}: ProjectWorkspaceOptions) {
	let projects = $state<Project[]>([])
	let currentProjectId = $state("")
	let projectLoaded = $state(false)
	// A project whose name field should take focus, set right after creating one.
	let focusNameId = $state<string | null>(null)
	// Validation failure from the last attempt to add a timelapse by id.
	let loadError = $state<string | null>(null)

	/** The project currently open in the panel. */
	const currentProject = $derived(
		projects.find(project => project.id === currentProjectId) ?? projects[0]
	)
	const projectName = $derived(currentProject?.name ?? DEFAULT_PROJECT_NAME)
	const projectEntries = $derived(currentProject?.timelapses ?? [])
	/** The project the panel is actually showing, and therefore editing. */
	const activeProjectId = $derived(currentProject?.id ?? currentProjectId)

	/** Replace the current project with the result of `update`. */
	function updateCurrentProject(update: (project: Project) => Project) {
		const id = activeProjectId
		projects = projects.map(project =>
			project.id === id ? update(project) : project
		)
	}

	/** Rename the open project. */
	function renameCurrentProject(name: string) {
		const trimmed = name.trim() || DEFAULT_PROJECT_NAME
		updateCurrentProject(project => ({ ...project, name: trimmed }))
	}

	/** Replace the open project's timelapse order. */
	function reorderCurrentProject(timelapses: ProjectTimelapse[]) {
		updateCurrentProject(project => ({ ...project, timelapses }))
	}

	/** Open a different project. */
	function selectProject(id: string) {
		if (id === currentProjectId) return
		if (!projects.some(project => project.id === id)) return
		closeTimelapse()
		loadError = null
		currentProjectId = id
	}

	/** Create and open a new empty project. */
	function createNewProject() {
		const project = createProject(uniqueProjectName(projects))
		projects = [...projects, project]
		focusNameId = project.id
		selectProject(project.id)
	}

	/** Delete a project, always leaving at least one behind. */
	function removeProject(id: string) {
		loadError = null
		const remaining = projects.filter(project => project.id !== id)
		if (remaining.length === 0) {
			const project = createProject()
			if (id === currentProjectId) closeTimelapse()
			projects = [project]
			currentProjectId = project.id
			return
		}
		projects = remaining
		if (id !== currentProjectId) return
		closeTimelapse()
		currentProjectId = remaining[0].id
	}

	/** Adopt the project carried by a shared URL and make it current. */
	function importSharedProject(shared: ShareState) {
		const id = shared.projectId || newProjectId()
		const project: Project = {
			id,
			name: shared.projectName.trim() || DEFAULT_PROJECT_NAME,
			timelapses: shared.project,
		}
		const index = projects.findIndex(item => item.id === id)
		projects =
			index === -1
				? [...projects, project]
				: projects.map((item, i) => (i === index ? project : item))
		currentProjectId = id
	}

	// Load the workspace once on the client; local storage isn't available during SSR, so this must not run in the initial render.
	onMount(() => {
		const store = loadProjects()
		projects = store.projects
		currentProjectId = store.currentId
		projectLoaded = true
	})

	// Persist every project whenever anything about them changes.
	$effect(() => {
		const store: ProjectStore = {
			projects: $state.snapshot(projects),
			currentId: currentProjectId,
		}
		if (!projectLoaded) return
		saveProjects(store)
	})

	return {
		get projects() {
			return projects
		},
		get currentProjectId() {
			return currentProjectId
		},
		get projectLoaded() {
			return projectLoaded
		},
		get projectName() {
			return projectName
		},
		get projectEntries() {
			return projectEntries
		},
		get activeProjectId() {
			return activeProjectId
		},
		get focusNameId() {
			return focusNameId
		},
		set focusNameId(value: string | null) {
			focusNameId = value
		},
		get loadError() {
			return loadError
		},
		set loadError(value: string | null) {
			loadError = value
		},
		updateCurrentProject,
		renameCurrentProject,
		reorderCurrentProject,
		selectProject,
		createNewProject,
		removeProject,
		importSharedProject,
	}
}
