import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { applyPreferences, loadPreferences, savePreferences, type Preferences } from "./preferences.ts";

interface UiState {
  askOpen: boolean;
  setAskOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  preferences: Preferences;
  updatePreferences: (changes: Partial<Preferences>) => void;
  dark: boolean;
  toggleDark: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const Ctx = createContext<UiState | null>(null);

const systemDarkQuery = () => matchMedia("(prefers-color-scheme: dark)");

export function UiProvider({ children }: { children: ReactNode }) {
  const [askOpen, setAskOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 900);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [systemDark, setSystemDark] = useState(() => systemDarkQuery().matches);
  const dark = preferences.mode === "system" ? systemDark : preferences.mode === "dark";

  useEffect(() => {
    const query = systemDarkQuery();
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useLayoutEffect(() => applyPreferences(preferences, dark), [preferences, dark]);

  const updatePreferences = useCallback((changes: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...changes };
      savePreferences(next);
      return next;
    });
  }, []);

  const toggleDark = useCallback(() => updatePreferences({ mode: dark ? "light" : "dark" }), [dark, updatePreferences]);

  const value = useMemo(
    () => ({ askOpen, setAskOpen, paletteOpen, setPaletteOpen, settingsOpen, setSettingsOpen, preferences, updatePreferences, dark, toggleDark, sidebarOpen, setSidebarOpen }),
    [askOpen, paletteOpen, settingsOpen, preferences, updatePreferences, dark, toggleDark, sidebarOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): UiState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useUi outside UiProvider");
  return value;
}
