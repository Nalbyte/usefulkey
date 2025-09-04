/**
 * No-op analytics adapter.
 *
 * Does not persist or transmit events. Safe default for disabling analytics.
 */
import type { AnalyticsAdapter } from "../../types/common";

export class NoopAnalytics implements AnalyticsAdapter {
	readonly ready?: Promise<void>;
	async track(
		_event: string,
		_payload: Record<string, unknown>,
	): Promise<void> {
		// intentionally does nothing
	}
}
