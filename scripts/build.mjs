// Builds the mod folder dist/githerd/: one bundled main.js plus mod.json and assets.
// One file means one reload when installed (each reload keeps old code alive in herdr-app 0.1.x).
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const out = "dist/githerd";

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: ["src/main.ts"],
  outfile: `${out}/main.js`,
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  // Provided by the Herdr runtime.
  external: ["herdr", "gpui-kit", "gpui-base", "gpui", "gpui-shell"],
  legalComments: "none",
  logLevel: "warning",
});

await cp("mod/mod.json", `${out}/mod.json`);
await cp("mod/icons", `${out}/icons`, { recursive: true });
process.stdout.write(`build: ${out}\n`);
