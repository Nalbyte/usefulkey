import type { APIContext } from "astro";
import { ADMIN_KEY } from "../../../../../lib/constants";
import { uk } from "../../../../../lib/usefulkey";

export const prerender = false;

// Disable a key
export async function PUT(ctx: APIContext) {
	const adminKey = ctx.request.headers.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return new Response(JSON.stringify({ error: "Invalid admin key" }), {
			status: 401,
			headers: { "content-type": "application/json" },
		});
	}

	try {
		const id = ctx.params?.id;
		if (!id) {
			return new Response(JSON.stringify({ error: "Missing key ID" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}

		await uk.disableKey(id);

		return new Response(JSON.stringify({ success: true, disabled: id }), {
			headers: { "content-type": "application/json" },
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.code ?? "error" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		});
	}
}
