import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_KEY } from "@/lib/constants";
import { uk } from "@/lib/usefulkey";

// Get key info by ID
export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const h = await headers();
	const adminKey = h.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
	}

	const res = await uk.getKeyById(id);

	if (res.error || !res.result) {
		return NextResponse.json(
			{ error: res.error?.code ?? "not_found" },
			{ status: 404 },
		);
	}

	return NextResponse.json({
		id: res.result.id,
		metadata: res.result.metadata,
		createdAt: res.result.createdAt,
		expiresAt: res.result.expiresAt,
		revokedAt: res.result.revokedAt,
	});
}

// Revoke a key
export async function DELETE(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const h = await headers();
	const adminKey = h.get("x-admin-key") || "";
	if (adminKey !== ADMIN_KEY) {
		return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
	}

	const res = await uk.revokeKey(id);

	if (res.error) {
		return NextResponse.json(
			{ error: res.error.code ?? "error" },
			{ status: 500 },
		);
	}

	return NextResponse.json({ success: true, revoked: id });
}
