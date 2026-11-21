// In the commit pane: the agent sessions that wrote the commit, laid out like
// the author block: who (agent, model), when, how many tokens, and the prompt.

import { div, type Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { AgentSession } from "../core/agentLink/types.ts";
import { lineText, tokenText } from "../core/agentLink/text.ts";
import { dateTime } from "../core/time.ts";
import { label, monoFont, type Palette } from "./style.ts";

const MAX_PROMPT = 400;

function session(s: AgentSession, p: Palette): Element {
  const facts = [
    dateTime(s.time),
    ...(s.tokens === null ? [] : [tokenText(s.tokens)]),
    ...(s.lines === undefined ? [] : [lineText(s.lines)]),
  ].join(" · ");
  const prompt = s.prompt === null ? null : s.prompt.length > MAX_PROMPT ? `${s.prompt.slice(0, MAX_PROMPT)}…` : s.prompt;
  return v_flex()
    .flex_1()
    .min_w_0()
    .gap(2)
    .child(
      h_flex()
        .gap(6)
        .items_center()
        .min_w_0()
        .child(div().flex_shrink_0().font_medium().child(s.agent))
        .when(s.model !== null, (el) => el.child(div().min_w_0().truncate().text_xs().font_family(monoFont()).text_color(p.dim).child(s.model ?? ""))),
    )
    .child(div().text_xs().text_color(p.muted).child(facts))
    .when(prompt !== null, (el) => el.child(div().pt(2).text_xs().text_color(p.muted).child(prompt ?? "")));
}

export function agentBlock(sessions: readonly AgentSession[], p: Palette): Element {
  return v_flex()
    .px(10)
    .gap(8)
    .children(
      sessions.map((s, i) =>
        h_flex().gap(10).items_start().child(label(i === 0 ? "AGENT" : "", p)).child(session(s, p)),
      ),
    );
}
