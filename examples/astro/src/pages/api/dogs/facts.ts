import type { APIContext } from "astro";
import { DOG_FACTS } from "../../../lib/constants";
import { uk } from "../../../lib/usefulkey";

export const prerender = false;

// Premium dog facts - requires 'premium' scope
export async function GET(ctx: APIContext) {
	const key = ctx.request.headers.get("x-api-key") || "";
	const ipHeader = ctx.request.headers.get("x-forwarded-for");
	const ip = ipHeader?.split(",")[0].trim() || "127.0.0.1";

	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs",
			scopes: ["premium"],
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

	const randomFact = DOG_FACTS[Math.floor(Math.random() * DOG_FACTS.length)];
	return new Response(
		JSON.stringify({
			fact: randomFact,
			category: "premium",
		}),
		{
			headers: { "content-type": "application/json" },
		},
	);
}
