import type { APIContext } from "astro";
import { DOG_NAMES } from "../../../lib/constants";
import { uk } from "../../../lib/usefulkey";

export const prerender = false;

export async function GET(ctx: APIContext) {
	const key = ctx.request.headers.get("x-api-key") || "";
	const ipHeader = ctx.request.headers.get("x-forwarded-for");
	const ip = ipHeader?.split(",")[0].trim() || "127.0.0.1";

	// Use the rate limit plugin with namespace, namespace is required for rate limiting plugin
	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs",
		},
		true, // true to include metadata in res
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
					: 401;
		const errorMessage =
			res.result?.reason === "usage_exceeded"
				? "Rate limit exceeded"
				: res.result?.reason === "disabled"
					? "Key is disabled"
					: res.result?.reason === "revoked"
						? "Key has been revoked"
						: "Invalid API key";

		return new Response(
			JSON.stringify({
				error: errorMessage,
				code: res.result?.reason ?? "invalid_key",
			}),
			{
				status: statusCode,
				headers: { "content-type": "application/json" },
			},
		);
	}

	// Return 10 random dog names for pro users, 5 for others
	const count = res.result?.metadata?.plan === "pro" ? 10 : 5;
	const shuffled = [...DOG_NAMES].sort(() => 0.5 - Math.random());
	const selectedNames = shuffled.slice(0, count);

	return new Response(
		JSON.stringify({
			dogs: selectedNames,
			count,
			plan: res.result?.metadata?.plan || "basic",
		}),
		{
			headers: { "content-type": "application/json" },
		},
	);
}
