<script lang="ts">
import { onDestroy } from "svelte"
import { ResizeGrip, type ResizeOrientation } from "./resize-grip.js"

interface Props {
	label: string
	max: number
	min: number
	/** Edge class that places the handle, such as `resize-handle-left`. */
	modifier: string
	onkeydown(event: KeyboardEvent): void
	onpointerdown(event: PointerEvent): void
	orientation: ResizeOrientation
	value: number
}

const {
	label,
	max,
	min,
	modifier,
	onkeydown,
	onpointerdown,
	orientation,
	value,
}: Props = $props()

const grip = new ResizeGrip()
onDestroy(() => grip.destroy())
</script>

<!-- A focusable separator is a window splitter: the resize handle is keyboard-operable, which the linters can't tell from a static separator. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- biome-ignore lint/a11y/useSemanticElements: A window splitter is not an <hr>. -->
<div
	aria-label={label}
	aria-orientation={orientation}
	aria-valuemax={Math.round(max)}
	aria-valuemin={Math.round(min)}
	aria-valuenow={Math.round(value)}
	class={[
		"resize-handle",
		modifier,
		"hidden hover:bg-primary-500/10 lg:block",
	]}
	{onkeydown}
	onpointerdown={event => grip.begin(event, orientation, onpointerdown)}
	onpointerleave={event => grip.leave(event)}
	onpointermove={event => grip.track(event, orientation)}
	role="separator"
	tabindex="0"
>
	<span aria-hidden="true" class="resize-grip"></span>
</div>

<style>
.resize-handle {
	position: absolute;
	z-index: 30;
	touch-action: none;
}

/* A faint grip along each separator hints that the pane can be dragged; it lights up on hover and keyboard focus. */
.resize-grip {
	position: absolute;
	top: 50%;
	left: 50%;
	background: var(--color-neutral-600);
	opacity: 0.35;
	translate: -50% -50%;
	transition:
		opacity 120ms ease,
		background-color 120ms ease;
}

/* On the vertical separators the grip tracks the pointer's height (falling back to the centre). */
.resize-handle-left .resize-grip,
.resize-handle-right .resize-grip {
	top: var(--grip-position, 50%);
	width: 2px;
	height: 2.5rem;
}

/* On the timeline separator it tracks the pointer's horizontal position instead. */
.resize-handle-timeline .resize-grip {
	left: var(--grip-position, 50%);
	width: 2.5rem;
	height: 2px;
}

.resize-handle:hover .resize-grip,
.resize-handle:focus-visible .resize-grip,
.resize-handle:active .resize-grip {
	background: var(--color-primary-500);
	opacity: 1;
}

.resize-handle-right {
	top: 0;
	right: var(--right-width);
	bottom: var(--timeline-height);
	width: 0.75rem;
	cursor: col-resize;
	transform: translateX(50%);
}

.resize-handle-left {
	top: 0;
	bottom: var(--timeline-height);
	left: var(--left-width);
	width: 0.75rem;
	cursor: col-resize;
	transform: translateX(-50%);
}

.resize-handle-timeline {
	right: 0;
	bottom: var(--timeline-height);
	left: 0;
	height: 0.75rem;
	cursor: row-resize;
	transform: translateY(50%);
}

/* The timeline separator only spans the centre column when the timeline is centred. */
:global(.timeline-centred) .resize-handle-timeline {
	right: var(--right-width);
	left: var(--left-width);
}
</style>
