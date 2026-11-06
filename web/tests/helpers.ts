// Shared test helpers. Bun has no `localStorage`, so storage-backed modules are exercised against an in-memory stand-in.

type Global = typeof globalThis & { localStorage?: Storage }

/** Install an in-memory `localStorage` for the current test file. */
export function installLocalStorage(): void {
	const store = new Map<string, string>()
	const storage: Storage = {
		clear: () => store.clear(),
		getItem: key => store.get(key) ?? null,
		key: index => [...store.keys()][index] ?? null,
		get length() {
			return store.size
		},
		removeItem: key => void store.delete(key),
		setItem: (key, value) => void store.set(key, value),
	}
	;(globalThis as Global).localStorage = storage
}

/** Remove the in-memory `localStorage` again. */
export function removeLocalStorage(): void {
	delete (globalThis as Global).localStorage
}

/** Empty the installed `localStorage`, if any. */
export function clearLocalStorage(): void {
	;(globalThis as Global).localStorage?.clear()
}
