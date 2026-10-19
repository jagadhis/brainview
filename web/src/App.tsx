import { Moon, PanelLeft, Settings, Sparkles, Sun } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Route, Switch } from "wouter";
import { AskPanel } from "./components/AskPanel.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { NoteDialogs } from "./components/NoteDialogs.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Button, Spinner } from "./components/ui.tsx";
import { useLiveVault } from "./lib/queries.ts";
import { useUi } from "./lib/ui-state.tsx";
import { ArtifactPage } from "./pages/ArtifactPage.tsx";
import { NotePage } from "./pages/NotePage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";

const GraphPage = lazy(() => import("./pages/GraphPage.tsx").then((m) => ({ default: m.GraphPage })));
const TablePage = lazy(() => import("./pages/TablePage.tsx").then((m) => ({ default: m.TablePage })));
const HealthPage = lazy(() => import("./pages/HealthPage.tsx").then((m) => ({ default: m.HealthPage })));
const TagsPage = lazy(() => import("./pages/TagsPage.tsx").then((m) => ({ default: m.TagsPage })));
const TimelinePage = lazy(() => import("./pages/TimelinePage.tsx").then((m) => ({ default: m.TimelinePage })));

export function App() {
  const { setPaletteOpen, paletteOpen, askOpen, setAskOpen, dark, toggleDark, setSettingsOpen, sidebarOpen, setSidebarOpen } = useUi();
  const [askSeed, setAskSeed] = useState<{ question: string; nonce: number } | null>(null);
  useLiveVault();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAskOpen(!askOpen);
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        setSidebarOpen(!sidebarOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askOpen, paletteOpen, setAskOpen, setPaletteOpen, setSidebarOpen, sidebarOpen]);

  const ask = useCallback(
    (question: string) => {
      setAskSeed({ question, nonce: Date.now() });
      setAskOpen(true);
    },
    [setAskOpen],
  );

  return (
    <div className="flex h-full overflow-hidden">
      {sidebarOpen && <Sidebar />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-3 pt-2.5">
          <Button variant="ghost" size="sm" className="pointer-events-auto !px-1.5" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar (⌘\)">
            <PanelLeft size={15} />
          </Button>
          <div className="pointer-events-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="!px-1.5" onClick={toggleDark} title="Toggle theme">
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </Button>
            <Button variant="ghost" size="sm" className="!px-1.5" onClick={() => setSettingsOpen(true)} title="Settings">
              <Settings size={15} />
            </Button>
            {!askOpen && !sidebarOpen && (
              <Button variant="outline" size="sm" onClick={() => setAskOpen(true)} title="Ask your brain (⌘J)">
                <Sparkles size={14} className="text-accent" /> Ask
              </Button>
            )}
          </div>
        </div>
        <main className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<Spinner className="m-10 text-ink-faint" />}>
            <Switch>
              <Route path="/" component={OverviewPage} />
              <Route path="/graph" component={GraphPage} />
              <Route path="/table" component={TablePage} />
              <Route path="/health" component={HealthPage} />
              <Route path="/tags">{() => <TagsPage />}</Route>
              <Route path="/tags/*">{(params) => <TagsPage routeTag={params["*"]} />}</Route>
              <Route path="/timeline" component={TimelinePage} />
              <Route path="/artifact/*">{(params) => <ArtifactPage routePath={params["*"]} />}</Route>
              <Route path="/note/*">{(params) => <NotePage routePath={params["*"]} onAsk={ask} />}</Route>
              <Route>
                <div className="p-10 text-ink-soft">Page not found.</div>
              </Route>
            </Switch>
          </Suspense>
        </main>
      </div>
      {askOpen && <AskPanel seed={askSeed} onClose={() => setAskOpen(false)} />}
      <CommandPalette onAsk={ask} />
      <SettingsPanel />
      <NoteDialogs />
    </div>
  );
}
