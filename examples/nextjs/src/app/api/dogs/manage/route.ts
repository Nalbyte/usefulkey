import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { DOG_NAMES } from "@/lib/constants";
import { uk } from "@/lib/usefulkey";

export async function POST(req: Request) {
	const h = await headers();
	const key = h.get("x-api-key") || "";
	const ip = (h.get("x-forwarded-for") || "127.0.0.1").split(",")[0].trim();

	const res = await uk.verifyKey(
		{
			key,
			ip,
			namespace: "api-dogs",
			scopes: ["admin"], // Check for required scopes
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

	let body: Record<string, unknown> = {};
	try {
		body = await req.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { action, dogName } = body;

	if (!action || !dogName) {
		return NextResponse.json(
			{ error: "Missing action or dogName" },
			{ status: 400 },
		);
	}

	if (action === "add") {
		const dogNameStr = String(dogName);
		if (!DOG_NAMES.includes(dogNameStr)) {
			DOG_NAMES.push(dogNameStr);
			return NextResponse.json({
				success: true,
				message: `Added ${dogName} to the list`,
			});
		}
		return NextResponse.json(
			{ error: "Dog name already exists" },
			{ status: 400 },
		);
	}

	return NextResponse.json(
		{ error: "Unknown action. Use 'add'" },
		{ status: 400 },
	);
}
