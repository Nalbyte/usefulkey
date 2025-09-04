import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { DOG_NAMES } from "@/lib/constants";
import { uk } from "@/lib/usefulkey";

export async function GET() {
	const h = await headers();
	const key = h.get("x-api-key") || "";
	const ip = (h.get("x-forwarded-for") || "127.0.0.1").split(",")[0].trim();

	// Use the rate limit plugin with namespace, namespace is required for rate limiting plugin
	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs", // Required for rate limiting plugin
		},
		true, // true to include metadata in res
	);

	if (res.error) {
		return NextResponse.json(
			{ error: "Invalid API key", code: res.error?.code ?? "invalid_key" },
			{ status: 401 },
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

		return NextResponse.json(
			{
				error: errorMessage,
				code: res.result?.reason ?? "invalid_key",
			},
			{ status: statusCode },
		);
	}

	// Return 10 random dog names for pro users, 5 for others
	const count = res.result?.metadata?.plan === "pro" ? 10 : 5;
	const shuffled = [...DOG_NAMES].sort(() => 0.5 - Math.random());
	const selectedNames = shuffled.slice(0, count);

	return NextResponse.json({
		dogs: selectedNames,
		count,
		plan: res.result?.metadata?.plan || "basic",
	});
}
