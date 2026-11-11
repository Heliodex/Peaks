// Byte-level encoding for share links: base64url text around raw DEFLATE, with a bounded decompressor.
import { MAX_DECODED_SHARE_BYTES } from "./share-limits.js"

export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

export function toBase64Url(bytes: Uint8Array): string {
	let binary = ""
	for (const byte of bytes) binary += String.fromCodePoint(byte)
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "")
}

export function fromBase64Url(value: string): Uint8Array {
	if (!BASE64URL_PATTERN.test(value)) throw new Error("Invalid base64url")
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++)
		bytes[i] = binary.codePointAt(i) ?? 0
	return bytes
}

/** Copy a (possibly offset) byte view into a plain ArrayBuffer for Blob. */
const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
	bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer

/** Compress `bytes` with raw DEFLATE, which carries no zlib/gzip wrapper. */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([asArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Decompress at most `MAX_DECODED_SHARE_BYTES` without buffering a bomb. */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
	const reader = new Blob([asArrayBuffer(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"))
		.getReader()
	const chunks: Uint8Array[] = []
	let length = 0

	try {
		while (true) {
			const result = await reader.read()
			if (result.done) break
			const chunk = result.value
			if (length + chunk.byteLength > MAX_DECODED_SHARE_BYTES) {
				await reader.cancel()
				return null
			}
			length += chunk.byteLength
			chunks.push(chunk)
		}
	} catch {
		return null
	} finally {
		reader.releaseLock()
	}

	const output = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.byteLength
	}
	return output
}
