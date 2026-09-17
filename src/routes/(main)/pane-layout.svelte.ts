// Pane sizes in pixels, driven by the drag handles on each pane's inner border.
// Each pane's minimum equals its default, so panes can only grow.
import { clamp } from "#lib/timeline.js"

const DEFAULT_LEFT_WIDTH = 320
const DEFAULT_RIGHT_WIDTH = 288
const DEFAULT_TIMELINE_HEIGHT = 184
const MIN_CENTER_WIDTH = 320
const MIN_CENTER_HEIGHT = 200

/**
 * Run a window-level pointer drag, reporting the total movement from the start.
 * Tracking on the window keeps the resize alive when the pointer leaves the narrow handle.
 */
function trackResize(
	event: PointerEvent,
	onMove: (dx: number, dy: number) => void,
	cursor: string
) {
	event.preventDefault()
	const startX = event.clientX
	const startY = event.clientY
	const previousCursor = document.body.style.cursor
	const previousUserSelect = document.body.style.userSelect
	document.body.style.cursor = cursor
	document.body.style.userSelect = "none"

	const handleMove = (moveEvent: PointerEvent) => {
		onMove(moveEvent.clientX - startX, moveEvent.clientY - startY)
	}
	const stop = () => {
		window.removeEventListener("pointermove", handleMove)
		window.removeEventListener("pointerup", stop)
		window.removeEventListener("pointercancel", stop)
		document.body.style.cursor = previousCursor
		document.body.style.userSelect = previousUserSelect
	}
	window.addEventListener("pointermove", handleMove)
	window.addEventListener("pointerup", stop)
	window.addEventListener("pointercancel", stop)
}

/**
 * Track the three resizable panes: the stats pane's width, the project pane's width and the timeline's height.
 * The bottom row only takes up space once `hasTimeline` reports a video is shown, so the landing page doesn't reserve an empty strip.
 */
export function createPaneLayout(hasTimeline: () => boolean) {
	let leftWidth = $state(DEFAULT_LEFT_WIDTH)
	let rightWidth = $state(DEFAULT_RIGHT_WIDTH)
	let timelineHeight = $state(DEFAULT_TIMELINE_HEIGHT)
	const timelineRowHeight = $derived(
		hasTimeline() ? `${timelineHeight}px` : "0px"
	)

	/** Drag the stats pane's right (inner) border. */
	function startLeftResize(event: PointerEvent) {
		const start = leftWidth
		const max = Math.max(
			DEFAULT_LEFT_WIDTH,
			window.innerWidth - rightWidth - MIN_CENTER_WIDTH
		)
		trackResize(
			event,
			dx => {
				leftWidth = clamp(start + dx, DEFAULT_LEFT_WIDTH, max)
			},
			"col-resize"
		)
	}

	/** Drag the project pane's left (inner) border. */
	function startRightResize(event: PointerEvent) {
		const start = rightWidth
		const max = Math.max(
			DEFAULT_RIGHT_WIDTH,
			window.innerWidth - leftWidth - MIN_CENTER_WIDTH
		)
		trackResize(
			event,
			dx => {
				rightWidth = clamp(start - dx, DEFAULT_RIGHT_WIDTH, max)
			},
			"col-resize"
		)
	}

	/** Drag the timeline's top (inner) border. */
	function startTimelineResize(event: PointerEvent) {
		const start = timelineHeight
		const max = Math.max(
			DEFAULT_TIMELINE_HEIGHT,
			window.innerHeight - MIN_CENTER_HEIGHT - 120
		)
		trackResize(
			event,
			(_dx, dy) => {
				timelineHeight = clamp(start - dy, DEFAULT_TIMELINE_HEIGHT, max)
			},
			"row-resize"
		)
	}

	return {
		get leftWidth() {
			return leftWidth
		},
		get rightWidth() {
			return rightWidth
		},
		get timelineRowHeight() {
			return timelineRowHeight
		},
		startLeftResize,
		startRightResize,
		startTimelineResize,
	}
}
