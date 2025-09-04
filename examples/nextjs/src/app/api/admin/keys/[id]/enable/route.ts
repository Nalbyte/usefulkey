import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_KEY } from "@/lib/constants";
import { uk } from "@/lib/usefulkey";

// Enable a key requires the admin key
export async function PUT(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const h = await headers();
	const adminKey = h.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
	}

	try {
		await uk.enableKey(id);

		return NextResponse.json({ success: true, enabled: id });
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: errorMessage }, { status: 500 });
	}
}
