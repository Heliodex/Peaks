import adapter from "@sveltejs/adapter-static"
import { sveltekit } from "@sveltejs/kit/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter({
				assets: "build",
				fallback: "index.html",
				pages: "build",
				precompress: false,
				strict: false,
			}),
			compilerOptions: {
				experimental: { async: true },
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes("node_modules")
						? undefined
						: true,
			},
			experimental: { forkPreloads: true },
		}),
	],
})
