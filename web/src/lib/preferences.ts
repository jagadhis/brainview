export type ThemeMode = "light" | "dark" | "system";
export type BaseTone = "neutral" | "warm" | "cool";
export type TextSize = "small" | "medium" | "large";
export type LineWidth = "narrow" | "normal" | "wide";
export type InterfaceFont = "inter" | "figtree";
export type NoteFont = "inter" | "figtree" | "serif";
export type PropertiesFont = "inter" | "figtree" | "serif" | "mono";
export type CodeFont = "jetbrains" | "fira" | "system";
export type FolderPalette = "vivid" | "pastel" | "muted";

export interface Preferences {
  mode: ThemeMode;
  tone: BaseTone;
  accent: string;
  textSize: TextSize;
  lineWidth: LineWidth;
  interfaceFont: InterfaceFont;
  noteFont: NoteFont;
  propertiesFont: PropertiesFont;
  codeFont: CodeFont;
  folderPalette: FolderPalette;
}

export const ACCENTS = [
  { name: "Violet", hex: "#6d5dfc" },
  { name: "Blue", hex: "#2f6fed" },
  { name: "Teal", hex: "#0d9488" },
  { name: "Green", hex: "#16a34a" },
  { name: "Amber", hex: "#d97706" },
  { name: "Orange", hex: "#ea580c" },
  { name: "Rose", hex: "#e11d48" },
  { name: "Slate", hex: "#64748b" },
] as const;

export const DEFAULT_PREFERENCES: Preferences = {
  mode: "system",
  tone: "neutral",
  accent: ACCENTS[0].hex,
  textSize: "medium",
  lineWidth: "normal",
  interfaceFont: "inter",
  noteFont: "inter",
  propertiesFont: "inter",
  codeFont: "jetbrains",
  folderPalette: "vivid",
};

const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const FONT_STACKS = {
  inter: `"Inter Variable", ${SANS_FALLBACK}`,
  figtree: `"Figtree Variable", ${SANS_FALLBACK}`,
  serif: `"Iowan Old Style", Charter, "Palatino Linotype", Georgia, ui-serif, serif`,
  jetbrains: `"JetBrains Mono Variable", ${MONO_FALLBACK}`,
  fira: `"Fira Code Variable", ${MONO_FALLBACK}`,
  system: MONO_FALLBACK,
  // Mono properties follow whichever code font is chosen.
  mono: "var(--bv-font-code)",
} as const;

// index.html reads the same keys before the app loads, so the first paint already has the right mode and tone.
const STORAGE_KEY = "brainview:preferences";
const LEGACY_THEME_KEY = "brainview:theme";
const HEX = /^#[0-9a-f]{6}$/i;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Reads saved preferences, falling back per field so an older or hand-edited value never breaks the app. */
export function loadPreferences(): Preferences {
  let saved: Record<string, unknown> = {};
  let legacyMode: string | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
    legacyMode = localStorage.getItem(LEGACY_THEME_KEY);
  } catch {}
  const d = DEFAULT_PREFERENCES;
  return {
    mode: oneOf(saved.mode ?? legacyMode, ["light", "dark", "system"], d.mode),
    tone: oneOf(saved.tone, ["neutral", "warm", "cool"], d.tone),
    accent: typeof saved.accent === "string" && HEX.test(saved.accent) ? saved.accent.toLowerCase() : d.accent,
    textSize: oneOf(saved.textSize, ["small", "medium", "large"], d.textSize),
    lineWidth: oneOf(saved.lineWidth, ["narrow", "normal", "wide"], d.lineWidth),
    interfaceFont: oneOf(saved.interfaceFont, ["inter", "figtree"], d.interfaceFont),
    noteFont: oneOf(saved.noteFont, ["inter", "figtree", "serif"], d.noteFont),
    propertiesFont: oneOf(saved.propertiesFont, ["inter", "figtree", "serif", "mono"], d.propertiesFont),
    codeFont: oneOf(saved.codeFont, ["jetbrains", "fira", "system"], d.codeFont),
    folderPalette: oneOf(saved.folderPalette, ["vivid", "pastel", "muted"], d.folderPalette),
  };
}

export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {}
}

/** Puts the preferences on the document: the dark class and data attributes drive styles.css; fonts and accent shades are set as variables. */
export function applyPreferences(preferences: Preferences, dark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.tone = preferences.tone;
  root.dataset.textSize = preferences.textSize;
  root.dataset.lineWidth = preferences.lineWidth;
  root.style.setProperty("--bv-font-ui", FONT_STACKS[preferences.interfaceFont]);
  root.style.setProperty("--bv-font-note", FONT_STACKS[preferences.noteFont]);
  root.style.setProperty("--bv-font-props", FONT_STACKS[preferences.propertiesFont]);
  root.style.setProperty("--bv-font-code", FONT_STACKS[preferences.codeFont]);
  for (const [name, value] of Object.entries(accentShades(preferences.accent, dark))) root.style.setProperty(`--bv-${name}`, value);

  const icon = document.querySelector<HTMLLinkElement>("link[rel=icon]");
  if (icon) icon.href = icon.href.replace(/fill='%23[0-9a-f]{6}'/i, `fill='%23${preferences.accent.slice(1)}'`);
}

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const DARK_CANVAS: Rgb = [17, 17, 19];
const INK: Rgb = [28, 28, 26];

/**
 * Derives the accent family from one color. Links use accent-ink, so it is pushed toward black (light) or white (dark)
 * until it reads at 4.5:1 on the canvas; text on an accent fill switches to dark ink when white would drop below 3:1.
 */
function accentShades(hex: string, dark: boolean): Record<"accent" | "accent-soft" | "accent-ink" | "accent-contrast", string> {
  const base = toRgb(hex);
  const accent = dark ? mix(base, WHITE, 0.2) : base;
  const background = dark ? DARK_CANVAS : WHITE;
  const toward = dark ? WHITE : BLACK;
  let t = dark ? 0.55 : 0.25;
  let ink = mix(base, toward, t);
  while (contrast(ink, background) < 4.5 && t < 0.9) ink = mix(base, toward, (t += 0.05));
  return {
    accent: toHex(accent),
    "accent-soft": toHex(dark ? mix(base, DARK_CANVAS, 0.82) : mix(base, WHITE, 0.89)),
    "accent-ink": toHex(ink),
    "accent-contrast": contrast(WHITE, accent) >= 3 ? "#ffffff" : toHex(INK),
  };
}

function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((c, i) => c + (to[i]! - c) * amount) as Rgb;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
