<script lang="ts">
import CopyButton from "#lib/components/CopyButton.svelte"

let { description }: { description: string } = $props()
</script>

<section class="border-t border-neutral-700 pt-2">
	<div class="flex items-center justify-between gap-2 pb-1">
		<h3 class="text-xs uppercase tracking-wide text-neutral-500">
			Project description
		</h3>
		<CopyButton text={description} />
	</div>
	<p
		class="text-xs text-neutral-300 select-text whitespace-pre-wrap wrap-break-word"
	>
		{description}
	</p>
</section>
