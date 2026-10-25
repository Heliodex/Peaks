<script lang="ts">
import "./layout.css"
import favicon from "#lib/assets/favicon.svg"

let { children } = $props()
</script>

<svelte:head>
	<link href={favicon} rel="icon">
	<title>Peaks</title>
</svelte:head>
{@render children()}
