<script lang="ts">
type TimelineSelection = { id: string; start: number; end: number }

type DragState =
	| {
			kind: "create"
			id: string
			anchor: number
			anchorX: number
			min: number
			max: number
			moved: boolean
	  }
	| {
			kind: "move"
			id: string
			offset: number
			length: number
			min: number
			max: number
	  }
	| { kind: "resize-start"; id: string; min: number; max: number }
	| { kind: "resize-end"; id: string; min: number; max: number }
	| null

let {
	timelapse,
	video,
	selections = $bindable<TimelineSelection[]>([]),
}: {
	timelapse: { playbackUrl: string; thumbnailUrl?: string | null }
	video: HTMLVideoElement | undefined
	selections?: TimelineSelection[]
} = $props()

const FRAME_COUNT = 12
// Pointer travel (px) required before a press counts as a drag rather than a click
const DRAG_THRESHOLD_PX = 4
// Minimum on-screen width (px) of a selection so its handles stay usable
const MIN_SELECTION_PX = 4

let videoDuration = $state(0)
let hoverTime = $state<number | null>(null)
let hoveredSelectionId = $state<string | null>(null)
let frames = $state<string[]>([])
// False when frame capture fails
let previewsAvailable = $state(false)
const duration = $derived(videoDuration)

let drag = $state<DragState>(null)
let nextId = 0

function makeId(): string {
	return `selection-${++nextId}`
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

function formatTime(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds))
	const m = Math.floor(s / 60)
	const r = s % 60
	return `${m}:${String(r).padStart(2, "0")}`
}

let captureToken = 0
async function captureFrames(src: string, duration: number) {
	const token = ++captureToken
	previewsAvailable = false
	frames = []

	const capture = document.createElement("video")
	capture.muted = true
	capture.preload = "auto"
	// Same-origin proxy keeps the canvas untainted without the CDN sending CORS headers
	capture.src = `/lapse-proxy?url=${encodeURIComponent(src)}`

	try {
		await new Promise<void>((resolve, reject) => {
			capture.onloadeddata = () => resolve()
			capture.onerror = () => reject(new Error("Failed to load video"))
		})

		const canvas = document.createElement("canvas")
		canvas.width = 160
		canvas.height = Math.max(
			1,
			Math.round((160 * capture.videoHeight) / (capture.videoWidth || 1))
		)
		const ctx = canvas.getContext("2d")
		if (!ctx) throw new Error("No canvas context")

		const results: string[] = []
		for (let i = 0; i < FRAME_COUNT; i++) {
			if (token !== captureToken) return
			const time = (duration * i) / (FRAME_COUNT - 1)
			await new Promise<void>(resolve => {
				capture.onseeked = () => resolve()
				capture.currentTime = Math.min(time, duration - 0.05)
			})
			ctx.drawImage(capture, 0, 0, canvas.width, canvas.height)
			results.push(canvas.toDataURL("image/jpeg", 0.7))
		}

		if (token !== captureToken) return
		frames = results
		previewsAvailable = true
	} catch {
		// Fall back to time-only placeholders and scrubbing without previews.
		if (token !== captureToken) return
		previewsAvailable = false
	} finally {
		capture.removeAttribute("src")
	}
}

$effect(() => {
	const el = video
	if (!el || !timelapse.playbackUrl) return

	const onLoaded = () => {
		videoDuration =
			Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
		if (videoDuration > 0) {
			void captureFrames(timelapse.playbackUrl, videoDuration)
		}
	}
	el.addEventListener("loadedmetadata", onLoaded)
	if (el.readyState >= 1) onLoaded()
	return () => el.removeEventListener("loadedmetadata", onLoaded)
})

function pointerToTime(clientX: number, target: HTMLElement): number {
	const rect = target.getBoundingClientRect()
	const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
	return ratio * duration
}

function seekTo(seconds: number) {
	const el = video
	if (!el || el.readyState < 1 || !Number.isFinite(seconds)) return
	el.currentTime = seconds
}

/**
 * The open space directly left and right of an interval, ignoring `id`.
 * Used to keep selections from overlapping while creating, moving or resizing.
 */
function neighborBounds(id: string, start: number, end: number) {
	let left = 0
	let right = duration
	for (const other of selections) {
		if (other.id === id) continue
		if (other.end <= start) left = Math.max(left, other.end)
		else if (other.start >= end) right = Math.min(right, other.start)
	}
	return { left, right }
}

function updateSelection(
	id: string,
	patch: Partial<Omit<TimelineSelection, "id">>
) {
	selections = selections.map(other =>
		other.id === id ? { ...other, ...patch } : other
	)
}

function minSelectionLength(track: HTMLElement): number {
	const rect = track.getBoundingClientRect()
	if (rect.width <= 0) return 0
	return (MIN_SELECTION_PX / rect.width) * duration
}

// Class for the hover-only controls (handles + delete button). They stay visible while their selection is the one being dragged.
function controlsClass(id: string): string {
	return drag?.id === id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
}

function onPointerDown(event: PointerEvent) {
	if (event.button !== 0) return
	const target = event.target as HTMLElement
	const track = event.currentTarget as HTMLElement

	// The delete button handles its own click.
	if (target.closest("[data-delete]")) return

	const resizeEl = target.closest<HTMLElement>("[data-resize]")
	if (resizeEl) {
		const id = resizeEl.dataset.selectionId
		const selection = selections.find(s => s.id === id)
		if (!id || !selection) return

		const { left, right } = neighborBounds(
			id,
			selection.start,
			selection.end
		)
		const minLength = minSelectionLength(track)
		if (resizeEl.dataset.resize === "start") {
			drag = {
				kind: "resize-start",
				id,
				min: left,
				max: Math.max(left, selection.end - minLength),
			}
		} else {
			drag = {
				kind: "resize-end",
				id,
				min: Math.min(right, selection.start + minLength),
				max: right,
			}
		}
		track.setPointerCapture(event.pointerId)
		event.preventDefault()
		return
	}

	const selectionEl = target.closest<HTMLElement>("[data-selection-id]")
	if (selectionEl) {
		const id = selectionEl.dataset.selectionId
		const selection = selections.find(s => s.id === id)
		if (!id || !selection) return

		const length = selection.end - selection.start
		const { left, right } = neighborBounds(
			id,
			selection.start,
			selection.end
		)
		drag = {
			kind: "move",
			id,
			offset: pointerToTime(event.clientX, track) - selection.start,
			length,
			min: left,
			max: Math.max(left, right - length),
		}
		track.setPointerCapture(event.pointerId)
		event.preventDefault()
		return
	}

	// Empty space: start drawing a brand new selection inside the nearest gap.
	const anchor = clamp(pointerToTime(event.clientX, track), 0, duration)
	const { left, right } = neighborBounds("", anchor, anchor)
	if (right - left <= 0) return

	const id = makeId()
	selections = [...selections, { id, start: anchor, end: anchor }]
	drag = {
		kind: "create",
		id,
		anchor,
		anchorX: event.clientX,
		min: left,
		max: right,
		moved: false,
	}
	track.setPointerCapture(event.pointerId)
	event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
	const track = event.currentTarget as HTMLElement
	const state = drag

	if (state) {
		const time = pointerToTime(event.clientX, track)
		if (state.kind === "create") {
			const end = clamp(time, state.min, state.max)
			state.moved =
				state.moved ||
				Math.abs(event.clientX - state.anchorX) >= DRAG_THRESHOLD_PX
			updateSelection(state.id, {
				start: Math.min(state.anchor, end),
				end: Math.max(state.anchor, end),
			})
		} else if (state.kind === "move") {
			const start = clamp(time - state.offset, state.min, state.max)
			updateSelection(state.id, { start, end: start + state.length })
		} else if (state.kind === "resize-start") {
			const start = clamp(time, state.min, state.max)
			updateSelection(state.id, { start })
			// Seek to the exact new boundary so the frame is visible while resizing.
			seekTo(start)
		} else {
			const end = clamp(time, state.min, state.max)
			updateSelection(state.id, { end })
			seekTo(end)
		}
		return
	}

	// Hovering: preview-scrub and remember which selection is under the pointer.
	const selectionEl = (event.target as HTMLElement).closest<HTMLElement>(
		"[data-selection-id]"
	)
	hoveredSelectionId = selectionEl?.dataset.selectionId ?? null
	hoverTime = pointerToTime(event.clientX, track)
	if (video && video.readyState >= 1) {
		video.currentTime = hoverTime
	}
}

function onPointerUp(event: PointerEvent) {
	const track = event.currentTarget as HTMLElement
	const state = drag
	drag = null

	if (track.hasPointerCapture(event.pointerId)) {
		track.releasePointerCapture(event.pointerId)
	}
	if (!state) return

	if (state.kind === "create") {
		const created = selections.find(s => s.id === state.id)
		// An un-dragged press (or an empty range) is discarded like a click.
		if (!state.moved || !created || created.end - created.start <= 0) {
			selections = selections.filter(s => s.id !== state.id)
		}
	}
}

function onPointerLeave() {
	if (drag) return
	hoverTime = null
	hoveredSelectionId = null
}

function deleteSelection(id: string, event: MouseEvent) {
	event.stopPropagation()
	selections = selections.filter(s => s.id !== id)
	if (hoveredSelectionId === id) hoveredSelectionId = null
}
</script>

{#if duration > 0}
	<div class="pt-4 w-full max-w-5xl">
		<div
			class="relative h-20 w-full touch-none rounded border select-none"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onpointerleave={onPointerLeave}
			role="presentation"
		>
			<!-- Frame previews, clipped to the rounded track -->
			<div
				class="pointer-events-none absolute inset-0 flex overflow-hidden rounded"
			>
				{#each Array(FRAME_COUNT) as _, i (i)}
					<div class="relative h-full min-w-0 flex-1">
						{#if previewsAvailable && frames[i]}
							<img
								src={frames[i]}
								alt={`Frame at ${formatTime((duration * i) / (FRAME_COUNT - 1))}`}
								class="h-full w-full object-cover"
								draggable="false"
							>
						{:else}
							<div
								class="flex h-full w-full items-center justify-center border-r border-white/10 bg-neutral-800 text-[10px] text-neutral-500 last:border-r-0"
							>
								{previewsAvailable
									? ""
									: formatTime((duration * i) / (FRAME_COUNT - 1))}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Selections -->
			{#each selections as sel (sel.id)}
				<div
					class="group absolute inset-y-0 cursor-grab active:cursor-grabbing"
					data-selection-id={sel.id}
					style:left="{(sel.start / duration) * 100}%"
					style:width="{((sel.end - sel.start) / duration) * 100}%"
				>
					<div
						class="pointer-events-none absolute inset-0 border-x-2 border-red-500 bg-red-500/40"
					></div>

					<div
						data-resize="start"
						data-selection-id={sel.id}
						class="absolute inset-y-0 -left-1 flex w-2 cursor-ew-resize items-center justify-center transition-opacity {controlsClass(
							sel.id
						)}"
						role="presentation"
					>
						<span
							class="h-6 w-1 rounded-full bg-red-600 shadow"
						></span>
					</div>

					<div
						data-resize="end"
						data-selection-id={sel.id}
						class="absolute inset-y-0 -right-1 flex w-2 cursor-ew-resize items-center justify-center transition-opacity {controlsClass(
							sel.id
						)}"
						role="presentation"
					>
						<span
							class="h-6 w-1 rounded-full bg-red-600 shadow"
						></span>
					</div>

					<button
						type="button"
						data-delete={sel.id}
						aria-label="Delete selection"
						onclick={e => deleteSelection(sel.id, e)}
						class="absolute -top-3 left-1/2 flex h-5 w-5 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-red-500 bg-white text-xs leading-none text-red-600 shadow transition-opacity {controlsClass(
							sel.id
						)}"
					>
						×
					</button>
				</div>
			{/each}

			{#if hoverTime !== null && hoveredSelectionId === null}
				<div
					class="pointer-events-none absolute top-1 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white"
					style:left="{(hoverTime / duration) * 100}%"
				>
					{formatTime(hoverTime)}
				</div>
			{/if}
		</div>

		<div class="pt-2 flex justify-between text-xs text-neutral-500">
			<span>0:00</span>
			<span>{formatTime(duration)}</span>
		</div>
	</div>
{/if}
