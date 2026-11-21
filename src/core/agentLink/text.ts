/** "812 tokens", "12.4K tokens", "2.1M tokens". */
export function tokenText(n: number): string {
  const short = n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : String(n);
  return `${short} token${n === 1 ? "" : "s"}`;
}

/** A prompt as the person typed it: without the tags their client wrapped pasted text in. */
export function promptText(raw: string): string {
  return raw.replace(/<\/?pasted_content\b[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
