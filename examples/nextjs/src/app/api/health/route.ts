import { NextResponse } from "next/server";

// Health check endpoint - this is not protected by UsefulKey and is used for integration tests
export async function GET() {
	return NextResponse.json({ ok: true, service: "dog-api" });
}
