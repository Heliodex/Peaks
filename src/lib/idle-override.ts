// Persists the "ignore idle time" override per timelapse. Low-FPS recordings
// can make idle detection mark real work as idle, so the reviewer can turn the
// automatic idle removal off.

const STORAGE_PREFIX = "peaks:ignore-idle:v1:"

function storageKey(timelapseId: string): string {
	return `${STORAGE_PREFIX}${timelapseId}`
}

export function loadIgnoreIdle(timelapseId: string): boolean {
	if (!timelapseId || typeof localStorage === "undefined") return false
	try {
		return localStorage.getItem(storageKey(timelapseId)) === "1"
	} catch {
		return false
	}
}

export function saveIgnoreIdle(timelapseId: string, value: boolean): void {
	if (!timelapseId || typeof localStorage === "undefined") return
	try {
		if (value) {
			localStorage.setItem(storageKey(timelapseId), "1")
		} else {
			localStorage.removeItem(storageKey(timelapseId))
		}
	} catch {
		// Storage may be full or disabled; the override just won't persist.
	}
}
