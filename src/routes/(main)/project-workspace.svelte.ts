// The workspace of locally-stored projects: the open project, its timelapses and the CRUD around them.
import * as svelte from "svelte"
import {
	matchesSharedProject,
	uniqueImportedProjectName,
} from "#lib/project-import.js"
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
import { saveSelections } from "#lib/selection-storage.js"
import type { DecodedShare } from "#lib/share.js"
import {
	STORAGE_WRITE_ERROR,
	type StorageSource,
} from "#lib/storage-messages.js"

const PROJECT_SAVE_DEBOUNCE_MS = 250

export class ProjectWorkspace {
	readonly #closeTimelapse: () => void
	readonly #saveProjects: typeof saveProjects
	#saveTimer: ReturnType<typeof setTimeout> | undefined
	#pendingStore: ProjectStore | undefined
	#storageFailures: Record<StorageSource, boolean> = {
		projects: false,
		selections: false,
	}

	projects = $state<Project[]>([])
	currentProjectId = $state("")
	projectLoaded = $state(false)
	// A project whose name field should take focus, set right after creating one.
	focusNameId = $state<string | null>(null)
	// Validation failure from the last attempt to add a timelapse by id.
	loadError = $state<string | null>(null)
	// A failed local-storage write, shown separately from input validation errors.
	storageError = $state<string | null>(null)

	/** The project currently open in the panel. */
	currentProject = $derived(
		this.projects.find(project => project.id === this.currentProjectId) ??
			this.projects[0]
	)
	projectName = $derived(this.currentProject?.name ?? DEFAULT_PROJECT_NAME)
	projectEntries = $derived(this.currentProject?.timelapses ?? [])
	/** The project the panel is actually showing, and therefore editing. */
	activeProjectId = $derived(this.currentProject?.id ?? this.currentProjectId)

	constructor(
		closeTimelapse: () => void,
		save: typeof saveProjects = saveProjects
	) {
		this.#closeTimelapse = closeTimelapse
		this.#saveProjects = save

		// Load the workspace once on the client; local storage isn't available during SSR, so this must not run in the initial render.
		if (typeof svelte.onMount === "function")
			svelte.onMount(() => {
				const store = loadProjects()
				this.projects = store.projects
				this.currentProjectId = store.currentId
				this.projectLoaded = true
			})

		// Persist project changes after the interaction settles, so dragging or recalculating
		// does not serialize the entire workspace on every intermediate state.
		$effect(() => {
			const store: ProjectStore = {
				projects: $state.snapshot(this.projects),
				currentId: this.currentProjectId,
			}
			if (!this.projectLoaded) return
			this.#pendingStore = store
			clearTimeout(this.#saveTimer)
			this.#saveTimer = setTimeout(() => {
				this.#flushProjectSave()
			}, PROJECT_SAVE_DEBOUNCE_MS)
		})

		if (typeof svelte.onDestroy === "function")
			svelte.onDestroy(() => this.#flushProjectSave())
	}

	#flushProjectSave() {
		clearTimeout(this.#saveTimer)
		this.#saveTimer = undefined
		const store = this.#pendingStore
		this.#pendingStore = undefined
		if (!store) return
		this.reportStorageError("projects", !this.#saveProjects(store))
	}

	/** Track persistence failures by source so one successful write doesn't hide another. */
	reportStorageError(source: StorageSource, failed: boolean) {
		this.#storageFailures[source] = failed
		this.storageError = Object.values(this.#storageFailures).some(Boolean)
			? STORAGE_WRITE_ERROR
			: null
	}

	/** Replace the current project with the result of `update`. */
	updateCurrentProject(update: (project: Project) => Project) {
		const id = this.activeProjectId
		this.projects = this.projects.map(project =>
			project.id === id ? update(project) : project
		)
	}

	/** Rename a project by id. */
	renameProject(id: string, name: string) {
		const trimmed = name.trim() || DEFAULT_PROJECT_NAME
		this.projects = this.projects.map(project =>
			project.id === id ? { ...project, name: trimmed } : project
		)
	}

	/** Replace the open project's timelapse order. */
	reorderCurrentProject(timelapses: ProjectTimelapse[]) {
		this.updateCurrentProject(project => ({ ...project, timelapses }))
	}

	/** Replace the project order. */
	reorderProjects(projects: Project[]) {
		this.projects = projects
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
	importSharedProject(decoded: DecodedShare) {
		const matches = (project: Project): boolean =>
			matchesSharedProject(project, decoded)
		const existing =
			this.projects.find(
				project => project.id === decoded.projectId && matches(project)
			) ?? this.projects.find(matches)
		if (existing) {
			// The decoded session is already current; switch projects without closing it.
			this.loadError = null
			this.currentProjectId = existing.id
			return
		}

		// Never replace a local project just because a shared link reuses its id.
		const requestedId = decoded.projectId || newProjectId()
		const index = this.projects.findIndex(item => item.id === requestedId)
		const hasCollision = index !== -1
		const requestedName = decoded.projectName.trim() || DEFAULT_PROJECT_NAME
		const id = hasCollision ? newProjectId() : requestedId
		const project: Project = {
			id,
			name: uniqueImportedProjectName(this.projects, requestedName),
			timelapses: decoded.project,
		}
		this.projects = [...this.projects, project]
		this.currentProjectId = id

		// Keep existing selection records when a shared project reuses a known timelapse ID.
		const localTimelapseIds = new Set(
			this.projects
				.filter(item => item.id !== id)
				.flatMap(item => item.timelapses.map(entry => entry.id))
		)
		let storageFailed = false
		for (const [timelapseId, selections] of decoded.selectionsByTimelapse) {
			if (localTimelapseIds.has(timelapseId)) continue
			if (!saveSelections(timelapseId, selections)) storageFailed = true
		}
		if (storageFailed) this.reportStorageError("selections", true)
	}
}
