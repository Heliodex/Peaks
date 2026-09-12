<script lang="ts">
import {
	ANNOTATION_REASONS,
	describeTimelapse,
	findAnnotationReason,
	nonIdleDuration,
} from "#lib/annotations.js"
import type { IdleRange } from "#lib/idle-time.js"
import {
	formatClock,
	PLAYBACK_TO_RECORDED,
	type TimelineSelection,
} from "#lib/timeline.js"
import { formatCreatedAt, formatDuration } from "./review-format.js"
import type { ReviewTimelapse } from "./review-types.js"

let {
	timelapse,
	selections = $bindable<TimelineSelection[]>([]),
	idleRanges,
	idleAnalyzing,
	ignoreIdle,
	onToggleIgnoreIdle,
}: {
	timelapse: ReviewTimelapse
	selections?: TimelineSelection[]
	idleRanges: IdleRange[]
	idleAnalyzing: boolean
	ignoreIdle: boolean
	onToggleIgnoreIdle: (value: boolean) => void
} = $props()

const sortedSelections = $derived(
	[...selections].sort((a, b) => a.start - b.start)
)

/** Idle ranges that count towards the maths (none while overridden). */
const effectiveIdleRanges = $derived(ignoreIdle ? [] : idleRanges)

/** Time removed from the actual duration by the chosen annotation reasons, in recorded seconds. */
const annotationDeflation = $derived(
	selections.reduce((sum, selection) => {
		const reason = findAnnotationReason(selection.reason)
		if (!reason) return sum
		return (
			sum +
			nonIdleDuration(selection, effectiveIdleRanges) * reason.deflation
		)
	}, 0) * PLAYBACK_TO_RECORDED
)

/** Time removed from the actual duration as idle, in recorded seconds. */
const idleDuration = $derived(
	effectiveIdleRanges.reduce(
		(sum, range) => sum + (range.end - range.start),
		0
	) * PLAYBACK_TO_RECORDED
)

const actualDuration = $derived(
	Math.max(0, timelapse.duration - idleDuration - annotationDeflation)
)

const description = $derived(
	describeTimelapse({
		id: timelapse.id,
		duration: timelapse.duration,
		idleRanges: effectiveIdleRanges,
		selections,
	})
)

function setSelectionReason(id: string, reason: string) {
	selections = selections.map(selection =>
		selection.id === id ? { ...selection, reason } : selection
	)
}

function removeSelection(id: string) {
	selections = selections.filter(selection => selection.id !== id)
}

// Copy-to-clipboard feedback for the description card.
let copied = $state(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		copied = true
		clearTimeout(copyTimer)
		copyTimer = setTimeout(() => {
			copied = false
		}, 1500)
	} catch {
		// Clipboard access may be denied; leave the button unchanged.
	}
}

$effect(() => () => clearTimeout(copyTimer))
</script>

<aside
	class="area-right flex min-h-0 flex-col gap-3 overflow-y-auto border-neutral-500 p-3 lg:border-r"
>
	<dl class="grid grid-cols-2 gap-2">
		<div class="border border-neutral-500 p-3">
			<dt class="text-xs uppercase tracking-wide text-neutral-500">
				Recorded
			</dt>
			<dd class="pt-1 font-medium">
				{formatDuration(timelapse.duration)}
			</dd>
		</div>
		<div class="border border-neutral-500 p-3">
			<dt class="text-xs uppercase tracking-wide text-neutral-500">
				Actual time
			</dt>
			<dd class="pt-1 font-medium">
				{formatDuration(actualDuration)}
			</dd>
			{#if idleAnalyzing && !ignoreIdle}
				<p class="pt-0.5 text-xs text-amber-600">
					Analyzing idle frames…
				</p>
			{:else}
				{#if idleDuration > 0}
					<p class="pt-0.5 text-xs text-neutral-500">
						-{formatDuration(idleDuration)}
						idle
					</p>
				{/if}
				{#if annotationDeflation > 0}
					<p class="pt-0.5 text-xs text-neutral-500">
						-{formatDuration(annotationDeflation)}
						annotations
					</p>
				{/if}
			{/if}
		</div>
		<div class="border border-neutral-500 p-3">
			<dt class="text-xs uppercase tracking-wide text-neutral-500">
				Created
			</dt>
			<dd class="pt-1 font-medium">
				{formatCreatedAt(timelapse.createdAt)}
			</dd>
		</div>
		<div class="border border-neutral-500 p-3">
			<dt class="text-xs uppercase tracking-wide text-neutral-500">
				Visibility
			</dt>
			<dd class="pt-1 font-medium">
				{timelapse.visibility}
			</dd>
		</div>
	</dl>

	<section class="flex flex-col gap-1">
		<h2 class="font-medium">Selections</h2>
		{#if sortedSelections.length > 0}
			<ul class="flex flex-col gap-1 text-sm">
				{#each sortedSelections as sel, i (sel.id)}
					{const reason = $derived(findAnnotationReason(sel.reason))}
					<li class="flex flex-wrap items-center gap-2">
						<span>
							Selection {i + 1}:
							<span class="font-medium"
								>{formatClock(sel.start)}</span
							>-<span class="font-medium"
								>{formatClock(sel.end)}</span
							>
						</span>
						<select
							aria-label="Annotation reason for selection {i +
								1}"
							value={sel.reason ?? ""}
							onchange={e =>
								setSelectionReason(
									sel.id,
									e.currentTarget.value
								)}
							class="border border-neutral-500 bg-neutral-800 px-1 py-0.5 text-sm"
						>
							<option value="">Select a reason…</option>
							{#each ANNOTATION_REASONS as annotation (annotation.id)}
								<option value={annotation.id}>
									{annotation.label}
								</option>
							{/each}
						</select>
						<button
							type="button"
							onclick={() => removeSelection(sel.id)}
							aria-label="Delete selection {i + 1}"
							class="border border-neutral-500 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-red-500 hover:text-red-500"
						>
							Delete
						</button>
						{#if reason && reason.deflation > 0}
							<span class="text-xs text-neutral-500">
								-{formatDuration(
									nonIdleDuration(
										sel,
										effectiveIdleRanges
									) *
										reason.deflation *
										PLAYBACK_TO_RECORDED
								)}
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-neutral-500">
				Drag across the timeline to select an annotation.
			</p>
		{/if}
	</section>

	{#if idleRanges.length > 0 || ignoreIdle}
		<div
			class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-700 pt-2 text-xs text-neutral-500"
		>
			<label class="flex items-center gap-1.5">
				<input
					type="checkbox"
					checked={ignoreIdle}
					onchange={e =>
						onToggleIgnoreIdle(e.currentTarget.checked)}
					class="h-3.5 w-3.5 accent-blue-500"
				>
				Ignore idle time
			</label>
			{#if !ignoreIdle}
				<p class="flex items-center gap-2">
					<span
						class="inline-block h-2 w-3 border border-amber-400/50 bg-amber-400/25"
					></span>
					Amber regions have no visual changes (time spent away).
				</p>
			{/if}
		</div>
	{/if}

	<section class="border-t border-neutral-700 pt-2">
		<div class="flex items-center justify-between gap-2 pb-1">
			<h2 class="font-medium">Description</h2>
			<button
				type="button"
				onclick={() => copyText(description)}
				class="border border-neutral-500 px-2 py-0.5 text-xs hover:bg-neutral-800"
			>
				{copied ? "Copied!" : "Copy"}
			</button>
		</div>
		<p class="text-sm text-neutral-300 select-text">
			{description}
		</p>
	</section>
</aside>
