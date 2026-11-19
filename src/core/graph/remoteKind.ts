// Which forge each remote is on, for the icon on its branch labels. A guess from
// the host is enough for a picture; `gitdeck.forge` names origin's own host.

import { parseRemote } from "../forge/remote.ts";

export type RemoteKind = "github" | "gitlab" | "git";

/** Each remote's URL, plus gitdeck's own settings that change what the graph draws. */
export const REMOTES_ARGS: readonly string[] = ["config", "--get-regexp", "^(remote\\..*\\.url|gitdeck\\.(forge|avatars))$"];

function kindOfUrl(url: string): RemoteKind {
  const host = parseRemote(url)?.host.toLowerCase() ?? "";
  return host.includes("github") ? "github" : host.includes("gitlab") ? "gitlab" : "git";
}

/** `git config --get-regexp` output as each remote's forge. */
export function parseRemoteKinds(output: string): Readonly<Record<string, RemoteKind>> {
  const lines = output.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const override = lines.find((l) => l.startsWith("gitdeck.forge "))?.slice("gitdeck.forge ".length).trim() ?? null;
  const entries = lines.flatMap((line): Array<[string, RemoteKind]> => {
    const m = /^remote\.(.+)\.url\s+(.+)$/.exec(line);
    if (!m?.[1] || !m[2]) return [];
    const named = m[1] === "origin" && override !== null;
    const kind: RemoteKind = named ? (override === "github" || override === "gitlab" ? override : "git") : kindOfUrl(m[2]);
    return [[m[1], kind]];
  });
  return Object.fromEntries(entries);
}

/** origin's host (where its authors' pictures come from); null without an origin. */
export function originHost(output: string): string | null {
  const url = /^remote\.origin\.url\s+(.+)$/m.exec(output)?.[1];
  return url ? (parseRemote(url)?.host.toLowerCase() ?? null) : null;
}

/** origin was drawn as plain git, and its forge has since been named (by the signed-in CLIs): the graph is drawn again. */
export function forgeNamedLate(kinds: Readonly<Record<string, RemoteKind>>, forge: "github" | "gitlab" | null): boolean {
  return kinds.origin === "git" && forge !== null;
}

/** The forge of a remote branch ("origin/feat/x"): its remote is the name before the first slash. */
export function remoteKindOf(branch: string, kinds: Readonly<Record<string, RemoteKind>>): RemoteKind {
  return kinds[branch.slice(0, branch.indexOf("/"))] ?? "git";
}
