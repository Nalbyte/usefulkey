/** Error normalization utilities. */
import type { UsefulKeyError } from "../types/common";

/**
 * Normalize an unknown thrown value into a `UsefulKeyError` suitable for
 * returning from UsefulKey APIs.
 *
 * @param err - The unknown thrown value to normalize.
 * @param fallbackCode - Error code to use when the thrown value does not
 * have a string `code` property.
 * @param meta - Optional metadata to merge into the resulting error's `meta`.
 * @returns A well-formed `UsefulKeyError` with preserved details when possible.
 */
export function toError(
	err: unknown,
	fallbackCode: string,
	meta?: Record<string, unknown>,
): UsefulKeyError {
	const message = err instanceof Error ? err.message : String(err);
	if (err && typeof err === "object") {
		const anyErr = err as { code?: unknown; message?: unknown };
		const code = typeof anyErr.code === "string" ? anyErr.code : fallbackCode;
		if (typeof anyErr.message === "string") {
			return { code, message: anyErr.message, cause: err, meta };
		}
		return { code, message, cause: err, meta };
	}
	return { code: fallbackCode, message, cause: err, meta };
}
