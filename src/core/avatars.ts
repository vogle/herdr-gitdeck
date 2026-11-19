// Authors' pictures for the history graph, from the repo's own forge only (no
// Gravatar). GitHub is asked through `gh` which commit authors are which users,
// a GitLab server through `glab` for each email's avatar; both already hold the
// pushed commits. Each picture is saved once, under a hash of the email, in a
// hidden folder Herdr doesn't watch; the graph draws a file only once it is
// whole, since Herdr remembers a path it found missing.

import type { Exec, Target } from "./git/runner.ts";

export interface AvatarSource {
  kind: "github" | "gitlab";
  host: string;
  /** owner/name (GitHub), group/project (GitLab). */
  path: string;
}

/** A commit by the author, to ask GitHub about. */
export interface AvatarWanted {
  email: string;
  hash: string;
  /** The author's name, matched against a GitLab project's members. */
  name?: string;
}

/** Whether pictures are on, from the graph's config read: on unless `git config gitdeck.avatars false` (repo or global) turns them off. */
export function avatarsOn(configOut: string): boolean {
  const line = configOut.split("\n").find((l) => l.startsWith("gitdeck.avatars "));
  return !/^(false|no|off|0)$/i.test(line?.slice("gitdeck.avatars ".length).trim() ?? "");
}

const SIZE = 64;
const BATCH = 50;
const IMAGE_TYPES: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

const normal = (email: string): string => email.trim().toLowerCase();

function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The file name (without extension) an email's picture is saved under: a hash, so no email is on disk. */
export function avatarBase(email: string, host = ""): string {
  // The same person can have one picture on GitHub and another on a GitLab server.
  const e = host === "" ? normal(email) : `${host.toLowerCase()}\n${normal(email)}`;
  return fnv1a(e, 0x811c9dc5) + fnv1a(e, 0x050c5d1f);
}

/** GitHub's account for commits made on its website (merges, edits, squashes): `web-flow`. */
const WEB_FLOW = 19864447;

/** `123+name@users.noreply.github.com` names account 123, and `noreply@github.com` is GitHub's own: their pictures are known without asking. */
export function noreplyAvatar(email: string): string | null {
  if (normal(email) === "noreply@github.com") return `https://avatars.githubusercontent.com/u/${WEB_FLOW}?s=${SIZE}`;
  const m = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/.exec(normal(email));
  return m ? `https://avatars.githubusercontent.com/u/${m[1]}?s=${SIZE}` : null;
}

/** The saved pictures (a folder listing) as base name → file; half-written `.tmp` files are not pictures. */
export function knownAvatars(names: readonly string[]): Readonly<Record<string, string>> {
  const exts = new Set(Object.values(IMAGE_TYPES));
  const entries = names.flatMap((n): Array<[string, string]> => {
    const m = /^([0-9a-f]{16})\.([a-z]+)$/.exec(n);
    return m?.[1] && m[2] && exts.has(m[2]) ? [[m[1], n]] : [];
  });
  return Object.fromEntries(entries);
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const OID = /^[0-9a-f]{4,64}$/;

/** One GraphQL query asking for several commits' authors, each under an alias. */
export function githubQuery(owner: string, name: string, hashes: readonly string[]): string {
  if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(name)) throw new Error(`not a GitHub repo name: ${owner}/${name}`);
  const parts = hashes.map((h, i) => {
    if (!OID.test(h)) throw new Error(`not a commit hash: ${h}`);
    return `c${i}: object(oid: "${h}") { ... on Commit { author { email user { avatarUrl(size: ${SIZE}) } } } }`;
  });
  return `query { repository(owner: "${owner}", name: "${name}") { ${parts.join(" ")} } }`;
}

interface GithubAnswer {
  data?: { repository?: Record<string, { author?: { email?: string; user?: { avatarUrl?: string } | null } } | null> };
}

/** email → picture for the commits GitHub knows a user for; unpushed commits come back null. */
export function parseGithubAvatars(stdout: string): Readonly<Record<string, string>> {
  let answer: GithubAnswer;
  try {
    answer = JSON.parse(stdout) as GithubAnswer;
  } catch {
    return {};
  }
  const found = Object.values(answer.data?.repository ?? {}).flatMap((c): Array<[string, string]> => {
    const email = c?.author?.email;
    const url = c?.author?.user?.avatarUrl;
    return email && url ? [[normal(email), url]] : [];
  });
  return Object.fromEntries(found);
}

const GRAVATAR = /(^|\.)gravatar\.com$/i;

/** GitLab's `/avatar` answer: the server's own picture; Gravatar's stands for no picture. */
export function parseGitlabAvatar(stdout: string): string | null {
  try {
    const url = (JSON.parse(stdout) as { avatar_url?: unknown }).avatar_url;
    const host = typeof url === "string" ? /^https:\/\/([^/:?#]+)/.exec(url)?.[1] : undefined;
    return host && !GRAVATAR.test(host) ? (url as string) : null;
  } catch {
    return null;
  }
}

async function githubUrls(exec: Exec, target: Target, away: string, source: AvatarSource, wanted: readonly AvatarWanted[]): Promise<Record<string, string>> {
  const [owner = "", name = ""] = source.path.split("/");
  const found: Record<string, string> = {};
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    try {
      const query = githubQuery(owner, name, batch.map((w) => w.hash));
      const r = await exec("gh", ["api", "graphql", "--hostname", source.host, "-f", `query=${query}`], { cwd: away, on: target.on });
      // Some commits not on GitHub still answer the rest.
      Object.assign(found, parseGithubAvatars(r.stdout));
    } catch {
      return found;
    }
  }
  return found;
}

/** A GitLab project member, as `projects/:id/users` lists them. */
export interface GitlabMember {
  username: string;
  name: string;
  avatar_url: string | null;
}

const MEMBER_PAGES = 5;
const PER_PAGE = 100;

const plainName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The picture of the one project member the author is: same name, or a
 * username that is the email's name part. Two matches is a guess, and a
 * Gravatar is no picture, so both give null.
 */
export function memberAvatar(members: readonly GitlabMember[], name: string, email: string): string | null {
  const wantName = plainName(name);
  const wantUser = normal(email).split("@")[0] ?? "";
  const hits = members.filter((m) => (wantName !== "" && plainName(m.name) === wantName) || (wantUser !== "" && m.username.toLowerCase() === wantUser));
  if (hits.length !== 1 || !hits[0]?.avatar_url) return null;
  return parseGitlabAvatar(JSON.stringify({ avatar_url: hits[0].avatar_url }));
}

function parseMembers(stdout: string): GitlabMember[] {
  try {
    const list = JSON.parse(stdout) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((m): GitlabMember[] => {
      const x = m as Partial<GitlabMember>;
      return typeof x.username === "string" && typeof x.name === "string" ? [{ username: x.username, name: x.name, avatar_url: typeof x.avatar_url === "string" ? x.avatar_url : null }] : [];
    });
  } catch {
    return [];
  }
}

/** The project's members, a page of 100 at a time; none when glab can't read them. */
async function gitlabMembers(exec: Exec, target: Target, away: string, source: AvatarSource): Promise<GitlabMember[]> {
  const out: GitlabMember[] = [];
  for (let page = 1; page <= MEMBER_PAGES; page += 1) {
    const path = `projects/${encodeURIComponent(source.path)}/users?per_page=${PER_PAGE}${page > 1 ? `&page=${page}` : ""}`;
    const r = await exec("glab", ["api", path, "--hostname", source.host], { cwd: away, on: target.on }).catch(() => null);
    const list = r && r.code === 0 ? parseMembers(r.stdout) : [];
    out.push(...list);
    if (list.length < PER_PAGE) break;
  }
  return out;
}

async function gitlabUrls(exec: Exec, target: Target, away: string, source: AvatarSource, wanted: readonly AvatarWanted[]): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const w of wanted) {
    const args = ["api", `avatar?email=${encodeURIComponent(normal(w.email))}&size=${SIZE}`, "--hostname", source.host];
    const r = await exec("glab", args, { cwd: away, on: target.on }).catch(() => null);
    const url = r && r.code === 0 ? parseGitlabAvatar(r.stdout) : null;
    if (url) found[normal(w.email)] = url;
  }
  // /avatar matches only a user's public email; a commit's is often another.
  const missing = wanted.filter((w) => !found[normal(w.email)]);
  if (missing.length === 0) return found;
  const members = await gitlabMembers(exec, target, away, source);
  for (const w of missing) {
    const url = memberAvatar(members, w.name ?? "", w.email);
    if (url) found[normal(w.email)] = url;
  }
  return found;
}

/**
 * email → picture URL for the authors the forge knows; the rest are left out
 * (the graph keeps their initials). The CLIs run outside the repo, in `away`.
 */
export async function findAvatarUrls(
  exec: Exec,
  target: Target,
  away: string,
  source: AvatarSource,
  wanted: readonly AvatarWanted[],
): Promise<Readonly<Record<string, string>>> {
  const known: Record<string, string> = {};
  const ask: AvatarWanted[] = [];
  for (const w of wanted) {
    const url = source.kind === "github" ? noreplyAvatar(w.email) : null;
    if (url) known[w.email] = url;
    else ask.push(w);
  }
  if (ask.length === 0) return known;
  const asked = source.kind === "github" ? await githubUrls(exec, target, away, source, ask) : await gitlabUrls(exec, target, away, source, ask);
  for (const w of ask) {
    const url = asked[normal(w.email)];
    if (url) known[w.email] = url;
  }
  return known;
}

/**
 * Saves the picture at `url` as `<dir>/<base>.<ext>` and returns that file name;
 * null when it isn't an image (a sign-in page, an error). It is written to a
 * `.tmp` first and renamed, so the graph never finds half a file.
 */
export async function downloadAvatar(exec: Exec, dir: string, url: string, base: string): Promise<string | null> {
  if (!url.startsWith("https://")) return null;
  const tmp = `${dir}/${base}.tmp`;
  try {
    const r = await exec("curl", ["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-time", "15", "--max-filesize", "2000000", "-o", tmp, "-w", "%{content_type}", "--", url], {});
    const ext = r.code === 0 ? IMAGE_TYPES[r.stdout.split(";")[0]?.trim().toLowerCase() ?? ""] : undefined;
    if (!ext) {
      await exec("rm", ["-f", tmp], {});
      return null;
    }
    const file = `${base}.${ext}`;
    const moved = await exec("mv", ["-f", tmp, `${dir}/${file}`], {});
    return moved.code === 0 ? file : null;
  } catch {
    return null;
  }
}
