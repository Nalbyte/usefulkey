import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [],
	test: {
		include: ["tests/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
		exclude: ["tests/integration/cloudflare-worker/**/*"],
		environment: "node",
		testTimeout: 20000,
	},
});
