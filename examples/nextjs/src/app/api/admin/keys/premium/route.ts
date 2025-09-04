import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_KEY } from "@/lib/constants";
import { uk } from "@/lib/usefulkey";

// Create a key with plan "premium" requires the admin key
export async function POST() {
	const h = await headers();
	const adminKey = h.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
	}

	try {
		const res = await uk.createKey({
			metadata: { plan: "premium" },
		});

		if (res.error || !res.result) {
			return NextResponse.json(
				{ error: res.error?.code ?? "error" },
				{ status: 500 },
			);
		}

		// Grant premium scope to the key
		await uk.grantScopes(res.result.id, ["premium"]);

		return NextResponse.json({
			key: res.result.key,
			metadata: res.result.metadata,
			id: res.result.id,
			scopes: ["premium"],
		});
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: errorMessage }, { status: 500 });
	}
}
