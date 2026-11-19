// How a graph row writes a commit: the conventional-commit type in bold, and the
// author as initials on a color of their own (no picture is fetched).

/** "feat(ui)!:" and the rest; no prefix when the subject isn't a conventional commit. */
export function splitSubject(subject: string): { prefix: string; rest: string } {
  const m = /^([A-Za-z]+(?:\([^)]*\))?!?:)(\s+\S.*)$/.exec(subject);
  return m?.[1] && m[2] ? { prefix: m[1], rest: m[2] } : { prefix: "", rest: subject };
}

/** Up to two initials ("[bot]" dropped) and a color index the same name always gets. */
export function authorBadge(name: string, colors: number): { initials: string; color: number } {
  const words = name.replace(/\[bot\]/gi, "").split(/[\s._-]+/).filter((w) => w !== "");
  const bot = /\[bot\]/i.test(name);
  const initials = (bot ? words.slice(0, 1) : words.slice(0, 2)).map((w) => (w[0] ?? "").toUpperCase()).join("");
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return { initials: initials || "?", color: colors > 0 ? hash % colors : 0 };
}
