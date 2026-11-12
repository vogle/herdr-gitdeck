// Which forge a remote URL points at, and the project name its CLI takes.

import type { Forge, ForgeKind } from "./types.ts";

/** A host or path part: never starts with "-", so it can't read as a flag. */
const PART = "[A-Za-z0-9_.][A-Za-z0-9_.-]*";
const PATH = `${PART}(?:/${PART})+`;
const URLS = [
  new RegExp(`^(?:https?|ssh)://(?:[^@/]+@)?(${PART})(?::\\d+)?/(${PATH})$`),
  new RegExp(`^[^@/]+@(${PART}):(${PATH})$`),
];

export function parseRemote(url: string): { host: string; path: string } | null {
  const bare = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  for (const re of URLS) {
    const m = re.exec(bare);
    if (m?.[1] && m[2]) return { host: m[1], path: m[2] };
  }
  return null;
}

function kindOf(host: string, override: string | null): ForgeKind | null {
  if (override !== null) return override === "github" || override === "gitlab" ? override : null;
  // Only the public hosts are guessed: a look-alike name must not get the CLI pointed at it.
  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  return null;
}

/** The forge behind a remote; `override` (`git config gitdeck.forge`) names it for your own host. */
export function forgeOf(remote: { host: string; path: string } | null, override: string | null): Forge | null {
  if (remote === null) return null;
  const kind = kindOf(remote.host, override);
  if (kind === "github") {
    if (remote.path.split("/").length !== 2) return null;
    const repo = remote.host === "github.com" ? remote.path : `${remote.host}/${remote.path}`;
    return { kind, label: "PR", cli: "gh", repo };
  }
  if (kind === "gitlab") {
    const repo = remote.host === "gitlab.com" ? remote.path : `https://${remote.host}/${remote.path}`;
    return { kind, label: "MR", cli: "glab", repo };
  }
  return null;
}
