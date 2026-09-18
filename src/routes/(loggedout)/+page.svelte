<script lang="ts">
import { lapseLogin } from "../(main)/api.remote.js"
</script>

<main class="flex min-h-screen items-center justify-center p-4">
	<div
		class="relative w-full max-w-sm border border-line bg-surface p-8 text-center shadow-2xl shadow-black"
	>
		<div
			class="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-emerald-500 via-primary-400 to-green-500"
			aria-hidden="true"
		></div>
		<h1 class="text-3xl font-semibold tracking-tight">Peaks</h1>
		<small class="mt-1 block uppercase tracking-wide text-neutral-400">
			The ultimate timelapse review tool
		</small>

		<small
			class="mt-4 inline-block border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-400"
		>
			Under construction
		</small>

		<p class="pt-6 text-sm text-neutral-300">
			Log in with your Lapse account to continue.
		</p>

		<form {...lapseLogin} class="w-full pt-4">
			<button
				type="submit"
				class="w-full bg-linear-to-r from-emerald-500 to-green-500 px-4 py-2 font-medium text-white transition hover:from-emerald-600 hover:to-green-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 active:translate-y-px"
			>
				Log in with Lapse
			</button>
		</form>
	</div>
</main>
