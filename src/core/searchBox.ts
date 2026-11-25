// A search box's clear: the × while it holds text, and Esc.

/** Esc empties a box that holds text; on an empty one it goes on (the panel's Back). */
export const clearsOnEscape = (keystroke: string, value: string): boolean => keystroke === "escape" && value !== "";

/** The × shows while there is anything to clear. */
export const showsClear = (value: string): boolean => value !== "";
