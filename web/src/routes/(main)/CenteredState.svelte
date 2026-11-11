<script lang="ts">
interface Props {
	loading?: boolean
	message: string
}

const { loading = false, message }: Props = $props()
</script>

<section
	class="area-video flex flex-col items-center justify-center gap-3 p-4 text-center"
>
	{#if loading}
		<span aria-hidden="true" class="spinner"></span>
	{/if}
	<p class="text-sm text-neutral-400">{message}</p>
</section>

<style>
.spinner {
	width: 1.25rem;
	height: 1.25rem;
	border: 2px solid var(--color-neutral-700);
	border-top-color: var(--color-primary-500);
	border-radius: 50%;
	animation: spin 0.7s linear infinite;
}

@keyframes spin {
	to {
		rotate: 360deg;
	}
}

@media (prefers-reduced-motion: reduce) {
	.spinner {
		animation: none;
	}
}
</style>
