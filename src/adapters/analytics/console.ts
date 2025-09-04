/**
 * Console-based analytics adapter.
 *
 * Useful for local development and tests. Simply logs events to stdout.
 */
import type { AnalyticsAdapter } from "../../types/common";

export class ConsoleAnalytics implements AnalyticsAdapter {
	readonly ready?: Promise<void>;
	/** Log the event name and payload to the console. */
	async track(event: string, payload: Record<string, unknown>): Promise<void> {
		console.log(`[usefulkey:analytics] ${event}`, payload);
	}
}
