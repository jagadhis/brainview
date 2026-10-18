import { Check, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { FOLDER_PALETTES } from "../lib/colors.ts";
import { ACCENTS, DEFAULT_PREFERENCES, FONT_STACKS, type Preferences } from "../lib/preferences.ts";
import { useUi } from "../lib/ui-state.tsx";
import { Button, clsx } from "./ui.tsx";

type Choice<T extends string> = { value: T; label: string; font?: string };

function Segmented<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: Choice<T>[]; onChange: (value: T) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] text-ink-soft">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-line bg-sunken p-0.5">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={value === choice.value}
            onClick={() => onChange(choice.value)}
            style={choice.font ? { fontFamily: choice.font } : undefined}
            className={clsx(
              "h-7 rounded-md px-2.5 text-[12.5px] font-medium transition focus-visible:outline-2 focus-visible:outline-accent",
              value === choice.value ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink",
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A font choice whose label is drawn in that font, so the panel previews it. */
function font<T extends keyof typeof FONT_STACKS>(value: T, label: string): Choice<T> {
  return { value, label, font: FONT_STACKS[value] };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-5 py-4 last:border-b-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPanel() {
  const { settingsOpen, setSettingsOpen, preferences, updatePreferences } = useUi();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (settingsOpen) dialog.current?.querySelector<HTMLElement>("button[aria-checked=true]")?.focus();
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const close = () => setSettingsOpen(false);
  const set = <K extends keyof Preferences>(key: K) => (value: Preferences[K]) => updatePreferences({ [key]: value });
  const isPreset = ACCENTS.some((a) => a.hex === preferences.accent);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[10vh]" onMouseDown={close}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="animate-in max-h-[80vh] w-full max-w-[520px] overflow-y-auto rounded-2xl border border-line bg-raised shadow-2xl shadow-black/20"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink">Settings</h2>
          <Button variant="ghost" size="sm" className="!px-1.5" onClick={close} title="Close settings">
            <X size={15} />
          </Button>
        </header>

        <Section title="Appearance">
          <Segmented label="Theme" value={preferences.mode} onChange={set("mode")} choices={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
          <Segmented label="Background" value={preferences.tone} onChange={set("tone")} choices={[{ value: "neutral", label: "Neutral" }, { value: "warm", label: "Warm" }, { value: "cool", label: "Cool" }]} />
          <div className="flex items-center justify-between gap-4">
            <span className="text-[13px] text-ink-soft">Accent</span>
            <div role="radiogroup" aria-label="Accent" className="flex flex-wrap items-center justify-end gap-1.5">
              {ACCENTS.map((a) => (
                <button
                  key={a.hex}
                  type="button"
                  role="radio"
                  aria-checked={preferences.accent === a.hex}
                  aria-label={a.name}
                  title={a.name}
                  onClick={() => updatePreferences({ accent: a.hex })}
                  className="grid size-6 place-items-center rounded-full ring-offset-2 ring-offset-raised transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-accent aria-checked:ring-2 aria-checked:ring-ink/40"
                  style={{ background: a.hex }}
                >
                  {preferences.accent === a.hex && <Check size={13} className="text-white" />}
                </button>
              ))}
              <label
                title="Custom color"
                className={clsx("relative grid size-6 cursor-pointer place-items-center rounded-full ring-offset-2 ring-offset-raised", !isPreset && "ring-2 ring-ink/40")}
                style={{ background: isPreset ? "conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #6d5dfc, #ec4899, #ef4444)" : preferences.accent }}
              >
                <input type="color" aria-label="Custom accent color" value={preferences.accent} onChange={(e) => updatePreferences({ accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
            </div>
          </div>
        </Section>

        <Section title="Reading">
          <Segmented label="Text size" value={preferences.textSize} onChange={set("textSize")} choices={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} />
          <Segmented label="Line width" value={preferences.lineWidth} onChange={set("lineWidth")} choices={[{ value: "narrow", label: "Narrow" }, { value: "normal", label: "Normal" }, { value: "wide", label: "Wide" }]} />
        </Section>

        <Section title="Fonts">
          <Segmented label="Interface" value={preferences.interfaceFont} onChange={set("interfaceFont")} choices={[font("inter", "Inter"), font("figtree", "Figtree")]} />
          <Segmented label="Note text" value={preferences.noteFont} onChange={set("noteFont")} choices={[font("inter", "Inter"), font("figtree", "Figtree"), font("serif", "Serif")]} />
          <Segmented label="Properties" value={preferences.propertiesFont} onChange={set("propertiesFont")} choices={[font("inter", "Inter"), font("figtree", "Figtree"), font("serif", "Serif"), font("mono", "Mono")]} />
          <Segmented label="Code" value={preferences.codeFont} onChange={set("codeFont")} choices={[font("jetbrains", "JetBrains Mono"), font("fira", "Fira Code"), font("system", "System")]} />
        </Section>

        <Section title="Graph">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[13px] text-ink-soft">Folder colors</span>
            <div role="radiogroup" aria-label="Folder colors" className="flex gap-1.5">
              {(Object.keys(FOLDER_PALETTES) as Preferences["folderPalette"][]).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={preferences.folderPalette === name}
                  onClick={() => updatePreferences({ folderPalette: name })}
                  className={clsx(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-[11.5px] font-medium capitalize transition focus-visible:outline-2 focus-visible:outline-accent",
                    preferences.folderPalette === name ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-soft hover:bg-sunken",
                  )}
                >
                  <span className="flex gap-0.5">
                    {FOLDER_PALETTES[name].slice(0, 6).map((color) => (
                      <span key={color} className="size-2 rounded-full" style={{ background: color }} />
                    ))}
                  </span>
                  {name}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <footer className="flex items-center justify-between px-5 py-3">
          <span className="text-[12px] text-ink-faint">Saved in this browser.</span>
          <Button size="sm" variant="ghost" onClick={() => updatePreferences(DEFAULT_PREFERENCES)}>
            Reset to defaults
          </Button>
        </footer>
      </div>
    </div>
  );
}
