// Accent colors shared with the app's Progress screen (lib/design.dart).
export const GOLD = "#ffc857";
export const SAGE = "#80bea4";
export const FROST = "#9fd3ff";
export const MYSTIC = "#b28dff";
export const EMBER = "#ff8a4c";
export const BRONZE = "#c98b5a";

export const TONES: Record<string, string> = {
  gold: GOLD,
  sage: SAGE,
  frost: FROST,
  mystic: MYSTIC,
  ember: EMBER,
};

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
