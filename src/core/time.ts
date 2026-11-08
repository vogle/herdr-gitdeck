// Commit times for people: "3d" in the graph, a full stamp in the details.

const UNITS: ReadonlyArray<readonly [number, string]> = [
  [365 * 86400, "y"],
  [30 * 86400, "mo"],
  [86400, "d"],
  [3600, "h"],
  [60, "m"],
];

/** How long before `now` (both Unix seconds); "" when the time is unknown. */
export function ago(now: number, then: number): string {
  if (then <= 0) return "";
  const seconds = now - then;
  const unit = UNITS.find(([size]) => seconds >= size);
  return unit ? `${Math.floor(seconds / unit[0])}${unit[1]}` : "now";
}

const two = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD HH:MM in the machine's time zone. */
export function dateTime(seconds: number): string {
  if (seconds <= 0) return "";
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
