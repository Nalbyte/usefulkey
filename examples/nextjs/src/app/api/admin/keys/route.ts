import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_KEY } from "@/lib/constants";
import { uk } from "@/lib/usefulkey";

// Create a key
export async function POST(req: Request) {
	const h = await headers();
	const adminKey = h.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
	}

	try {
		let body: Record<string, unknown> = {};
		try {
			body = await req.json();
		} catch {
			body = {};
		}
		const metadata = (body.metadata as Record<string, unknown>) || {};

		const res = await uk.createKey({ metadata });

		if (res.error || !res.result) {
			return NextResponse.json(
				{ error: res.error?.code ?? "error" },
				{ status: 500 },
			);
		}

		return NextResponse.json({
			key: res.result.key,
			metadata: res.result.metadata,
			id: res.result.id,
		});
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}
}
