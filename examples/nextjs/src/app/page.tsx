"use client";

export default function Home() {
	async function createKey() {
		const res = await fetch("/api/keys", { method: "POST" });
		const data = await res.json();
		alert(JSON.stringify(data, null, 2));
	}

	async function verifyHeader() {
		const key = prompt("Paste key for header verification:") || "";
		const res = await fetch("/api/verify", {
			headers: { "x-api-key": key },
		});
		const data = await res.json();
		alert(JSON.stringify(data, null, 2));
	}

	async function verifyJson() {
		const key = prompt("Paste key for JSON verification:") || "";
		const res = await fetch("/api/verify", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ key }),
		});
		const data = await res.json();
		alert(JSON.stringify(data, null, 2));
	}

	return (
		<div className="font-sans min-h-screen p-8 flex flex-col items-center gap-6">
			<h1 className="text-2xl font-semibold">
				UsefulKey Next.js minimal example
			</h1>
			<p className="text-sm opacity-80">
				Endpoints: GET /api/health, POST /api/keys, GET/POST /api/verify
			</p>
			<div className="flex gap-3">
				<button
					type="button"
					className="px-3 py-2 rounded border"
					onClick={createKey}
				>
					Create Key
				</button>
				<button
					type="button"
					className="px-3 py-2 rounded border"
					onClick={verifyHeader}
				>
					Verify (header)
				</button>
				<button
					type="button"
					className="px-3 py-2 rounded border"
					onClick={verifyJson}
				>
					Verify (JSON)
				</button>
			</div>
			<div className="text-xs opacity-60">
				In production, protect key creation with admin auth or remove the
				endpoint.
			</div>
		</div>
	);
}
