// The review session: the encoded project in the URL, the open timelapse's selections, and the sync that keeps the two in step.
import { onDestroy, untrack } from "svelte"
import type { ProjectTimelapse } from "#lib/project-storage.js"
import { saveSelections } from "#lib/selection-storage.js"
import { type DecodedShare, decodeShare, encodeShare } from "#lib/share.js"
import type { TimelineSelection } from "#lib/timeline.js"
import { goto } from "$app/navigation"

/** Canonical origin used when a summary links back to the review. */
const SITE_ORIGIN = "https://peaks.heliodex.cf"
const SELECTION_SAVE_DEBOUNCE_MS = 200
const SHARE_ENCODE_DEBOUNCE_MS = 200
const URL_WRITE_DEBOUNCE_MS = 300

type ShareState = {
	projectId: string
	id: string
	selections: TimelineSelection[]
	projectName: string
	project: ProjectTimelapse[]
}

type PendingSelection = {
	id: string
	selections: TimelineSelection[]
}

type ReviewSessionOptions = {
	/** Encoded `/{state}` path (empty on the landing page). */
	routeParam: () => string
	projectId: () => string
	projectName: () => string
	project: () => ProjectTimelapse[]
	projectLoaded: () => boolean
	/** Adopt the project carried by a decoded path. */
	onDecoded: (decoded: DecodedShare) => void
	/** Clear the open timelapse's idle analysis (the underlying video may change). */
	onResetIdle: () => void
	/** Report whether the latest selection persistence write failed. */
	onStorageError: (failed: boolean) => void
	/** Injectable collaborators keep lifecycle tests isolated from browser APIs. */
	saveSelections?: typeof saveSelections
	encodeShare?: typeof encodeShare
	navigate?: typeof goto
}

export class ReviewSession {
	readonly #options: ReviewSessionOptions
	readonly #saveSelections: typeof saveSelections
	readonly #encodeShare: typeof encodeShare
	readonly #navigate: typeof goto

	submittedId = $state("")
	selections = $state<TimelineSelection[]>([])
	encodedState = $state("")
	loaded = $state(false)

	#loadToken = 0
	#shareToken = 0
	#shareEncoding = false
	#selectionTimer: ReturnType<typeof setTimeout> | undefined
	#pendingSelection: PendingSelection | undefined
	#shareTimer: ReturnType<typeof setTimeout> | undefined
	#pendingShare: ShareState | undefined
	#urlTimer: ReturnType<typeof setTimeout> | undefined

	/** Shareable link for the current review: the encoded state is the path. */
	shareUrl = $derived(
		this.encodedState ? `${SITE_ORIGIN}/${this.encodedState}` : ""
	)

	constructor(options: ReviewSessionOptions) {
		this.#options = options
		this.#saveSelections = options.saveSelections ?? saveSelections
		this.#encodeShare = options.encodeShare ?? encodeShare
		this.#navigate = options.navigate ?? goto

		// Load the state named by the path: it holds an encoded project state whose `openId` is the open timelapse.
		// A path that doesn't decode is treated as stale or corrupt: the review stays closed and the URL sync rewrites the path from the locally stored project.
		// Resets idle analysis because the underlying video changes.
		$effect(() => {
			const param = this.#options.routeParam()
			// Our own shallow URL writes already match the in-memory review, so skip decoding them (reading `encodedState` untracked keeps it from retriggering this effect).
			// Comparing against the *current* state – rather than a value we wrote earlier – means a genuine navigation that happens to encode to the same string still loads.
			if (param && param === untrack(() => this.encodedState)) return
			this.#flushSelectionSave()
			this.#cancelPendingShare()
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

		// Persist the open timelapse's selections after the interaction settles. A pointer drag
		// can publish many intermediate arrays; only the latest one needs to reach storage.
		$effect(() => {
			const id = this.submittedId
			const value = $state.snapshot(this.selections)
			if (!id || !this.loaded) return
			this.#queueSelectionSave(id, value)
		})

		// Mirror the review – the open project and, when one is open, the timelapse – into the URL.
		// Only the current project is encoded; the rest stay in storage. Encoding is coalesced too,
		// so a drag cannot start one compression job per intermediate state.
		$effect(() => {
			const id = this.submittedId
			const value = $state.snapshot(this.selections)
			const projectId = this.#options.projectId()
			const name = this.#options.projectName()
			const entries = $state.snapshot(this.#options.project())
			if (!this.#options.projectLoaded() || !this.loaded) return
			this.#queueShare({
				projectId,
				id,
				selections: value,
				projectName: name,
				project: entries,
			})
		})

		onDestroy(() => {
			this.#flushSelectionSave()
			this.#cancelPendingShare()
		})
	}

	#queueSelectionSave(id: string, selections: TimelineSelection[]): void {
		this.#pendingSelection = { id, selections }
		clearTimeout(this.#selectionTimer)
		this.#selectionTimer = setTimeout(() => {
			this.#selectionTimer = undefined
			this.#flushSelectionSave()
		}, SELECTION_SAVE_DEBOUNCE_MS)
	}

	#flushSelectionSave(): void {
		clearTimeout(this.#selectionTimer)
		this.#selectionTimer = undefined
		const pending = this.#pendingSelection
		this.#pendingSelection = undefined
		if (!pending) return
		this.#options.onStorageError(
			!this.#saveSelections(pending.id, pending.selections)
		)
	}

	#queueShare(state: ShareState): void {
		this.#pendingShare = state
		clearTimeout(this.#shareTimer)
		this.#shareTimer = setTimeout(() => {
			this.#shareTimer = undefined
			void this.#drainShareQueue()
		}, SHARE_ENCODE_DEBOUNCE_MS)
	}

	#cancelPendingShare(): void {
		clearTimeout(this.#shareTimer)
		this.#shareTimer = undefined
		this.#pendingShare = undefined
		this.#shareToken++
		clearTimeout(this.#urlTimer)
		this.#urlTimer = undefined
	}

	async #drainShareQueue(): Promise<void> {
		if (this.#shareEncoding) return
		this.#shareEncoding = true
		try {
			while (this.#pendingShare) {
				const state = this.#pendingShare
				this.#pendingShare = undefined
				const token = ++this.#shareToken
				let encoded: string
				try {
					encoded = await this.#encodeShare({
						projectId: state.projectId,
						selections: state.selections,
						projectName: state.projectName,
						project: state.project,
						openId: state.id,
					})
				} catch {
					if (
						token === this.#shareToken &&
						state.id === this.submittedId
					)
						this.encodedState = ""
					continue
				}
				if (token !== this.#shareToken || state.id !== this.submittedId)
					continue
				this.encodedState = encoded
				this.#queueUrlWrite(state.id, `/${encoded}`)
			}
		} finally {
			this.#shareEncoding = false
			if (this.#pendingShare && this.#shareTimer === undefined)
				void this.#drainShareQueue()
		}
	}

	#queueUrlWrite(id: string, target: string): void {
		clearTimeout(this.#urlTimer)
		this.#urlTimer = setTimeout(() => {
			this.#urlTimer = undefined
			void this.#applyShareUrl(id, target)
		}, URL_WRITE_DEBOUNCE_MS)
	}

	async #applyShareUrl(id: string, target: string): Promise<void> {
		if (id !== this.submittedId) return
		if (
			typeof window !== "undefined" &&
			target === window.location.pathname
		)
			return
		await this.#navigate(target, {
			replace: true,
			shallow: true,
			reset: false,
		})
	}

	/** Close the open timelapse and forget its selections. */
	close() {
		this.#flushSelectionSave()
		this.#cancelPendingShare()
		this.submittedId = ""
		this.selections = []
	}

	/** Cancel any pending selection/share persistence or URL write. */
	clearPendingWrite() {
		this.#cancelPendingShare()
	}
}
