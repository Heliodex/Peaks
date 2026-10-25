import { redirect } from "@sveltejs/kit"

// Redirect to homepage if user is logged in
export function load({ locals }: { locals: App.Locals }) {
	if (locals.session) redirect(302, "/home")
}
