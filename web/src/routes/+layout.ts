// The production frontend is static. wt serves static/ and falls back to index.html
// for unknown HTML navigations, so the app's /{state} share links keep working.
export const ssr = false
export const prerender = false
