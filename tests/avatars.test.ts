import { test } from "node:test";
import assert from "node:assert/strict";
import type { Exec, ExecResult } from "../src/core/git/runner.ts";
import {
  avatarBase, downloadAvatar, findAvatarUrls, githubQuery, knownAvatars, memberAvatar, noreplyAvatar, parseGithubAvatars, parseGitlabAvatar,
  type AvatarSource,
} from "../src/core/avatars.ts";

const T = { cwd: "/r", on: null };
const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });

test("an avatar's file name is a hash of the email, never the email itself", () => {
  const a = avatarBase("Ada@Example.com");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, avatarBase(" ada@example.com "), "case and spaces don't matter");
  assert.notEqual(a, avatarBase("bob@example.com"));
  assert.ok(!a.includes("example"));
  assert.notEqual(avatarBase("ada@example.com", "github.com"), avatarBase("ada@example.com", "git.acme.dev"), "each server's picture is kept apart");
  assert.equal(avatarBase("ada@example.com", "GitHub.com"), avatarBase("ada@example.com", "github.com"));
});

test("a GitHub noreply email names its account, so its picture needs no lookup", () => {
  assert.equal(noreplyAvatar("123+ada@users.noreply.github.com"), "https://avatars.githubusercontent.com/u/123?s=64");
  assert.equal(noreplyAvatar("ada@users.noreply.github.com"), null, "the old form has no id");
  assert.equal(noreplyAvatar("ada@example.com"), null);
  assert.equal(noreplyAvatar("noreply@GitHub.com"), "https://avatars.githubusercontent.com/u/19864447?s=64", "GitHub's own committer (web-flow)");
});

test("knownAvatars reads the saved files back as base name to file", () => {
  assert.deepEqual(knownAvatars(["0123456789abcdef.png", "fedcba9876543210.jpg", "x.tmp", "notes.txt", "0123456789abcdef.tmp"]), {
    "0123456789abcdef": "0123456789abcdef.png",
    fedcba9876543210: "fedcba9876543210.jpg",
  });
});

test("one GitHub query asks for many commits' authors by alias", () => {
  const q = githubQuery("vogle", "gitdeck", ["aaa111", "bbb222"]);
  assert.match(q, /repository\(owner: "vogle", name: "gitdeck"\)/);
  assert.match(q, /c0: object\(oid: "aaa111"\)/);
  assert.match(q, /c1: object\(oid: "bbb222"\)/);
  assert.match(q, /avatarUrl\(size: 64\)/);
  assert.throws(() => githubQuery("a\"b", "c", ["aaa"]), "a name that could break the query is refused");
  assert.throws(() => githubQuery("a", "c", ["not-a-hash"]));
});

test("parseGithubAvatars maps each commit's email to its user's picture; unpushed or unknown ones are left out", () => {
  const out = JSON.stringify({
    data: {
      repository: {
        c0: { author: { email: "ada@x.io", user: { avatarUrl: "https://avatars.githubusercontent.com/u/1?s=64" } } },
        c1: { author: { email: "bob@x.io", user: null } },
        c2: null,
      },
    },
  });
  assert.deepEqual(parseGithubAvatars(out), { "ada@x.io": "https://avatars.githubusercontent.com/u/1?s=64" });
  assert.deepEqual(parseGithubAvatars("not json"), {});
});

test("parseGitlabAvatar keeps the server's own picture and refuses Gravatar", () => {
  assert.equal(parseGitlabAvatar('{"avatar_url":"https://git.acme.dev/uploads/-/system/user/avatar/4/a.png"}'), "https://git.acme.dev/uploads/-/system/user/avatar/4/a.png");
  assert.equal(parseGitlabAvatar('{"avatar_url":"https://secure.gravatar.com/avatar/abc?s=64"}'), null);
  assert.equal(parseGitlabAvatar('{"avatar_url":"https://www.gravatar.com/avatar/abc"}'), null);
  assert.equal(parseGitlabAvatar('{"avatar_url":null}'), null);
  assert.equal(parseGitlabAvatar("<html>"), null);
});

test("findAvatarUrls asks GitHub once per batch of commits, outside the repo, and skips noreply emails", async () => {
  const calls: [string, string[], unknown][] = [];
  const exec: Exec = async (c, a, o) => {
    calls.push([c, a, o]);
    return ok(JSON.stringify({ data: { repository: { c0: { author: { email: "ada@x.io", user: { avatarUrl: "https://a/1" } } } } } }));
  };
  const source: AvatarSource = { kind: "github", host: "github.com", path: "vogle/gitdeck" };
  const urls = await findAvatarUrls(exec, T, "/home", source, [
    { email: "ada@x.io", hash: "aaa111" },
    { email: "9+bob@users.noreply.github.com", hash: "bbb222" },
  ]);
  assert.deepEqual(urls, { "ada@x.io": "https://a/1", "9+bob@users.noreply.github.com": "https://avatars.githubusercontent.com/u/9?s=64" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], "gh");
  assert.deepEqual(calls[0]?.[1].slice(0, 4), ["api", "graphql", "--hostname", "github.com"]);
  assert.deepEqual(calls[0]?.[2], { cwd: "/home", on: null });
});

test("findAvatarUrls asks a GitLab server once per email; a failure leaves that email out", async () => {
  const calls: string[][] = [];
  const exec: Exec = async (c, a) => {
    calls.push([c, ...a]);
    if (a[1]?.includes("ada")) return ok('{"avatar_url":"https://git.acme.dev/uploads/a.png"}');
    return { code: 1, stdout: "", stderr: "404" };
  };
  const source: AvatarSource = { kind: "gitlab", host: "git.acme.dev", path: "g/app" };
  const urls = await findAvatarUrls(exec, T, "/home", source, [
    { email: "ada@x.io", hash: "aaa111" },
    { email: "bob@x.io", hash: "bbb222" },
  ]);
  assert.deepEqual(urls, { "ada@x.io": "https://git.acme.dev/uploads/a.png" });
  assert.deepEqual(calls[0], ["glab", "api", "avatar?email=ada%40x.io&size=64", "--hostname", "git.acme.dev"]);
  assert.equal(calls.filter((c) => c[2]?.startsWith("avatar?")).length, 2);
});

test("downloadAvatar keeps only an image, under its final name once it is whole", async () => {
  const calls: string[][] = [];
  const run = (contentType: string, code = 0): Exec => async (c, a) => {
    calls.push([c, ...a]);
    return c === "curl" ? { code, stdout: contentType, stderr: "" } : ok("");
  };
  assert.equal(await downloadAvatar(run("image/png"), "/d", "https://a/1", "abc"), "abc.png");
  assert.deepEqual(calls[0]?.slice(0, 2), ["curl", "-fsSL"]);
  assert.ok(calls[0]?.includes("/d/abc.tmp"));
  assert.deepEqual(calls[1], ["mv", "-f", "/d/abc.tmp", "/d/abc.png"]);
  calls.length = 0;
  assert.equal(await downloadAvatar(run("image/jpeg; charset=binary"), "/d", "https://a/1", "abc"), "abc.jpg");
  calls.length = 0;
  assert.equal(await downloadAvatar(run("text/html"), "/d", "https://a/1", "abc"), null, "a sign-in page is not a picture");
  assert.deepEqual(calls[1], ["rm", "-f", "/d/abc.tmp"]);
  calls.length = 0;
  assert.equal(await downloadAvatar(run("", 22), "/d", "https://a/1", "abc"), null);
  assert.equal(await downloadAvatar(async () => { throw new Error("no curl"); }, "/d", "https://a/1", "abc"), null);
  assert.equal(await downloadAvatar(run("image/png"), "/d", "file:///etc/passwd", "abc"), null, "only https");
});

const MEMBERS = [
  { username: "kenny", name: "Kenny Jeong", avatar_url: "https://git.acme.dev/uploads/k.png" },
  { username: "lee", name: "Lee", avatar_url: "https://git.acme.dev/uploads/l1.png" },
  { username: "lee2", name: "Lee", avatar_url: "https://git.acme.dev/uploads/l2.png" },
  { username: "fuji", name: "Fujioka", avatar_url: "https://secure.gravatar.com/avatar/x" },
];

test("memberAvatar matches an author to exactly one project member, by name or by username", () => {
  assert.equal(memberAvatar(MEMBERS, "kenny jeong", "k.j@corp.io"), "https://git.acme.dev/uploads/k.png", "name, any case");
  assert.equal(memberAvatar(MEMBERS, "K. Jeong", "Kenny@corp.io"), "https://git.acme.dev/uploads/k.png", "the email's name part is the username");
  assert.equal(memberAvatar(MEMBERS, "Lee", "x@corp.io"), null, "two members named Lee: no guess");
  assert.equal(memberAvatar(MEMBERS, "Fujioka", "f@corp.io"), null, "a Gravatar is no picture");
  assert.equal(memberAvatar(MEMBERS, "Nobody", "n@corp.io"), null);
});

test("findAvatarUrls falls back to the project's members when GitLab's /avatar only knows Gravatar", async () => {
  const calls: string[][] = [];
  const exec: Exec = async (c, a) => {
    calls.push([c, ...a]);
    if (a[1]?.startsWith("projects/")) return ok(JSON.stringify(MEMBERS));
    return ok('{"avatar_url":"https://secure.gravatar.com/avatar/abc"}');
  };
  const source: AvatarSource = { kind: "gitlab", host: "git.acme.dev", path: "g/app" };
  const urls = await findAvatarUrls(exec, T, "/home", source, [
    { email: "kj@corp.io", hash: "aaa111", name: "Kenny Jeong" },
    { email: "zz@corp.io", hash: "bbb222", name: "Zed" },
  ]);
  assert.deepEqual(urls, { "kj@corp.io": "https://git.acme.dev/uploads/k.png" });
  const members = calls.filter((c) => c[2]?.startsWith("projects/"));
  assert.equal(members.length, 1, "the members are read once");
  assert.equal(members[0]?.[2], "projects/g%2Fapp/users?per_page=100");
});
