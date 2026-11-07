// Bundles and runs the habit engine/sync tests with Node (no extra test
// framework). Usage: npm run test:habits [-- --write-vectors]
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "habit-tests-"));
const outfile = join(dir, "habits.test.mjs");
try {
  await build({
    entryPoints: [join(root, "src/lib/habits/habits.test.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "warning",
  });
  const { run } = await import(pathToFileURL(outfile).href);
  const failures = await run({
    writeVectors: process.argv.includes("--write-vectors"),
    vectorsPath: join(root, "src/lib/habits/habit-sync-vectors.json"),
  });
  process.exitCode = failures > 0 ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
