<script lang="ts">
import { untrack } from "svelte"
import { MAX_SEEK_STEP, MIN_SEEK_STEP } from "#lib/settings-storage.js"
import type { WorkspaceHistory } from "./workspace-history.svelte.js"

let {
	justifyTimeline,
	onToggleJustifyTimeline,
	seekStep,
	onSetSeekStep,
	history,
}: {
	/** Stretch the timeline across the full window when true. */
	justifyTimeline: boolean
	onToggleJustifyTimeline: (value: boolean) => void
	/** Seconds the left/right arrow keys jump through the video. */
	seekStep: number
	onSetSeekStep: (value: number) => void
	/** Whole-workspace undo/redo history. */
	history: WorkspaceHistory
} = $props()

// The shortcuts the review route listens for; kept here so they're discoverable without a manual.
const shortcuts = $derived<{ description: string; keys: string[] }[]>([
	{ description: "Play or pause", keys: ["Space"] },
	{
		description: `Seek ${seekStep} second${seekStep === 1 ? "" : "s"}`,
		keys: ["←", "→"],
	},
	{ description: "Step one frame", keys: ["↑", "↓"] },
	{ description: "Previous / next timelapse", keys: ["[", "]"] },
	{ description: "Search projects", keys: ["Ctrl", "K"] },
	{ description: "Fullscreen video", keys: ["F"] },
	{ description: "New project", keys: ["N"] },
])

// The graph is drawn as dots on a pannable, zoomable canvas.
const NODE = 16
const MIN_SCALE = 0.3
const MAX_SCALE = 2

const graph = $derived(history.graph)
const currentLabel = $derived(history.nodes[history.currentId]?.label ?? "")

let canvasEl = $state<HTMLDivElement>()
let view = $state({ x: 0, y: 0, scale: 1 })
let dragging = $state<{
	pointerId: number
	startX: number
	startY: number
	originX: number
	originY: number
	moved: boolean
} | null>(null)
// Set while a drag finishes, so the click it emits doesn't also jump.
let suppressClick = false
let hovered = $state<{ label: string; x: number; y: number } | null>(null)

/** Centre the viewport on the current node. */
function centreOnCurrent() {
	const el = canvasEl
	const node = graph.nodes.find(item => item.id === history.currentId)
	if (!el || !node) return
	const rect = el.getBoundingClientRect()
	const scale = view.scale
	view = {
		x: rect.width / 2 - node.x * scale,
		y: rect.height / 2 - node.y * scale,
		scale,
	}
}

// Keep the current node centred as the history grows or the user undoes/redoes/jumps.
$effect(() => {
	const el = canvasEl
	const node = graph.nodes.find(item => item.id === history.currentId)
	if (!el || !node) return
	const scale = untrack(() => view.scale)
	const rect = el.getBoundingClientRect()
	view = {
		x: rect.width / 2 - node.x * scale,
		y: rect.height / 2 - node.y * scale,
		scale,
	}
})

function startPan(event: PointerEvent) {
	if (event.button !== 0) return
	const el = event.currentTarget as HTMLElement
	dragging = {
		pointerId: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
		originX: view.x,
		originY: view.y,
		moved: false,
	}
	try {
		el.setPointerCapture(event.pointerId)
	} catch {
		// A pointer that's already released can't be captured; dragging still works without it.
	}
}

function movePan(event: PointerEvent) {
	const state = dragging
	if (!state || event.pointerId !== state.pointerId) return
	const dx = event.clientX - state.startX
	const dy = event.clientY - state.startY
	if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.moved = true
	view = { ...view, x: state.originX + dx, y: state.originY + dy }
}

function endPan(event: PointerEvent) {
	const state = dragging
	if (!state || event.pointerId !== state.pointerId) return
	const el = event.currentTarget as HTMLElement
	if (el.hasPointerCapture(event.pointerId))
		el.releasePointerCapture(event.pointerId)
	dragging = null
	if (!state.moved) return
	suppressClick = true
	setTimeout(() => (suppressClick = false), 0)
}

function handleNodeClick(id: string) {
	if (suppressClick) return
	history.jumpTo(id)
}

function showLabel(label: string, event: PointerEvent) {
	hovered = { label, x: event.clientX, y: event.clientY }
}

/** Wheel-to-zoom around the cursor; an attachment keeps the listener non-passive. */
function canvasGestures(node: HTMLDivElement) {
	const onWheel = (event: WheelEvent) => {
		event.preventDefault()
		const rect = node.getBoundingClientRect()
		const scale = Math.min(
			MAX_SCALE,
			Math.max(MIN_SCALE, view.scale * Math.exp(-event.deltaY * 0.0015))
		)
		const cursorX = event.clientX - rect.left
		const cursorY = event.clientY - rect.top
		const worldX = (cursorX - view.x) / view.scale
		const worldY = (cursorY - view.y) / view.scale
		view = {
			scale,
			x: cursorX - worldX * scale,
			y: cursorY - worldY * scale,
		}
	}
	node.addEventListener("wheel", onWheel, { passive: false })
	return () => node.removeEventListener("wheel", onWheel)
}

/** Snap the field back to the stored value when it loses focus, so a cleared or out-of-range entry doesn't linger. */
function normalizeSeekInput(
	event: FocusEvent & { currentTarget: HTMLInputElement }
) {
	event.currentTarget.value = String(seekStep)
}
</script>

<div class="flex flex-col gap-3">
	<section class="border border-line-soft bg-surface-raised p-3">
		<h2 class="pb-2 text-xs uppercase tracking-wide text-neutral-400">
			Timeline layout
		</h2>
		<label class="flex cursor-pointer items-start gap-2 text-sm">
			<input
				type="checkbox"
				checked={justifyTimeline}
				onchange={e => onToggleJustifyTimeline(e.currentTarget.checked)}
				class="mt-0.5 h-4 w-4 accent-primary-500"
			>
			<span class="flex flex-col gap-0.5">
				<span>Justify timeline</span>
				<span class="text-xs text-neutral-400">
					{#if justifyTimeline}
						The timeline stretches across the full window.
					{:else}
						The timeline is centred between the panels.
					{/if}
				</span>
			</span>
		</label>
	</section>

	<section class="border border-line-soft bg-surface-raised p-3">
		<h2 class="pb-2 text-xs uppercase tracking-wide text-neutral-400">
			Seeking
		</h2>
		<label class="flex items-center justify-between gap-3 text-sm">
			<span class="flex flex-col gap-0.5">
				<span>Arrow-key step</span>
				<span class="text-xs text-neutral-400">
					How far the left and right arrow keys jump.
				</span>
			</span>
			<span class="flex shrink-0 items-center gap-1.5">
				<input
					type="number"
					min={MIN_SEEK_STEP}
					max={MAX_SEEK_STEP}
					step="1"
					value={seekStep}
					onchange={e => onSetSeekStep(e.currentTarget.valueAsNumber)}
					onblur={normalizeSeekInput}
					aria-label="Arrow-key seek step in seconds"
					class="field w-16 px-1.5 py-0.5 text-right text-xs tabular-nums"
				>
				<span class="text-xs text-neutral-400">seconds</span>
			</span>
		</label>
	</section>

	<section class="border border-line-soft bg-surface-raised p-3">
		<div class="flex items-center justify-between gap-2 pb-2">
			<h2 class="text-xs uppercase tracking-wide text-neutral-400">
				History
			</h2>
			<div class="flex gap-1">
				<button
					type="button"
					onclick={centreOnCurrent}
					title="Centre on the current step"
					class="btn px-1.5 py-0.5 text-xs"
				>
					Centre
				</button>
				<button
					type="button"
					onclick={() => history.undo()}
					disabled={!history.canUndo}
					title="Undo (Ctrl+Z)"
					class="btn px-1.5 py-0.5 text-xs"
				>
					Undo
				</button>
				<button
					type="button"
					onclick={() => history.redo()}
					disabled={!history.canRedo}
					title="Redo (Ctrl+Y)"
					class="btn px-1.5 py-0.5 text-xs"
				>
					Redo
				</button>
			</div>
		</div>
		{#if graph.nodes.length === 0}
			<p class="text-xs text-neutral-400">No actions yet.</p>
		{:else}
			<div
				bind:this={canvasEl}
				role="application"
				aria-label="History graph. Drag to pan, scroll to zoom, and activate a node to jump to it."
				class="relative h-72 touch-none overflow-hidden border border-line-soft bg-black select-none {dragging
					? 'cursor-grabbing'
					: 'cursor-grab'}"
				onpointerdown={startPan}
				onpointermove={movePan}
				onpointerup={endPan}
				onpointercancel={endPan}
				{@attach canvasGestures}
			>
				<div
					class="absolute top-0 left-0 origin-top-left"
					style:transform="translate({view.x}px, {view.y}px) scale({view.scale})"
				>
					<svg
						class="pointer-events-none absolute top-0 left-0 overflow-visible"
						width={graph.width}
						height={graph.height}
						aria-hidden="true"
					>
						{#each graph.edges as edge (`${edge.from}→${edge.to}`)}
							<line
								x1={edge.x1}
								y1={edge.y1}
								x2={edge.x2}
								y2={edge.y2}
								stroke-width="1.5"
								class={edge.onPath
									? "stroke-primary-500"
									: "stroke-neutral-600"}
							/>
						{/each}
					</svg>
					{#each graph.nodes as node (node.id)}
						<button
							type="button"
							onclick={() => handleNodeClick(node.id)}
							onpointerenter={event =>
								showLabel(node.label, event)}
							onpointermove={event =>
								showLabel(node.label, event)}
							onpointerleave={() => (hovered = null)}
							aria-label={node.label}
							class={[
								"absolute rounded-full border transition-colors",
								node.current
									? "border-primary-300 bg-primary-500"
									: node.onPath
										? "border-neutral-300 bg-neutral-400"
										: node.redoable
											? "border-neutral-400 bg-neutral-600"
											: "border-neutral-700 bg-neutral-800 hover:border-neutral-500",
							]}
							style:left="{node.x - NODE / 2}px"
							style:top="{node.y - NODE / 2}px"
							style:width="{NODE}px"
							style:height="{NODE}px"
						></button>
					{/each}
				</div>
				{#if currentLabel}
					<p
						class="pointer-events-none absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate border border-line bg-black/80 px-1.5 py-0.5 text-xs text-neutral-300"
					>
						{currentLabel}
					</p>
				{/if}
			</div>
			{#if hovered}
				<div
					class="pointer-events-none fixed z-50 border border-line bg-surface-raised px-1.5 py-0.5 text-xs whitespace-nowrap text-neutral-200 shadow-lg shadow-black/50"
					style:left="{hovered.x + 12}px"
					style:top="{hovered.y + 12}px"
				>
					{hovered.label}
				</div>
			{/if}
		{/if}
	</section>

	<section class="border border-line-soft bg-surface-raised p-3">
		<h2 class="pb-2 text-xs uppercase tracking-wide text-neutral-400">
			Keyboard shortcuts
		</h2>
		<dl class="flex flex-col gap-1.5 text-xs text-neutral-400">
			{#each shortcuts as shortcut (shortcut.description)}
				<div class="flex items-center justify-between gap-3">
					<dt>{shortcut.description}</dt>
					<dd class="flex shrink-0 gap-1">
						{#each shortcut.keys as key (key)}
							<kbd class="min-w-5 text-center">
								{key}
							</kbd>
						{/each}
					</dd>
				</div>
			{/each}
		</dl>
	</section>
</div>
