import type { APIContext } from "astro";
import { ADMIN_KEY } from "../../../../lib/constants";
import { uk } from "../../../../lib/usefulkey";

export const prerender = false;

// Get key info by ID
export async function GET(ctx: APIContext) {
	const adminKey = ctx.request.headers.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return new Response(JSON.stringify({ error: "Invalid admin key" }), {
			status: 401,
			headers: { "content-type": "application/json" },
		});
	}

	const id = ctx.params?.id;
	if (!id) {
		return new Response(JSON.stringify({ error: "Missing key ID" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}

	const res = await uk.getKeyById(id);

	if (res.error || !res.result) {
		return new Response(
			JSON.stringify({ error: res.error?.code ?? "not_found" }),
			{
				status: 404,
				headers: { "content-type": "application/json" },
			},
		);
	}

	return new Response(
		JSON.stringify({
			id: res.result.id,
			metadata: res.result.metadata,
			createdAt: res.result.createdAt,
			expiresAt: res.result.expiresAt,
			revokedAt: res.result.revokedAt,
		}),
		{
			headers: { "content-type": "application/json" },
		},
	);
}

// Revoke a key
export async function DELETE(ctx: APIContext) {
	const adminKey = ctx.request.headers.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return new Response(JSON.stringify({ error: "Invalid admin key" }), {
			status: 401,
			headers: { "content-type": "application/json" },
		});
	}

	const id = ctx.params?.id;
	if (!id) {
		return new Response(JSON.stringify({ error: "Missing key ID" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}

	const res = await uk.revokeKey(id);

	if (res.error) {
		return new Response(JSON.stringify({ error: res.error.code ?? "error" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		});
	}

	return new Response(JSON.stringify({ success: true, revoked: id }), {
		headers: { "content-type": "application/json" },
	});
}
