"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { HealthDot } from "@/components/system/HealthPanel";
import { ThemeControl } from "@/components/system/ThemeControl";
import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { href: "/", label: "Learn", hint: "Practice the questions" },
  { href: "/progress", label: "Progress", hint: "This session's activity" },
  { href: "/settings", label: "Settings", hint: "Appearance and about" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Application shell: a fixed sidebar on large screens, a daisyUI drawer on
 * small ones. The sidebar also carries the brand, so the product reads as one
 * surface instead of a page with a header bolted on.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = NAV_ITEMS.find((item) => isActive(pathname, item.href))?.label ?? "Learning OS";

  return (
    <div className="drawer lg:drawer-open">
      <input id="app-drawer" type="checkbox" className="drawer-toggle" />

      <div className="drawer-content flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <label
            htmlFor="app-drawer"
            aria-label="Open navigation"
            className="btn btn-ghost btn-square btn-sm lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </label>

          <p className="eyebrow hidden sm:block">{section}</p>

          <div className="ml-auto flex items-center gap-2">
            <HealthDot />
            <ThemeControl />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          {children}
        </main>
      </div>

      <div className="drawer-side z-30">
        <label htmlFor="app-drawer" aria-label="Close navigation" className="drawer-overlay" />
        <aside className="flex min-h-full w-72 flex-col gap-8 border-r border-line bg-surface px-6 py-7">
          <Link href="/" className="flex flex-col gap-1">
            <span className="text-[1.0625rem] font-semibold tracking-tight">Learning OS</span>
            <span className="eyebrow">SQL practice tutor</span>
          </Link>

          <nav aria-label="Primary" className="flex flex-col">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex flex-col gap-0.5 rounded-r-md border-l-2 py-2.5 pl-4 pr-3 transition-colors",
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-transparent text-muted hover:bg-raised hover:text-ink",
                  )}
                >
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-muted">{item.hint}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex flex-col gap-2 border-t border-line pt-5">
            <p className="text-xs leading-relaxed text-muted">
              Python decides correctness and hint levels. The model only explains.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}