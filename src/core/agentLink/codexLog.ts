// Codex's session logs (~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl). Codex
// keeps no record of the files it edits — it edits them from the shell — so a
// session counts only the paths its commands named. The first line says which
// folder the session ran in; another repo's log is not read past it.

import type { Exec, Target } from "../git/runner.ts";
import { readLogs, type Agent, type ClaudeLogCache, type SessionEdits } from "./claudeLog.ts";

export const CODEX: Agent = { source: "codex", name: "Codex" };

/** `size<TAB>mtime<TAB>path` for each log under the dated folders. */
export const LIST_CODEX = [
  "sub walk { my ($d, $n) = @_; opendir(my $h, $d) or return; for (sort grep { !/^\\./ } readdir $h) { my $p = \"$d/$_\";",
  'if ($n > 0) { walk($p, $n - 1) if -d $p } elsif (/\\.jsonl\\z/) { my @s = stat $p; print "$s[7]\\t$s[9]\\t$p\\n" } } }',
  "walk($_, 3) for @ARGV;",
].join("\n");

/**
 * `perl -e SCAN_CODEX <offset> <log> <root>…`: nothing but `O<TAB>end` for another repo's
 * session; otherwise `B<TAB>id<TAB>time<TAB>model<TAB>branch<TAB>command` per shell call.
 */
export const SCAN_CODEX = [
  "my ($off, $f, @roots) = @ARGV; open(my $h, '<', $f) or exit 2; my $meta = <$h> // '';",
  'my ($cwd) = $meta =~ /"type":"session_meta".*?"cwd":"([^"]*)"/; my ($br) = $meta =~ /"git":\\{.*?"branch":"([^"]*)"/;',
  "unless (defined $cwd && grep { $cwd eq $_ || index($cwd, \"$_/\") == 0 } @roots) { print \"O\\t\", -s $f, \"\\n\"; exit 0 }",
  "seek($h, $off, 0); my $pos = $off; my $m = '';",
  "while (my $l = <$h>) { last unless $l =~ /\\n\\z/; my $at = $pos; $pos += length($l);",
  'if ($l =~ /"type":"turn_context"/) { ($m) = $l =~ /"model":"([^"]*)"/; $m //= \'\'; next }',
  'my ($t) = $l =~ /^\\{"timestamp":"([^"]*)"/; next unless defined $t; my $c;',
  'if ($l =~ /"type":"CommandExecution"/) { ($c) = $l =~ /"command":\\[((?:"(?:[^"\\\\]|\\\\.)*",?)*)\\]/ }',
  'elsif ($l =~ /"type":"custom_tool_call"/) { ($c) = $l =~ /"input":"((?:[^"\\\\]|\\\\.)*)"/ }',
  'print "B\\t$at\\t$t\\t$m\\t", ($br // ""), "\\t$c\\n" if defined $c }',
  'print "O\\t$pos\\n";',
].join("\n");

export const codexFolder = (home: string): string => `${home}/.codex/sessions`;

/** "rollout-2026-11-21T00-20-55-<uuid>.jsonl" → "<uuid>". */
export const codexSession = (path: string): string => /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/.exec(path)?.[1] ?? path;

/** The repo's Codex sessions; other repos' logs are left after their first line. */
export const readCodexLogs = (
  exec: Exec,
  target: Target,
  home: string,
  roots: readonly string[],
  cache: ClaudeLogCache,
): Promise<{ logs: SessionEdits; cache: ClaudeLogCache }> =>
  readLogs(exec, target, { list: [codexFolder(home)], listScript: LIST_CODEX, scanScript: SCAN_CODEX, scanArgs: roots, session: codexSession }, cache);
