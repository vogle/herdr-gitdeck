// Opening a link in the person's default browser. Herdr has no call for it, so
// each platform's own opener runs directly (never a shell: on Windows `cmd`
// would read an `&` in the link as a second command).

import type { Exec } from "./git/runner.ts";

export type Platform = "linux" | "macos" | "windows";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A host (and port), then an optional path of printable characters with no spaces or quotes. */
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[!#-~]*)?$/;

/** A plain https link: nothing an opener could read as anything else. */
export function safeUrl(url: string): boolean {
  return HTTPS.test(url);
}

export function openCommand(platform: Platform, url: string): { command: string; args: string[] } | null {
  if (!safeUrl(url)) return null;
  if (platform === "macos") return { command: "open", args: [url] };
  if (platform === "windows") return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

/**
 * Opens the link on this machine (even for a repo on another one). The openers'
 * exit codes aren't reliable (some answer 1 after opening it), so only a command
 * that can't start counts as a failure. Answers an error text, or null.
 */
export async function openInBrowser(exec: Exec, platform: Platform, url: string): Promise<string | null> {
  const open = openCommand(platform, url);
  if (open === null) return `Won't open ${url}: not an https link`;
  try {
    await exec(open.command, open.args, { on: null });
    return null;
  } catch (error) {
    return `Couldn't open a browser (${open.command}): ${message(error)}`;
  }
}
