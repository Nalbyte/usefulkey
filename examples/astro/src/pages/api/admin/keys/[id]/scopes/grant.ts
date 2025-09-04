import type { APIContext } from "astro";
import { ADMIN_KEY } from "../../../../../../lib/constants";
import { uk } from "../../../../../../lib/usefulkey";

export const prerender = false;

// Grant scopes to a key
export async function POST(ctx: APIContext) {
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

		let body: any = {};
		try {
			body = await ctx.request.json();
		} catch {
			body = {};
		}
		const { scopes } = body;

		if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
			return new Response(
				JSON.stringify({
					error: "Invalid scopes. Must be a string or array of strings.",
				}),
				{
					status: 400,
					headers: { "content-type": "application/json" },
				},
			);
		}

		await uk.grantScopes(id, scopes);

		const updatedScopes = await uk.getScopes(id);

		return new Response(
			JSON.stringify({
				success: true,
				id,
				granted: scopes,
				scopes: updatedScopes,
			}),
			{
				headers: { "content-type": "application/json" },
			},
		);
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.code ?? "error" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		});
	}
}
