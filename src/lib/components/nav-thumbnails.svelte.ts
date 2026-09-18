// Overview thumbnails for the navigator: captured once per source and reused across mounts.
import { untrack } from "svelte"
import type { CapturedFrame } from "#lib/frame-capture.js"
import { createObjectUrlCache } from "#lib/object-url-cache.js"
import { loadThumbnails, saveThumbnail } from "#lib/thumbnail-store.js"

// Number of thumbnails captured across the whole video for the overview strip
export const NAV_FRAME_COUNT = 24
// How many sources' overview frames to keep at once.
const MAX_CACHED_NAV = 12
// Persistent-storage namespace for overview thumbnails.
const NAV_THUMBNAIL_KIND = "nav"

// Overview thumbnails are stable per source, so keep them across mounts and skip re-capturing when the same timelapse is reopened.
const navFrameCache = createObjectUrlCache<string[]>({
	max: MAX_CACHED_NAV,
	kind: NAV_THUMBNAIL_KIND,
	urls: frames => frames,
})

type NavThumbnailsOptions = {
	src: () => string
	duration: () => number
	/** Capture a frame from the shared timeline pool (avoids another video). */
	captureFrame: (time: number, epsilon?: number) => Promise<CapturedFrame>
}

export class NavThumbnails {
	readonly #options: NavThumbnailsOptions

	frames = $state<string[]>([])

	constructor(options: NavThumbnailsOptions) {
		this.#options = options

		$effect(() => {
			const src = this.#options.src()
			const total = this.#options.duration()
			if (!src || total <= 0) return

			const cached = untrack(() => navFrameCache.get(src))
			if (cached) {
				this.frames = cached
				return
			}

			let cancelled = false
			// Frames captured by this run. If the run is cancelled before its frames are cached, their object URLs are revoked so they can't leak.
			let frames: string[] = []
			let retained = false

			void (async () => {
				// Reuse thumbnails captured in a previous session, if any.
				const stored = await loadThumbnails(NAV_THUMBNAIL_KIND, src)
				if (cancelled) return
				if (stored.length > 0) {
					for (const { key, blob } of stored) {
						frames[key] = URL.createObjectURL(blob)
					}
					navFrameCache.set(src, frames)
					retained = true
					this.frames = frames
					return
				}

				this.frames = []
				// Capture sequentially through the shared timeline pool, so the overview doesn't open a video element of its own.
				for (let i = 0; i < NAV_FRAME_COUNT; i++) {
					if (cancelled) return
					const time = (total * i) / (NAV_FRAME_COUNT - 1)
					try {
						const captured = await this.#options.captureFrame(time)
						if (cancelled) {
							URL.revokeObjectURL(captured.url)
							return
						}
						const next = [...frames]
						next[i] = captured.url
						frames = next
						this.frames = next
						void saveThumbnail(
							NAV_THUMBNAIL_KIND,
							src,
							i,
							captured.blob
						)
					} catch {
						// Leave a gap for any frame we couldn't capture.
					}
				}
				if (cancelled || frames.length === 0) return
				navFrameCache.set(src, frames)
				retained = true
			})()

			return () => {
				cancelled = true
				if (!retained) {
					for (const url of frames) URL.revokeObjectURL(url)
				}
			}
		})
	}
}
