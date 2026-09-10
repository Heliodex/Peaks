// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { User } from "#lib/server/auth.js"

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			session: string | null
			user: User | null
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}
