import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [],
	test: {
		include: ["tests/unit/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
		environment: "node",
		testTimeout: 20000,
	},
});
