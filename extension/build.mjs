import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");

const opts = {
  entryPoints: ["src/content.ts", "src/background.ts"],
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome120",
  logLevel: "info",
};

if (watch) {
  const { context } = await import("esbuild");
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
