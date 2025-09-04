import type { APIContext } from "astro";

// Health check endpoint for integration tests
export async function GET(_ctx: APIContext) {
	return new Response(JSON.stringify({ ok: true, service: "dog-api" }), {
		headers: { "content-type": "application/json" },
	});
}
