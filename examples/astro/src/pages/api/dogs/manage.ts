import type { APIContext } from "astro";
import { DOG_NAMES } from "../../../lib/constants";
import { uk } from "../../../lib/usefulkey";

export const prerender = false;

// Admin dog management - requires 'admin' scope
export async function POST(ctx: APIContext) {
	const key = ctx.request.headers.get("x-api-key") || "";
	const ipHeader = ctx.request.headers.get("x-forwarded-for");
	const ip = ipHeader?.split(",")[0].trim() || "127.0.0.1";

	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs",
			scopes: ["admin"],
		},
		true,
	);

	if (res.error) {
		return new Response(
			JSON.stringify({
				error: "Invalid API key",
				code: res.error?.code ?? "invalid_key",
			}),
			{
				status: 401,
				headers: { "content-type": "application/json" },
			},
		);
	}

	if (!res.result?.valid) {
		const statusCode =
			res.result?.reason === "usage_exceeded"
				? 429
				: res.result?.reason === "disabled"
					? 403
					: res.result?.reason === "revoked"
						? 401
						: 403;
		const errorMessage =
			res.result?.reason === "usage_exceeded"
				? "Rate limit exceeded"
				: res.result?.reason === "disabled"
					? "Key is disabled"
					: res.result?.reason === "revoked"
						? "Key has been revoked"
						: "Insufficient permissions";

		return new Response(
			JSON.stringify({
				error: errorMessage,
				code: res.result?.reason ?? "insufficient_scope",
			}),
			{
				status: statusCode,
				headers: { "content-type": "application/json" },
			},
		);
	}

	let body: any = {};
	try {
		body = await ctx.request.json();
	} catch {
		return new Response(JSON.stringify({ error: "Invalid request body" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}

	const { action, dogName } = body;

	if (!action || !dogName) {
		return new Response(
			JSON.stringify({ error: "Missing action or dogName" }),
			{
				status: 400,
				headers: { "content-type": "application/json" },
			},
		);
	}

	if (action === "add") {
		if (!DOG_NAMES.includes(dogName)) {
			DOG_NAMES.push(dogName);
			return new Response(
				JSON.stringify({
					success: true,
					message: `Added ${dogName} to the list`,
				}),
				{
					headers: { "content-type": "application/json" },
				},
			);
		}
		return new Response(JSON.stringify({ error: "Dog name already exists" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}

	return new Response(JSON.stringify({ error: "Unknown action. Use 'add'" }), {
		status: 400,
		headers: { "content-type": "application/json" },
	});
}
