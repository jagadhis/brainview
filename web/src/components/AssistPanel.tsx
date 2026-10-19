import { diffWords } from "diff";
import { Check, CornerDownLeft, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiUsage, AssistAction } from "../../../src/shared/types.ts";
import { streamEvents } from "../lib/api.ts";
import { Button, clsx, Spinner } from "./ui.tsx";

export const ASSIST_ACTIONS: { id: Exclude<AssistAction, "custom">; label: string }[] = [
  { id: "improve", label: "Improve" },
  { id: "shorten", label: "Shorten" },
  { id: "fix", label: "Fix" },
  { id: "summarize", label: "Summarize" },
  { id: "continue", label: "Continue" },
  { id: "expand", label: "Expand" },
];

/** Token counts for one AI call. Input includes the tokens read from or written to the prompt cache. */
export function UsageLine({ usage, className }: { usage: AiUsage; className?: string }) {
  const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return (
    <div className={clsx("text-[11px] tabular-nums text-ink-faint", className)}>
      {input.toLocaleString()} input · {usage.outputTokens.toLocaleString()} output tokens
      {usage.cacheReadTokens > 0 && ` · ${usage.cacheReadTokens.toLocaleString()} cached`}
    </div>
  );
}

interface Props {
  path: string;
  doc: string;
  action: AssistAction;
  selection: { from: number; to: number; text: string };
  onAccept: (replacement: string) => void;
  onClose: () => void;
}

export function AssistPanel({ path, doc, action, selection, onAccept, onClose }: Props) {
  const [instruction, setInstruction] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done" | "error">(action === "custom" ? "idle" : "streaming");
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const abort = useRef<AbortController | null>(null);
  const docRef = useRef(doc);

  const run = useCallback(
    async (custom: string | null) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setOutput("");
      setError(null);
      setUsage(null);
      setStatus("streaming");
      try {
        const events = streamEvents(
          "/api/ai/assist",
          { path, action, instruction: custom, selection: selection.text, before: docRef.current.slice(0, selection.from), after: docRef.current.slice(selection.to) },
          controller.signal,
        );
        for await (const event of events) {
          if (event.type === "text") setOutput((o) => o + event.text);
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "done" && event.stopReason === "refusal") throw new Error("Claude declined this request.");
          if (event.type === "done" && event.usage) setUsage(event.usage);
        }
        setStatus("done");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [action, path, selection],
  );

  useEffect(() => {
    if (action !== "custom") void run(null);
    return () => abort.current?.abort();
  }, [action, run]);

  const label = action === "custom" ? "Ask Claude to edit" : (ASSIST_ACTIONS.find((a) => a.id === action)?.label ?? action);
  const result = output.replace(/^\n+/, "");

  return (
    <div className="animate-in absolute inset-x-3 bottom-3 z-30 flex max-h-[60%] flex-col overflow-hidden rounded-xl border border-accent/30 bg-raised shadow-2xl shadow-black/15">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Sparkles size={14} className="text-accent" />
        <span className="text-[12.5px] font-semibold text-ink">{label}</span>
        <span className="text-[11.5px] text-ink-faint">{selection.text.length.toLocaleString()} characters selected</span>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-ink-faint hover:bg-sunken hover:text-ink">
          <X size={14} />
        </button>
      </div>

      {action === "custom" && (
        <form
          className="flex items-center gap-2 border-b border-line px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (instruction.trim()) void run(instruction.trim());
          }}
        >
          <input
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. turn this into a table, make it friendlier, translate to Spanish"
            className="h-8 flex-1 rounded-md border border-line bg-canvas px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent/40"
          />
          <Button size="sm" variant="primary" type="submit" disabled={!instruction.trim() || status === "streaming"}>
            <CornerDownLeft size={13} /> Run
          </Button>
        </form>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">
        {status === "error" && <div className="font-sans text-[12.5px] text-red-600 dark:text-red-400">{error}</div>}
        {status === "streaming" && !result && (
          <div className="flex items-center gap-2 font-sans text-[12.5px] text-ink-soft">
            <Spinner className="text-accent" /> Writing…
          </div>
        )}
        {status === "streaming" && result && <pre className="caret whitespace-pre-wrap text-ink">{result}</pre>}
        {status === "done" && <Diff before={selection.text} after={result} />}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
        {status === "done" && usage && <UsageLine usage={usage} className="mr-auto" />}
        {status === "streaming" ? (
          <Button size="sm" variant="ghost" onClick={() => (abort.current?.abort(), setStatus(result ? "done" : "idle"))}>
            <Square size={11} /> Stop
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => void run(action === "custom" ? instruction.trim() || null : null)} disabled={action === "custom" && !instruction.trim()}>
            <RotateCcw size={12} /> Retry
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onClose}>
          Discard
        </Button>
        <Button size="sm" variant="primary" disabled={status !== "done" || !result} onClick={() => onAccept(result)}>
          <Check size={13} /> Replace selection
        </Button>
      </div>
    </div>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <pre className="whitespace-pre-wrap text-ink">
      {parts.map((part, i) => (
        <span
          key={i}
          className={clsx(part.added && "rounded-sm bg-emerald-500/15 text-emerald-800 dark:text-emerald-300", part.removed && "rounded-sm bg-red-500/12 text-red-700/80 line-through dark:text-red-300/80")}
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}
