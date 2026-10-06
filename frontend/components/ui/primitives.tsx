import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Small uppercase label that introduces a group without adding a border. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("eyebrow", className)}>{children}</p>;
}

/**
 * Section heading. The hairline is intentional and quiet: it separates
 * sections without turning the page into a stack of boxes.
 */
export function SectionHead({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <h2 className="eyebrow whitespace-nowrap">{children}</h2>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}

/** Bordered surface. Used only where content is genuinely grouped. */
export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={cn("rounded-card border border-line bg-surface", className)}>{children}</Tag>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 pb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
      <div className="flex flex-col gap-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="text-[1.75rem] leading-tight sm:text-[2rem]">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Placeholder for work that belongs to a later phase. It states plainly that
 * the surface is not built yet rather than pretending to be interactive.
 */
export function PendingNote({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-muted">
      <span className="font-medium text-ink">{phase}</span> · {children}
    </p>
  );
}