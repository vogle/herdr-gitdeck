// Copies the installed Herdr app's type files into types/ for `tsc`.
// They describe the exact app version on this machine, so they're not committed.
import { copyFile, mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const appHome = process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app");
const files = ["herdr.d.ts", "gpui-kit.d.ts"];

await mkdir("types", { recursive: true });
for (const file of files) {
  const from = join(appHome, file);
  try {
    await access(from);
  } catch {
    throw new Error(`${from} not found: start the Herdr app once (or set HERDR_APP_HOME)`);
  }
  await copyFile(from, join("types", file));
}
process.stdout.write(`types: copied ${files.join(", ")} from ${appHome}\n`);
