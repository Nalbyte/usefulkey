import type { APIContext } from "astro";
import { ADMIN_KEY } from "../../../../lib/constants";
import { uk } from "../../../../lib/usefulkey";

export const prerender = false;

// Create a key requires the admin key
export async function POST(ctx: APIContext) {
	const adminKey = ctx.request.headers.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return new Response(JSON.stringify({ error: "Invalid admin key" }), {
			status: 401,
			headers: { "content-type": "application/json" },
		});
	}

	try {
		let body: any = {};
		try {
			body = await ctx.request.json();
		} catch {
			body = {};
		}
		const metadata = body.metadata || {};

		const res = await uk.createKey({ metadata });

		if (res.error || !res.result) {
			return new Response(
				JSON.stringify({ error: res.error?.code ?? "error" }),
				{
					status: 500,
					headers: { "content-type": "application/json" },
				},
			);
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
	} catch (_error) {
		return new Response(JSON.stringify({ error: "Invalid request body" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}
}
