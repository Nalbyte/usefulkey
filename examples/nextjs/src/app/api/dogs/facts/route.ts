import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { uk } from "@/lib/usefulkey";

export async function GET() {
	const h = await headers();
	const key = h.get("x-api-key") || "";
	const ip = (h.get("x-forwarded-for") || "127.0.0.1").split(",")[0].trim();

	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs",
			scopes: ["premium"], // Check for required scopes
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

		return NextResponse.json(
			{
				error: errorMessage,
				code: res.result?.reason ?? "insufficient_scope",
			},
			{ status: statusCode },
		);
	}

	const facts = [
		"Dogs have about 1,700 taste buds, compared to humans who have 9,000.",
		"A dog's sense of smell is 10,000 to 100,000 times more sensitive than humans.",
		"Dogs can understand up to 250 words and gestures.",
		"The Basenji is the only dog breed that doesn't bark.",
		"Dogs sweat through their paws and can drink up to 40 gallons of water per day.",
	];

	const randomFact = facts[Math.floor(Math.random() * facts.length)];
	return NextResponse.json({
		fact: randomFact,
		category: "premium",
	});
}
