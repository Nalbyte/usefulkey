import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_KEY } from "@/lib/constants";
import { uk } from "@/lib/usefulkey";

// Revoke scopes from a key requires the admin key
export async function POST(
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
		const { scopes } = body;

		if (!scopes || (!Array.isArray(scopes) && typeof scopes !== "string")) {
			return NextResponse.json(
				{ error: "Invalid scopes. Must be a string or array of strings." },
				{ status: 400 },
			);
		}

		await uk.revokeScopes(id, scopes);
		const updatedScopes = await uk.getScopes(id);
		return NextResponse.json({
			success: true,
			id,
			revoked: scopes,
			scopes: updatedScopes,
		});
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : "error";
		return NextResponse.json({ error: errorMessage }, { status: 500 });
	}
}
