import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, TriangleAlert, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { basename, dirname, isNotePath, stripExtension } from "../../../src/shared/paths.ts";
import { api, isConflict } from "../lib/api.ts";
import { keys, useNote, useTemplates } from "../lib/queries.ts";
import { noteHref } from "../lib/routes.ts";
import { useToast } from "../lib/toast.tsx";
import { useUi } from "../lib/ui-state.tsx";
import { useCanWrite, useCurrentNotePath } from "./NoteActions.tsx";
import { Button, Spinner } from "./ui.tsx";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Moving, deleting or restoring opens another page, which drops the editor's unsaved text; ask first. */
function useDiscardOk(): () => boolean {
  const { editorDirty } = useUi();
  return () => !editorDirty || window.confirm("The editor has unsaved changes, which this will discard. Continue?");
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const fieldClass = "h-8 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-accent/50";

/** The file a new note goes to: the typed path, or a file named after the title when only a folder is given. */
function newNotePath(path: string, title: string): string | null {
  let target = path.trim().replace(/^\/+/, "");
  if (!target || target.endsWith("/")) {
    const name = title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    if (!name) return null;
    target += name;
  }
  return isNotePath(target) ? target : `${target}.md`;
}

interface Deleted {
  trashId: string;
  title: string;
}

export function NoteDialogs() {
  const { noteDialog, setNoteDialog } = useUi();
  const canWrite = useCanWrite();
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const close = () => setNoteDialog(null);
  const dismissUndo = useCallback(() => setDeleted(null), []);

  if (!canWrite) return null;
  return (
    <>
      {noteDialog?.kind === "new" && <NewNoteDialog onClose={close} />}
      {noteDialog?.kind === "move" && <MoveNoteDialog key={noteDialog.path} path={noteDialog.path} onClose={close} />}
      {noteDialog?.kind === "delete" && <DeleteNoteDialog key={noteDialog.path} path={noteDialog.path} onClose={close} onDeleted={setDeleted} />}
      {deleted && <UndoDelete key={deleted.trashId} deleted={deleted} onDone={dismissUndo} />}
    </>
  );
}

function Dialog({ title, onClose, onSubmit, children, actions }: { title: string; onClose: () => void; onSubmit: () => void; children: ReactNode; actions: ReactNode }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[14vh]" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="animate-in w-full max-w-[480px] rounded-2xl border border-line bg-raised shadow-2xl shadow-black/20"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <Button variant="ghost" size="sm" className="!px-1.5" onClick={onClose} title="Close">
            <X size={15} />
          </Button>
        </header>
        <div className="space-y-3.5 px-5 py-4">{children}</div>
        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{actions}</footer>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block truncate text-[11.5px] text-ink-faint">{hint}</span>}
    </label>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-[12.5px] text-red-600 dark:text-red-400">
      <CircleAlert size={14} className="mt-px shrink-0" />
      {error}
    </p>
  );
}

function NewNoteDialog({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const current = useCurrentNotePath();
  const { data: templates } = useTemplates();
  const [title, setTitle] = useState("");
  const [path, setPath] = useState(() => (current && dirname(current) ? `${dirname(current)}/` : ""));
  const [template, setTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = newNotePath(path, title);

  const create = async () => {
    if (!target) return setError("Give the note a title or a file name.");
    setBusy(true);
    setError(null);
    const heading = title.trim() || stripExtension(basename(target));
    try {
      const note = template ? await api.createFromTemplate(target, template, heading) : await api.create(target, `# ${heading}\n`);
      client.setQueryData(keys.note(note.path), note);
      onClose();
      navigate(noteHref(note.path));
    } catch (err) {
      setError(isConflict(err) ? `${target} already exists.` : message(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New note"
      onClose={onClose}
      onSubmit={() => void create()}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !target}>
            {busy && <Spinner />} Create note
          </Button>
        </>
      }
    >
      <Field label="Title">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting notes" className={fieldClass} />
      </Field>
      <Field label="Path" hint={target ? `Creates ${target}` : "A folder ending in / names the file after the title."}>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="folder/note.md" spellCheck={false} className={`${fieldClass} font-mono !text-[12.5px]`} />
      </Field>
      <Field label="Template">
        <select value={template} onChange={(e) => setTemplate(e.target.value)} className={fieldClass}>
          <option value="">Blank note</option>
          {templates?.map((t) => (
            <option key={t.path} value={t.path}>
              {t.title}
            </option>
          ))}
        </select>
      </Field>
      <ErrorLine error={error} />
    </Dialog>
  );
}

function MoveNoteDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [, navigate] = useLocation();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [to, setTo] = useState(path);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const discardOk = useDiscardOk();
  const extension = path.slice(path.lastIndexOf("."));
  const target = to.trim().replace(/^\/+/, "");
  const destination = isNotePath(target) ? target : `${target}${extension}`;

  useEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(path.lastIndexOf("/") + 1, path.length - extension.length);
  }, [path, extension]);

  const move = async () => {
    if (!discardOk()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.move(path, destination);
      onClose();
      navigate(noteHref(result.path));
      toast(`Moved, ${plural(result.updated.length, "note's", "notes'")} links updated`, "success");
    } catch (err) {
      setError(isConflict(err) ? "A note that links here changed on disk since brainview read it, so nothing moved. Try again in a moment." : message(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Rename or move note"
      onClose={onClose}
      onSubmit={() => void move()}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !target || destination === path}>
            {busy && <Spinner />} Move
          </Button>
        </>
      }
    >
      <Field label="Path" hint="Links to this note in other notes are updated to the new path.">
        <input ref={input} value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} className={`${fieldClass} font-mono !text-[12.5px]`} />
      </Field>
      <ErrorLine error={error} />
    </Dialog>
  );
}

function DeleteNoteDialog({ path, onClose, onDeleted }: { path: string; onClose: () => void; onDeleted: (deleted: Deleted) => void }) {
  const [, navigate] = useLocation();
  const { data: note } = useNote(path);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linking = note ? new Set(note.backlinks.map((b) => b.path)).size : 0;
  const discardOk = useDiscardOk();

  const remove = async () => {
    if (!note || !discardOk()) return;
    setBusy(true);
    setError(null);
    try {
      const { trashId } = await api.remove(note.path, note.hash);
      onClose();
      navigate("/");
      onDeleted({ trashId, title: note.title });
    } catch (err) {
      setError(isConflict(err) ? "The note changed on disk. Look at the new version before deleting it." : message(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Delete note"
      onClose={onClose}
      onSubmit={() => void remove()}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !note} autoFocus>
            {busy && <Spinner />} Delete
          </Button>
        </>
      }
    >
      {!note ? (
        <Spinner className="text-ink-faint" />
      ) : (
        <>
          <p className="text-[13.5px] text-ink">
            Delete <span className="font-semibold">{note.title}</span> <span className="font-mono text-[12px] text-ink-faint">{note.path}</span>?
          </p>
          <p className="text-[13px] text-ink-soft">
            {linking === 0 ? "No other notes link to it." : `${plural(linking, "note links", "notes link")} to it, and those links will stop working.`} You can undo this right after.
          </p>
          {note.generated && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/12 px-2.5 py-2 text-[12.5px] text-amber-800 dark:text-amber-300">
              <TriangleAlert size={14} className="mt-px shrink-0" />
              This note has generated: true, so the tool that writes it may create it again.
            </p>
          )}
        </>
      )}
      <ErrorLine error={error} />
    </Dialog>
  );
}

const UNDO_MS = 8000;

function UndoDelete({ deleted, onDone }: { deleted: Deleted; onDone: () => void }) {
  const [, navigate] = useLocation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const discardOk = useDiscardOk();

  useEffect(() => {
    const timer = setTimeout(onDone, UNDO_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  const undo = async () => {
    if (!discardOk()) return;
    setBusy(true);
    try {
      const { path } = await api.restore(deleted.trashId);
      navigate(noteHref(path));
      toast("Note restored", "success");
    } catch (err) {
      toast(`${message(err)}. The deleted copy is still in .brainview-trash/${deleted.trashId}.`, "error");
    }
    onDone();
  };

  return (
    <div className="animate-in fixed bottom-16 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-raised py-1.5 pl-3.5 pr-1.5 text-[13px] text-ink shadow-lg shadow-black/10">
      <span className="max-w-[320px] truncate">Deleted “{deleted.title}”</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void undo()}>
        {busy ? <Spinner /> : <Undo2 size={13} />} Undo
      </Button>
    </div>
  );
}
