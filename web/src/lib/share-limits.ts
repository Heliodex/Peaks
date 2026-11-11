// Size and count limits shared by the share encoder, codec and parser.
// Keep links below common request-line limits imposed by browsers and proxies.
export const MAX_ENCODED_SHARE_LENGTH = 4_096
export const MAX_DECODED_SHARE_BYTES = 1_048_576
export const MAX_PROJECT_ENTRIES = 200
export const MAX_SELECTIONS = 500
export const MAX_TOTAL_SELECTIONS = 2_000
export const MAX_IDLE_RANGES = 300
export const MAX_TOTAL_IDLE_RANGES = 5_000
export const MAX_ID_LENGTH = 128
export const MAX_NAME_LENGTH = 256
export const MAX_REASON_LENGTH = 64
export const MAX_DURATION_SECONDS = 60 * 60 * 24 * 365
export const MAX_DURATION_MS = MAX_DURATION_SECONDS * 1000
