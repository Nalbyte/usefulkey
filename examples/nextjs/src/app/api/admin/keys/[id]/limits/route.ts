import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_KEY } from "@/lib/constants";
import { uk } from "@/lib/usefulkey";

// Set remaining limits for a key requires the admin key
export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
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
		const { remaining } = body;

		if (
			remaining === undefined ||
			typeof remaining !== "number" ||
			remaining < 0
		) {
			return NextResponse.json(
				{ error: "Invalid remaining limit. Must be a non-negative number." },
				{ status: 400 },
			);
		}

		await uk.setUsesRemaining(id, remaining);

		return NextResponse.json({ success: true, id, remaining });
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: errorMessage }, { status: 500 });
	}
}
