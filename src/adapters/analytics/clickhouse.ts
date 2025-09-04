/**
 * ClickHouse analytics adapter.
 *
 * Buffers events in memory and periodically flushes them to ClickHouse via
 * either a provided client or the HTTP interface (JSONEachRow). Designed to be
 * resilient: failed flushes re-queue the batch and stop draining until the next
 * interval.
 */
import type { AnalyticsAdapter, Milliseconds } from "../../types/common";

type ClickHouseClientInsertArgs = {
	table: string;
	values: Array<Record<string, unknown>> | string;
	format?: string;
	database?: string;
};

export interface ClickHouseClientLike {
	insert: (args: ClickHouseClientInsertArgs) => Promise<unknown>;
}

export interface ClickHouseAnalyticsOptions {
	/** Base URL to ClickHouse HTTP endpoint, e.g. http://localhost:8123 */
	url: string;
	/** Database name. Default: "default" */
	database?: string;
	/** Table name. Default: "usefulkey_events" */
	table?: string;
	/** If provided, use a direct ClickHouse client instead of HTTP */
	client?: ClickHouseClientLike;
	/** Username for basic auth (optional) */
	username?: string;
	/** Password for basic auth (optional) */
	password?: string;
	/** Additional headers to include with requests */
	headers?: Record<string, string>;
	/** Max events per batch flush. Default: 50 */
	batchSize?: number;
	/** Flush interval for pending events. Default: 2000 ms */
	flushIntervalMs?: Milliseconds;
	/** Request timeout. Default: 10000 ms */
	timeoutMs?: Milliseconds;
}

type QueuedEvent = {
	event: string;
	payload: Record<string, unknown>;
	ts: string; // ISO timestamp
};

export class ClickHouseAnalytics implements AnalyticsAdapter {
	private readonly url: string;
	private readonly database: string;
	private readonly table: string;
	private readonly headers: Record<string, string>;
	private readonly batchSize: number;
	private readonly flushIntervalMs: number;
	private readonly timeoutMs: number;
	private readonly client?: ClickHouseClientLike;

	private readonly queue: QueuedEvent[] = [];
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private isFlushing = false;

	readonly ready?: Promise<void>;

	constructor(options: ClickHouseAnalyticsOptions) {
		this.url = (options.url ?? "").replace(/\/$/, "");
		this.database = options.database ?? "default";
		this.table = options.table ?? "usefulkey_events";
		this.batchSize = Math.max(1, options.batchSize ?? 50);
		this.flushIntervalMs = options.flushIntervalMs ?? 2000;
		this.timeoutMs = options.timeoutMs ?? 10000;
		this.client = options.client;

		const hdrs: Record<string, string> = {
			"Content-Type": "application/json; charset=utf-8",
			...(options.headers ?? {}),
		};
		if (!this.client) {
			if (options.username && options.password) {
				const token = Buffer.from(
					`${options.username}:${options.password}`,
					"utf8",
				).toString("base64");
				hdrs.Authorization = `Basic ${token}`;
			}
		}
		this.headers = hdrs;

		// Ensure timer creation is visible as readiness, in case callers want to await.
		this.ready = Promise.resolve().then(() => this.startTimer());
	}

	async track(event: string, payload: Record<string, unknown>): Promise<void> {
		this.queue.push({ event, payload, ts: new Date().toISOString() });
		if (this.queue.length >= this.batchSize) {
			// Fire and forget flush; do not block caller
			void this.flush();
		}
	}

	private startTimer(): void {
		if (this.flushIntervalMs > 0 && !this.flushTimer) {
			this.flushTimer = setInterval(() => {
				void this.flush();
			}, this.flushIntervalMs);
			// Do not keep process alive solely due to timer
			if (typeof this.flushTimer.unref === "function") {
				this.flushTimer.unref();
			}
		}
	}

	private stopTimer(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
	}

	private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
		if (!ms || ms <= 0) return p;
		let timer: ReturnType<typeof setTimeout>;
		return await Promise.race([
			p.finally(() => clearTimeout(timer)),
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`ClickHouse request timed out after ${ms}ms`)),
					ms,
				);
			}),
		]);
	}

	private buildInsertUrl(): string {
		const query = `INSERT INTO ${this.database}.${this.table} (event, payload, ts) FORMAT JSONEachRow`;
		const qp = new URLSearchParams({ query });
		return `${this.url}/?${qp.toString()}`;
	}

	private buildBody(rows: QueuedEvent[]): string {
		// Store payload as string for broad ClickHouse compatibility
		return rows
			.map((r) =>
				JSON.stringify({
					event: r.event,
					payload: JSON.stringify(r.payload),
					ts: r.ts,
				}),
			)
			.join("\n");
	}

	private async flush(): Promise<void> {
		if (this.isFlushing) return;
		if (this.queue.length === 0) return;
		this.isFlushing = true;

		try {
			while (this.queue.length > 0) {
				const batch = this.queue.splice(0, this.batchSize);
				if (batch.length === 0) break;

				// Prefer direct client if provided
				if (this.client) {
					const values = batch.map((r) => ({
						event: r.event,
						payload: JSON.stringify(r.payload),
						ts: r.ts,
					}));
					try {
						await this.client.insert({
							database: this.database,
							table: this.table,
							values,
							format: "JSONEachRow",
						});
					} catch {
						// Re-queue and stop draining on failure
						this.queue.unshift(...batch);
						break;
					}
				} else {
					const url = this.buildInsertUrl();
					const body = this.buildBody(batch);
					const req = fetch(url, {
						method: "POST",
						headers: this.headers,
						body,
					});
					try {
						const res = await this.withTimeout(req, this.timeoutMs);
						if (!res.ok) {
							this.queue.unshift(...batch);
							break; // stop draining on failure
						}
					} catch {
						this.queue.unshift(...batch);
						break; // stop draining on failure
					}
				}
			}
		} finally {
			this.isFlushing = false;
		}
	}

	/** Flush all pending events (drains the queue). */
	public async flushAll(): Promise<void> {
		await this.flush();
	}

	/** Stop background timer and flush remaining events. */
	public async close(): Promise<void> {
		this.stopTimer();
		await this.flushAll();
	}
}
