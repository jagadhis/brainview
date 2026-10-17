import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface UiState {
  askOpen: boolean;
  setAskOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  dark: boolean;
  toggleDark: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const Ctx = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [askOpen, setAskOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 900);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const toggleDark = useCallback(() => {
    setDark((d) => {
      localStorage.setItem("brainview:theme", d ? "light" : "dark");
      return !d;
    });
  }, []);

  const value = useMemo(
    () => ({ askOpen, setAskOpen, paletteOpen, setPaletteOpen, dark, toggleDark, sidebarOpen, setSidebarOpen }),
    [askOpen, paletteOpen, dark, toggleDark, sidebarOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): UiState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useUi outside UiProvider");
  return value;
}
