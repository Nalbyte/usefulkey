import type { APIContext } from "astro";
import { ADMIN_KEY } from "../../../../lib/constants";
import { uk } from "../../../../lib/usefulkey";

export const prerender = false;

// Create a pro key requires the admin key
export async function POST(ctx: APIContext) {
	const adminKey = ctx.request.headers.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return new Response(JSON.stringify({ error: "Invalid admin key" }), {
			status: 401,
			headers: { "content-type": "application/json" },
		});
	}

	const res = await uk.createKey({
		metadata: { plan: "pro" }, // Adds metadata to the key that is created
	});

	if (res.error || !res.result) {
		return new Response(JSON.stringify({ error: res.error?.code ?? "error" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		});
	}

	return new Response(
		JSON.stringify({
			key: res.result.key,
			metadata: res.result.metadata,
			id: res.result.id,
		}),
		{
			headers: { "content-type": "application/json" },
		},
	);
}
