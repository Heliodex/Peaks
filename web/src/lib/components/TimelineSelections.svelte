<script lang="ts">
import { selectionColors } from "#lib/annotations.js"
import {
	percentWithin,
	type TimelineSelection,
	type ViewWindow,
} from "#lib/timeline.js"
import type { SelectionEditor } from "./timeline-selection.svelte.js"

interface Props {
	editor: SelectionEditor
	onselectionmenu(
		event: MouseEvent,
		selection: TimelineSelection,
		index: number,
	): void
	selections: TimelineSelection[]
	view: ViewWindow
}

const { editor, onselectionmenu, selections, view }: Props = $props()
</script>

{#snippet selectionHandle(
	side: "start" | "end",
	sel: TimelineSelection,
	handleClass: string,
)}
	<div
		class={[
			"absolute inset-y-0",
			side === "start" ? "-left-1" : "-right-1",
			"flex w-2 cursor-ew-resize items-center justify-center transition-opacity",
			editor.controlsClass(sel.id),
		]}
		data-resize={side}
		data-selection-id={sel.id}
		role="presentation"
	>
		<span
			class={["h-6 w-1 transition-colors", handleClass, "shadow"]}
		></span>
	</div>
{/snippet}

<!-- Selections, clamped to the visible window -->
{#each selections as sel, i (sel.id)}
	{const visibleStart = $derived(Math.max(sel.start, view.start))}
	{const visibleEnd = $derived(Math.min(sel.end, view.end))}
	{const color = $derived(selectionColors(sel.reason))}
	{#if visibleEnd > visibleStart}
		<!-- The selection is pointer-dragged and right-clicked; keyboard editing lives in the selections panel. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- biome-ignore lint/a11y/noStaticElementInteractions: selection overlays are pointer-driven; keyboard editing lives in the selections panel -->
		<div
			class={[
				"group absolute inset-y-0",
				editor.isCreating(sel.id)
					? "cursor-text"
					: "cursor-grab active:cursor-grabbing",
			]}
			data-selection-id={sel.id}
			oncontextmenu={event => onselectionmenu(event, sel, i)}
			style:left="{percentWithin(visibleStart, view)}%"
			style:width="{percentWithin(visibleEnd, view)
				- percentWithin(visibleStart, view)}%"
		>
			<div
				class={[
					"pointer-events-none absolute inset-0 border-x-2 transition-[filter,background-color,border-color] group-hover:brightness-125",
					color.border,
					color.fill,
				]}
			></div>

			{#if sel.start >= view.start}
				{@render selectionHandle("start", sel, color.handle)}
			{/if}

			{#if sel.end <= view.end}
				{@render selectionHandle("end", sel, color.handle)}
			{/if}

			<button
				aria-label="Delete selection"
				class={[
					"btn btn-danger absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-surface text-xs shadow transition-[color,background-color,border-color,opacity]",
					editor.controlsClass(sel.id),
				]}
				data-delete={sel.id}
				onclick={e => editor.deleteSelection(sel.id, e)}
				title="Delete selection"
				type="button"
			>
				×
			</button>
		</div>
	{/if}
{/each}
