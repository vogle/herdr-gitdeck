// Review comments still open on the branch's PR or MR, as feedback for the agent:
// GitHub's unresolved review threads (and reviews asking for changes), GitLab's
// unresolved discussions. Read only when the person asks, never on a timer.

import type { FeedbackNote } from "../feedback.ts";
import type { NoteState } from "../feedbackBatch.ts";
import { notWaiting } from "./failedChecks.ts";
import { hostAndPath } from "./gitlab.ts";
import { record, str } from "./types.ts";

export interface ReviewThread {
  /** The file it is on; null for a comment on the PR/MR as a whole. */
  path: string | null;
  line: number | null;
  url: string;
  comments: readonly { author: string; body: string }[];
}

const QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
reviewThreads(first:100){nodes{isResolved path line originalLine comments(first:20){nodes{author{login} body url}}}}
reviews(last:50){nodes{state body url author{login}}}}}}`;

/** `gh api graphql` for the PR's review threads; a GitHub Enterprise repo is "host/owner/name". */
export function threadsArgs(repo: string, number: number): string[] {
  const parts = repo.split("/");
  const [owner = "", name = ""] = parts.slice(-2);
  const host = parts.length > 2 ? ["--hostname", parts[0] ?? ""] : [];
  return ["api", "graphql", ...host, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `n=${number}`, "-f", `query=${QUERY}`];
}

const nodes = (v: unknown): unknown[] => {
  const list = record(v)?.nodes;
  return Array.isArray(list) ? list : [];
};
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
/** HTML comments are bots' markers, not words for the agent. */
const clean = (body: unknown): string => str(body).replace(/<!--[\s\S]*?-->/g, "").trim();

function comment(author: unknown, body: unknown): { author: string; body: string } {
  return { author: str(author) || "ghost", body: clean(body) };
}

export function parseThreads(json: string): ReviewThread[] {
  const pr = record(record(record(JSON.parse(json))?.data)?.repository)?.pullRequest;
  const threads = nodes(record(pr)?.reviewThreads).flatMap((t): ReviewThread[] => {
    const o = record(t);
    if (o === null || o.isResolved !== false) return [];
    const said = nodes(o.comments).map((c) => comment(record(record(c)?.author)?.login, record(c)?.body));
    const url = str(record(nodes(o.comments)[0])?.url);
    return said.length === 0 ? [] : [{ path: str(o.path) || null, line: num(o.line) ?? num(o.originalLine), url, comments: said }];
  });
  const asked = nodes(record(pr)?.reviews).flatMap((r): ReviewThread[] => {
    const o = record(r);
    if (o === null || o.state !== "CHANGES_REQUESTED" || clean(o.body) === "") return [];
    return [{ path: null, line: null, url: str(o.url), comments: [comment(record(o.author)?.login, o.body)] }];
  });
  return [...threads, ...asked];
}

/** `glab api` for the MR's discussions (glab has no command that lists them as JSON). */
export function discussionsArgs(repo: string, iid: number): string[] {
  const { host, path } = hostAndPath(repo);
  return ["api", "--hostname", host, `projects/${encodeURIComponent(path)}/merge_requests/${iid}/discussions?per_page=100`];
}

export function parseDiscussions(json: string): ReviewThread[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) return [];
  return data.flatMap((d): ReviewThread[] => {
    const notes = record(d)?.notes;
    if (!Array.isArray(notes)) return [];
    const first = record(notes[0]);
    if (first === null || first.system === true || first.resolvable !== true || first.resolved === true) return [];
    const at = record(first.position);
    const said = notes.map((n) => comment(record(record(n)?.author)?.username, record(n)?.body));
    return [{ path: str(at?.new_path) || str(at?.old_path) || null, line: num(at?.new_line) ?? num(at?.old_line), url: "", comments: said }];
  });
}

const QUOTE_LINES = 8;

function quote(t: ReviewThread): string[] {
  const lines = t.comments.flatMap((c) => {
    const [head = "", ...rest] = c.body.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    return [`@${c.author}: ${head}`, ...rest];
  });
  return lines.length > QUOTE_LINES + 1 ? [...lines.slice(0, QUOTE_LINES), `… ${lines.length - QUOTE_LINES} more lines`] : lines;
}

function threadNote(t: ReviewThread, label: "PR" | "MR"): FeedbackNote {
  const where = t.path ? `Review comment on ${t.path}${t.line !== null ? `:${t.line}` : ""}` : `Review comment on the ${label}`;
  return { where, quote: quote(t), text: `Do what it asks, or reply why not.${t.url ? ` Thread: ${t.url}` : ""}` };
}

/** Notes for the open review threads not already waiting in the batch. */
export function threadNotes(threads: readonly ReviewThread[], label: "PR" | "MR", batch: readonly (FeedbackNote & { state: NoteState })[]): FeedbackNote[] {
  return notWaiting(threads.map((t) => threadNote(t, label)), batch);
}
