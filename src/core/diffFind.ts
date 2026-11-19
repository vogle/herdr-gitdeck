// Finding words in the diff the viewer shows: which rows hold them, and moving
// from one match to the next (Enter) or back (Shift+Enter), round and round.

/** The indices of the rows whose text holds the query, case aside; none for a blank query. */
export function findRows(rows: readonly { text: string }[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return rows.flatMap((r, i) => (r.text.toLowerCase().includes(q) ? [i] : []));
}

/** The match after (or before) `at`, wrapping at the ends. */
export function stepMatch(count: number, at: number, back: boolean): number {
  if (count === 0) return 0;
  return (at + (back ? count - 1 : 1)) % count;
}
