import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import CodeMirror, { EditorSelection, EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { diffLines } from "diff";
import { AlertTriangle, Check, Columns2, Eye, FileCode2, ListChecks, Lock, Save, Sparkles, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { parseFrontmatter } from "../../../src/shared/frontmatter.ts";
import type { AssistAction, NoteDetail } from "../../../src/shared/types.ts";
import { api, isConflict } from "../lib/api.ts";
import { useClientLinkResolver } from "../lib/link-resolver.ts";
import { keys, useInfo, useNoteMap } from "../lib/queries.ts";
import { useToast } from "../lib/toast.tsx";
import { useUi } from "../lib/ui-state.tsx";
import { AssistPanel, ASSIST_ACTIONS } from "./AssistPanel.tsx";
import { Markdown } from "./Markdown.tsx";
import { PropertiesForm } from "./Properties.tsx";
import { Button, clsx, Spinner } from "./ui.tsx";

type Mode = "split" | "source" | "preview";

interface Selection {
  from: number;
  to: number;
  text: string;
}

interface Conflict {
  hash: string;
  content: string;
}

const MODES: { id: Mode; icon: typeof Columns2; label: string }[] = [
  { id: "source", icon: FileCode2, label: "Source" },
  { id: "split", icon: Columns2, label: "Split" },
  { id: "preview", icon: Eye, label: "Preview" },
];

export function NoteEditor({ note, initialLine, readOnly, onDone }: { note: NoteDetail; initialLine: number | null; readOnly: boolean; onDone: () => void }) {
  const toast = useToast();
  const client = useQueryClient();
  const { dark, setEditorDirty } = useUi();
  const { data: info } = useInfo();
  const notes = useNoteMap();
  const resolveNote = useClientLinkResolver(notes, note.path);
  const editor = useRef<ReactCodeMirrorRef>(null);
  const shell = useRef<HTMLDivElement>(null);

  const [buffer, setBuffer] = useState(note.content);
  const [saved, setSaved] = useState({ content: note.content, hash: note.hash });
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("brainview:editor-mode") as Mode | null) ?? "split");
  const [showProps, setShowProps] = useState(() => localStorage.getItem("brainview:editor-props") !== "0");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [assist, setAssist] = useState<{ action: AssistAction; selection: Selection } | null>(null);
  const [toolbarAt, setToolbarAt] = useState<{ top: number; left: number } | null>(null);
  const preview = useDeferredValue(buffer);
  const generatedConfirmed = useRef(false);

  const dirty = buffer !== saved.content;
  const changedOnDisk = note.hash !== saved.hash;
  const fieldCount = useMemo(() => Object.keys(parseFrontmatter(buffer).data ?? {}).length, [buffer]);

  useEffect(() => localStorage.setItem("brainview:editor-mode", mode), [mode]);
  useEffect(() => localStorage.setItem("brainview:editor-props", showProps ? "1" : "0"), [showProps]);

  // Follow edits made elsewhere while there is nothing unsaved here.
  useEffect(() => {
    if (changedOnDisk && !dirty) {
      setBuffer(note.content);
      setSaved({ content: note.content, hash: note.hash });
    }
  }, [changedOnDisk, dirty, note.content, note.hash]);

  useEffect(() => {
    setEditorDirty(dirty);
    return () => setEditorDirty(false);
  }, [dirty, setEditorDirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useCallback(
    async (baseHash = saved.hash) => {
      if (readOnly || saving) return;
      if (note.generated && !generatedConfirmed.current) {
        if (!window.confirm("This file is marked generated: true, so a tool may overwrite your edits. Save anyway?")) return;
        generatedConfirmed.current = true;
      }
      const content = editor.current?.view?.state.doc.toString() ?? buffer;
      setSaving(true);
      try {
        const result = await api.save(note.path, content, baseHash);
        // The cached note carries the hash that a delete or move sends next, before the watcher's refetch lands.
        client.setQueryData(keys.note(note.path), result);
        setSaved({ content, hash: result.hash });
        setConflict(null);
        toast("Saved", "success");
      } catch (err) {
        if (isConflict(err)) setConflict({ hash: err.body.hash, content: err.body.content });
        else toast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setSaving(false);
      }
    },
    [buffer, client, note.generated, note.path, readOnly, saved.hash, saving, toast],
  );

  const saveRef = useRef(save);
  saveRef.current = save;
  const extensions = useMemo(
    () => [
      yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages }) }),
      EditorView.lineWrapping,
      Prec.highest(keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (void saveRef.current(), true) }])),
      EditorView.contentAttributes.of({ spellcheck: "true" }),
    ],
    [],
  );

  const onCreate = useCallback(
    (view: EditorView) => {
      if (!initialLine) return;
      const line = view.state.doc.line(Math.min(initialLine, view.state.doc.lines));
      view.dispatch({ selection: EditorSelection.cursor(line.from), effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      view.focus();
    },
    [initialLine],
  );

  const onUpdate = useCallback((update: { view: EditorView; selectionSet: boolean; docChanged: boolean }) => {
    if (!update.selectionSet && !update.docChanged) return;
    const { from, to } = update.view.state.selection.main;
    if (from === to) {
      setSelection(null);
      setToolbarAt(null);
      return;
    }
    setSelection({ from, to, text: update.view.state.sliceDoc(from, to) });
    const coords = update.view.coordsAtPos(from);
    const box = shell.current?.getBoundingClientRect();
    if (coords && box) setToolbarAt({ top: coords.top - box.top - 40, left: Math.max(8, coords.left - box.left) });
  }, []);

  const startAssist = (action: AssistAction) => {
    if (!selection) return;
    setAssist({ action, selection });
    setToolbarAt(null);
  };

  const acceptAssist = (replacement: string) => {
    const view = editor.current?.view;
    if (!view || !assist) return;
    const { from, to, text } = assist.selection;
    if (view.state.sliceDoc(from, to) !== text) {
      toast("The text changed while Claude was writing, so the suggestion was not applied.", "error");
      return;
    }
    view.dispatch({ changes: { from, to, insert: replacement }, selection: EditorSelection.range(from, from + replacement.length) });
    view.focus();
    setAssist(null);
  };

  const exit = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onDone();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-14 pb-2.5 pt-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-ink">{note.title}</div>
          <div className="truncate font-mono text-[11px] text-ink-faint">{note.path}</div>
        </div>
        <div className="flex items-center rounded-lg border border-line bg-canvas p-0.5">
          {MODES.map(({ id, icon: Icon, label }) => (
            <button
              type="button"
              key={id}
              onClick={() => setMode(id)}
              className={clsx("flex h-6 items-center gap-1 rounded-md px-2 text-[12px]", mode === id ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-faint hover:text-ink")}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <Button size="sm" variant={showProps ? "outline" : "ghost"} onClick={() => setShowProps(!showProps)}>
          <ListChecks size={13} /> Properties{fieldCount ? ` · ${fieldCount}` : ""}
        </Button>
        <span className={clsx("w-24 text-right text-[12px]", dirty ? "text-amber-600 dark:text-amber-400" : "text-ink-faint")}>
          {saving ? "Saving…" : dirty ? "Unsaved" : "All saved"}
        </span>
        <Button size="sm" variant="primary" disabled={readOnly || !dirty || saving} onClick={() => void save()} title="Save (⌘S)">
          {saving ? <Spinner /> : <Save size={13} />} Save
        </Button>
        <Button size="sm" variant="outline" onClick={exit} className="mr-24">
          <Check size={13} /> Done
        </Button>
      </div>

      {(readOnly || note.generated || (changedOnDisk && dirty)) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-14 py-1.5 text-[12.5px] text-amber-800 dark:text-amber-300">
          {readOnly ? <Lock size={13} /> : <AlertTriangle size={13} />}
          {readOnly
            ? "brainview was started with --read-only, so changes cannot be saved."
            : changedOnDisk && dirty
              ? "This note changed on disk after you started editing."
              : "This file is generated (generated: true). A tool may overwrite manual edits."}
          {changedOnDisk && dirty && !readOnly && (
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  setBuffer(note.content);
                  setSaved({ content: note.content, hash: note.hash });
                }}
              >
                Load the disk version
              </button>
              <button type="button" className="font-medium underline" onClick={() => setConflict({ hash: note.hash, content: note.content })}>
                Compare
              </button>
            </span>
          )}
        </div>
      )}

      {showProps && (
        <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-line bg-canvas px-14 py-3">
          <div className="max-w-[860px]">
            <PropertiesForm source={buffer} onChange={setBuffer} />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {mode !== "preview" && (
          <div ref={shell} className={clsx("relative min-w-0 overflow-hidden bg-surface", mode === "split" ? "w-1/2 border-r border-line" : "flex-1")}>
            <CodeMirror
              ref={editor}
              value={buffer}
              onChange={setBuffer}
              onCreateEditor={onCreate}
              onUpdate={onUpdate}
              extensions={extensions}
              theme={dark ? "dark" : "light"}
              readOnly={readOnly}
              height="100%"
              className="h-full"
              basicSetup={{ foldGutter: true, highlightActiveLine: true, bracketMatching: true }}
            />
            {toolbarAt && selection && info?.ai.available && !readOnly && !assist && (
              <div
                // Shifted left so every action fits beside a selection near the right edge; it wraps only when the editor is narrower than the toolbar.
                ref={(el) => {
                  if (el?.parentElement) el.style.left = `${Math.max(8, Math.min(toolbarAt.left, el.parentElement.clientWidth - el.offsetWidth - 8))}px`;
                }}
                className="animate-in absolute z-20 flex w-max max-w-[calc(100%-16px)] flex-wrap items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5 shadow-lg shadow-black/10"
                style={{ top: Math.max(4, toolbarAt.top), left: toolbarAt.left }}
              >
                <Sparkles size={13} className="mx-1.5 text-accent" />
                {ASSIST_ACTIONS.map((a) => (
                  <button type="button" key={a.id} onMouseDown={(e) => e.preventDefault()} onClick={() => startAssist(a.id)} className="rounded-md px-2 py-1 text-[12px] text-ink-soft hover:bg-sunken hover:text-ink">
                    {a.label}
                  </button>
                ))}
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => startAssist("custom")} className="rounded-md px-2 py-1 text-[12px] font-medium text-accent-ink hover:bg-accent-soft">
                  Ask…
                </button>
              </div>
            )}
            {assist && <AssistPanel key={`${assist.action}-${assist.selection.from}`} path={note.path} doc={buffer} action={assist.action} selection={assist.selection} onAccept={acceptAssist} onClose={() => setAssist(null)} />}
          </div>
        )}
        {mode !== "source" && (
          <div className={clsx("min-w-0 overflow-y-auto bg-canvas", mode === "split" ? "w-1/2" : "flex-1")}>
            <div className={clsx("mx-auto px-10 pb-24 pt-8", mode === "preview" ? "max-w-[780px]" : "max-w-[720px]")}>
              <Markdown source={preview} path={note.path} kind={note.kind} resolveNote={resolveNote} />
            </div>
          </div>
        )}
      </div>

      {conflict && (
        <ConflictDialog
          mine={buffer}
          theirs={conflict.content}
          onKeepMine={() => void save(conflict.hash)}
          onTakeTheirs={() => {
            setBuffer(conflict.content);
            setSaved({ content: conflict.content, hash: conflict.hash });
            setConflict(null);
          }}
          onClose={() => setConflict(null)}
        />
      )}
    </div>
  );
}

function ConflictDialog({ mine, theirs, onKeepMine, onTakeTheirs, onClose }: { mine: string; theirs: string; onKeepMine: () => void; onTakeTheirs: () => void; onClose: () => void }) {
  const parts = useMemo(() => diffLines(theirs, mine), [mine, theirs]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <div role="dialog" aria-modal="true" aria-label="The file changed on disk" className="animate-in flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <AlertTriangle size={18} className="mt-0.5 text-amber-500" />
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-ink">The file changed on disk</div>
            <div className="mt-0.5 text-[13px] text-ink-soft">Another editor or tool saved this note after you opened it. Nothing has been overwritten yet.</div>
          </div>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-sunken px-5 py-3 font-mono text-[12px] leading-relaxed">
          <div className="mb-2 flex gap-4 font-sans text-[11.5px] text-ink-faint">
            <span>
              <span className="mr-1 inline-block size-2 rounded-sm bg-red-500/60" /> only on disk
            </span>
            <span>
              <span className="mr-1 inline-block size-2 rounded-sm bg-emerald-500/60" /> only in your version
            </span>
          </div>
          {parts.map((part, i) =>
            part.added || part.removed ? (
              <pre key={i} className={clsx("whitespace-pre-wrap px-2", part.added ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300" : "bg-red-500/12 text-red-800 dark:text-red-300")}>
                {part.value.replace(/\n$/, "")}
              </pre>
            ) : (
              <pre key={i} className="whitespace-pre-wrap px-2 text-ink-faint">
                {part.value.split("\n").length > 6 ? `${part.value.split("\n").slice(0, 2).join("\n")}\n  ⋯\n${part.value.split("\n").slice(-3).join("\n")}`.replace(/\n$/, "") : part.value.replace(/\n$/, "")}
              </pre>
            ),
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="outline" onClick={onTakeTheirs}>
            Discard mine, load disk version
          </Button>
          <Button variant="danger" onClick={onKeepMine}>
            Overwrite with my version
          </Button>
        </div>
      </div>
    </div>
  );
}
