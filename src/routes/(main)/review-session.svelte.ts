// The review session: the encoded project in the URL, the open timelapse's selections, and the sync that keeps the two in step.
import { untrack } from "svelte"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { saveSelections } from "#lib/selection-storage.js"
import { decodeShare, encodeShare, type ShareState } from "#lib/share.js"
import type { TimelineSelection } from "#lib/timeline.js"
import { goto } from "$app/navigation"

/** Canonical origin used when a summary links back to the review. */
const SITE_ORIGIN = "https://peaks.heliodex.cf"

type ReviewSessionOptions = {
	/** Encoded `/{state}` path (empty on the landing page). */
	routeParam: () => string
	projectId: () => string
	projectName: () => string
	project: () => ProjectTimelapse[]
	projectLoaded: () => boolean
	/** Adopt the project carried by a decoded path. */
	onDecoded: (decoded: ShareState) => void
	/** Clear the open timelapse's idle analysis (the underlying video may change). */
	onResetIdle: () => void
}

export class ReviewSession {
	readonly #options: ReviewSessionOptions

	submittedId = $state("")
	selections = $state<TimelineSelection[]>([])
	encodedState = $state("")
	loaded = $state(false)

	#loadToken = 0
	#urlToken = 0
	#urlTimer: ReturnType<typeof setTimeout> | undefined

	/** Shareable link for the current review: the encoded state is the path. */
	shareUrl = $derived(
		this.encodedState ? `${SITE_ORIGIN}/${this.encodedState}` : ""
	)

	constructor(options: ReviewSessionOptions) {
		this.#options = options

		// Load the state named by the path: it holds an encoded project state whose `openId` is the open timelapse.
		// A path that doesn't decode is treated as stale or corrupt: the review stays closed and the URL sync rewrites the path from the locally stored project.
		// Resets idle analysis because the underlying video changes.
		$effect(() => {
			const param = this.#options.routeParam()
			// Our own shallow URL writes already match the in-memory review, so skip decoding them (reading `encodedState` untracked keeps it from retriggering this effect).
			// Comparing against the *current* state – rather than a value we wrote earlier – means a genuine navigation that happens to encode to the same string still loads.
			if (param && param === untrack(() => this.encodedState)) return
			const token = ++this.#loadToken
			this.loaded = false
			this.encodedState = ""
			this.#options.onResetIdle()
			if (!param) {
				this.submittedId = ""
				this.selections = []
				this.loaded = true
				return
			}
			decodeShare(param).then(decoded => {
				if (token !== this.#loadToken) return
				if (decoded) {
					this.submittedId = decoded.openId
					this.encodedState = param
					this.selections = decoded.selections
					this.#options.onDecoded(decoded)
				} else {
					// Not an encoded project state.
					// Leave the review closed rather than latching onto the slug, and let the URL sync rewrite the path from the locally stored project so a stale or corrupt link recovers.
					this.submittedId = ""
					this.selections = []
				}
				this.loaded = true
			})
		})

		// Persist the open timelapse's selections (and their reasons) per timelapse.
		$effect(() => {
			const id = this.submittedId
			const value = $state.snapshot(this.selections)
			if (!id || !this.loaded) return
			saveSelections(id, value)
		})

		// Mirror the review – the open project and, when one is open, the timelapse – into the URL.
		// Only the current project is encoded; the rest stay in storage.
		$effect(() => {
			const id = this.submittedId
			const value = $state.snapshot(this.selections)
			const projectId = this.#options.projectId()
			const name = this.#options.projectName()
			const entries = $state.snapshot(this.#options.project())
			if (!this.#options.projectLoaded() || !this.loaded) return
			this.#syncShareUrl({
				projectId,
				id,
				selections: value,
				projectName: name,
				project: entries,
			})
			return () => clearTimeout(this.#urlTimer)
		})
	}

	/** Encode the review and project state, publish it to the description immediately, and (debounced) mirror it into the path so the whole session can be shared. */
	async #syncShareUrl(state: {
		projectId: string
		id: string
		selections: TimelineSelection[]
		projectName: string
		project: ProjectTimelapse[]
	}) {
		const token = ++this.#urlToken
		const encoded = await encodeShare({
			projectId: state.projectId,
			selections: state.selections,
			projectName: state.projectName,
			project: state.project,
			openId: state.id,
		})
		// Bail if a newer encode started, or the open timelapse changed underneath us (otherwise a stale payload could land on the wrong review).
		if (token !== this.#urlToken || state.id !== this.submittedId) return
		this.encodedState = encoded
		const target = `/${encoded}`
		// Debounce only the history write, so editing doesn't spam entries.
		const id = state.id
		clearTimeout(this.#urlTimer)
		this.#urlTimer = setTimeout(() => {
			this.#applyShareUrl(id, target)
		}, 300)
	}

	/**
	 * Mirror the encoded state into the path.
	 * Guards ensure a debounced update from a previously open timelapse can only rewrite the URL of the *current* route – it can never navigate back to (or re-apply the project snapshot of) a different timelapse.
	 * The load effect recognises the write because it matches the state currently held in `encodedState`.
	 */
	async #applyShareUrl(id: string, target: string) {
		if (id !== this.submittedId) return
		if (target === window.location.pathname) return
		await goto(target, { replace: true, shallow: true, reset: false })
	}

	/** Close the open timelapse and forget its selections. */
	close() {
		this.submittedId = ""
		this.selections = []
	}

	/** Cancel any debounced URL write. */
	clearPendingWrite() {
		clearTimeout(this.#urlTimer)
	}
}
