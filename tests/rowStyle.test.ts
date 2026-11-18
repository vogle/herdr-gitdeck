import { test } from "node:test";
import assert from "node:assert/strict";
import { REMOTES_ARGS, parseRemoteKinds, remoteKindOf } from "../src/core/graph/remoteKind.ts";
import { authorBadge, splitSubject } from "../src/core/graph/rowText.ts";

test("remotes are read with the forge override in one call", () => {
  assert.deepEqual(REMOTES_ARGS, ["config", "--get-regexp", "^(remote\\..*\\.url|gitdeck\\.forge)$"]);
});

test("each remote's forge is guessed from its host", () => {
  const kinds = parseRemoteKinds(
    [
      "remote.origin.url git@github.com:vogle/herdr-gitdeck.git",
      "remote.lab.url https://gitlab.example.com/g/app.git",
      "remote.home.url ssh://git@git.example.org/me/app",
      "remote.local.url /srv/repos/app.git",
    ].join("\n"),
  );
  assert.deepEqual(kinds, { origin: "github", lab: "gitlab", home: "git", local: "git" });
});

test("gitdeck.forge names origin's forge for a host that doesn't say", () => {
  const kinds = parseRemoteKinds("remote.origin.url git@bsp-git.uzen.io:bsp/app.git\ngitdeck.forge gitlab\nremote.up.url git@bsp-git.uzen.io:x/y.git");
  assert.deepEqual(kinds, { origin: "gitlab", up: "git" });
  assert.deepEqual(parseRemoteKinds("remote.origin.url git@github.com:a/b.git\ngitdeck.forge none"), { origin: "git" });
});

test("a remote branch's forge comes from the remote before its first slash", () => {
  const kinds = { origin: "github", lab: "gitlab" } as const;
  assert.equal(remoteKindOf("origin/feat/x", kinds), "github");
  assert.equal(remoteKindOf("lab/main", kinds), "gitlab");
  assert.equal(remoteKindOf("gone/main", kinds), "git");
});

test("a conventional commit's type and scope are split from the rest", () => {
  assert.deepEqual(splitSubject("feat: rework the panel"), { prefix: "feat:", rest: " rework the panel" });
  assert.deepEqual(splitSubject("chore(main): release 0.2.0"), { prefix: "chore(main):", rest: " release 0.2.0" });
  assert.deepEqual(splitSubject("fix(api)!: drop v1"), { prefix: "fix(api)!:", rest: " drop v1" });
  assert.deepEqual(splitSubject("Merge pull request #6 from vogle/x"), { prefix: "", rest: "Merge pull request #6 from vogle/x" });
  assert.deepEqual(splitSubject("note: "), { prefix: "", rest: "note: " });
});

test("an author shows as initials with a color that stays the same for the name", () => {
  assert.equal(authorBadge("Allan Im", 12).initials, "AI");
  assert.equal(authorBadge("dependabot[bot]", 12).initials, "D");
  assert.equal(authorBadge("github-actions[bot]", 12).initials, "G");
  assert.equal(authorBadge("  ", 12).initials, "?");
  assert.equal(authorBadge("이 지은", 12).initials, "이지");
  assert.equal(authorBadge("Allan Im", 12).color, authorBadge("Allan Im", 12).color);
  const c = authorBadge("Someone Else", 6).color;
  assert.ok(c >= 0 && c < 6);
});
