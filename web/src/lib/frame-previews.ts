// Types and pure helpers for the scrubbing previews, kept free of runes so they can be tested directly.

export interface PreviewRequest {
	frameRate: number
	url: string
}

export type PreviewMessage =
	| { blob: Blob; index: number; type: "frame" }
	| { count: number; type: "done" }
	| { message: string; type: "error" }

/**
 * The index of the preview frame nearest `time`, or -1 when there are no frames yet.
 * Frame indices match `video-decode.ts`: they count from the first frame shown.
 */
export function previewFrameIndex(
	time: number,
	frameRate: number,
	count: number,
): number {
	if (count <= 0 || frameRate <= 0 || !Number.isFinite(time)) return -1
	const index = Math.round(time * frameRate)
	return Math.min(count - 1, Math.max(0, index))
}
