<script lang="ts">
import { lapseLogin } from "../(main)/api.remote.js"
</script>

<main class="flex min-h-screen items-center justify-center p-4">
	<div
		class="w-full max-w-sm border-2 border-neutral-700 bg-neutral-900/70 p-8 text-center shadow-2xl"
	>
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">Peaks</h1>
			<small class="block uppercase text-neutral-400">
				The ultimate timelapse review tool
			</small>

			<small class="block pt-2 text-amber-500">
				Peaks is currently under construction.
			</small>

			<p class="pt-6 text-sm text-neutral-300">
				Log in with your Lapse account to continue.
			</p>
		</div>

		<form {...lapseLogin} class="w-full pt-4">
			<button
				type="submit"
				class="w-full bg-linear-to-r from-emerald-500 to-green-500 px-4 py-2 font-medium text-white transition hover:from-emerald-600 hover:to-green-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:translate-0.5"
			>
				Log in with Lapse
			</button>
		</form>
	</div>
</main>
