// Authors' pictures for the history graph (on unless `git config gitdeck.avatars false`).
// The pictures live in a hidden folder of the mod, where Herdr can draw them and
// saving one reloads nothing. A path is handed to the graph only once its file
// is whole: Herdr remembers a path it once found missing.

import type { AsyncContext } from "gpui-kit";
import { readdir } from "fs/promises";
import { exec, home } from "herdr";
import { avatarBase, downloadAvatar, findAvatarUrls, knownAvatars, type AvatarWanted } from "./core/avatars.ts";
import { readAvatarSource } from "./core/forge/index.ts";
import type { Commit } from "./core/git/log.ts";
import type { Git, Target } from "./core/git/runner.ts";

/** Where the pictures are, as `image()` takes it (from Herdr's own folder). */
const SHOWN_DIR = "mods/gitdeck/.avatars";
/** At most this many new authors are looked up per history read. */
const MAX_NEW = 60;

export class Avatars {
  /** base name (a hash of the server and the email) → saved file. */
  private files: Readonly<Record<string, string>> = {};
  /** Authors already looked up this session, found or not: not asked again. */
  private asked: ReadonlySet<string> = new Set();
  private listed = false;
  private busy = false;

  /** The picture to draw for an email, once it is saved; null keeps the initials. */
  path(email: string, host: string): string | null {
    const file = this.files[avatarBase(email, host)];
    return file ? `${SHOWN_DIR}/${file}` : null;
  }

  private dir(): string {
    return `${home()}/.config/herdr-app/${SHOWN_DIR}`;
  }

  /** The pictures saved by earlier sessions. */
  private async list(): Promise<void> {
    if (this.listed) return;
    this.listed = true;
    await exec("mkdir", ["-p", this.dir()]).catch(() => null);
    const names = await readdir(this.dir()).catch(() => [] as string[]);
    this.files = knownAvatars(names);
  }

  /** One commit per author not yet saved or asked about. */
  private wanted(commits: readonly Commit[], host: string): AvatarWanted[] {
    const seen = new Set<string>();
    const out: AvatarWanted[] = [];
    for (const c of commits) {
      const base = avatarBase(c.email, host);
      if (c.email === "" || seen.has(base) || this.files[base] || this.asked.has(base)) continue;
      seen.add(base);
      out.push({ email: c.email, hash: c.hash, name: c.author });
      if (out.length >= MAX_NEW) break;
    }
    return out;
  }

  /**
   * Looks up and saves the pictures of the authors in `commits`, redrawing as
   * each one lands. One run at a time; `away` is where the forge CLI runs.
   */
  async load(git: Git, target: Target, away: string, commits: readonly Commit[], cx: AsyncContext): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.list();
      const source = await readAvatarSource(git, target);
      const before = Object.keys(this.files).length;
      const wanted = source === null ? [] : this.wanted(commits, source.host);
      if (Object.keys(this.files).length !== before || wanted.length === 0) cx.notify();
      if (source === null || wanted.length === 0) return;
      this.asked = new Set([...this.asked, ...wanted.map((w) => avatarBase(w.email, source.host))]);
      const urls = await findAvatarUrls(exec, target, away, source, wanted);
      for (const [email, url] of Object.entries(urls)) {
        const base = avatarBase(email, source.host);
        const file = await downloadAvatar(exec, this.dir(), url, base);
        if (file === null) continue;
        this.files = { ...this.files, [base]: file };
        cx.notify();
      }
    } finally {
      this.busy = false;
    }
  }
}
