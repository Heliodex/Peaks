import pc from "picocolors"

const { red } = pc

type ErrorLogger = (...args: unknown[]) => void

export function logServerError(error: unknown, logger?: ErrorLogger): void {
	try {
		const log = logger ?? console.error
		if (typeof error === "object" && error !== null && "status" in error) {
			const status = (error as { status?: unknown }).status
			if (typeof status === "number") {
				log(status, red(String(error)))
				return
			}
		}

		log(error)
	} catch {
		// Error handlers must not throw, even when the caught value is hostile.
	}
}
