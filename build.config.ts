import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["./src/index"],
  outDir: "dist",
  clean: true,
  failOnWarn: false,
  declaration: true,
  rollup: {
    emitCJS: true,
    cjsBridge: true,
    esbuild: {
      target: "node18"
    }
  },
  sourcemap: true,
  externals: [
    "js-sha256",
    "better-sqlite3",
    "pg",
    "redis",
    "mysql2",
    "@cloudflare/workers-types"
  ]
});

