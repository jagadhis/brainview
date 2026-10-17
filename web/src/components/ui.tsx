import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { toneFor, useFolderColor, type Tone } from "../lib/colors.ts";

export { clsx };

const TONES: Record<Tone, string> = {
  green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25",
  amber: "bg-amber-500/14 text-amber-800 dark:text-amber-300 ring-amber-500/30",
  red: "bg-red-500/12 text-red-700 dark:text-red-300 ring-red-500/25",
  blue: "bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-500/25",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300 ring-violet-500/25",
  gray: "bg-ink/[0.06] text-ink-soft ring-ink/10",
};

export function StatusBadge({ value, className }: { value: string; className?: string }) {
  const tone = toneFor(value);
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset whitespace-nowrap", TONES[tone], className)}>
      <span className={clsx("size-1.5 rounded-full", tone === "gray" ? "bg-ink-faint" : "bg-current")} />
      {value}
    </span>
  );
}

export function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex max-w-full items-center rounded-md border border-line bg-sunken px-1.5 py-0.5 text-[12px] text-ink-soft", className)}>
      <span className="truncate">{children}</span>
    </span>
  );
}

export function FolderDot({ folder, className }: { folder: string; className?: string }) {
  const colorFor = useFolderColor();
  return <span className={clsx("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: colorFor(folder) }} />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; size?: "sm" | "md" };

export function Button({ variant = "outline", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-accent text-white shadow-sm shadow-accent/30 hover:brightness-110",
        variant === "outline" && "border border-line-strong bg-surface text-ink hover:bg-sunken",
        variant === "ghost" && "text-ink-soft hover:bg-sunken hover:text-ink",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
        className,
      )}
    />
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-xl border border-line bg-surface", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function SectionTitle({ children, count, action }: { children: ReactNode; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {children}
        {count !== undefined && <span className="ml-1.5 rounded bg-sunken px-1 font-mono text-[10.5px] text-ink-faint">{count}</span>}
      </h4>
      {action}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="text-ink-faint">{icon}</div>}
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {children && <div className="max-w-sm text-[13px] text-ink-soft">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
