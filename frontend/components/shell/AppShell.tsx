"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeControl } from "@/components/system/ThemeControl";
import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { href: "/", label: "Learn" },
  { href: "/progress", label: "Progress" },
  { href: "/settings", label: "Settings" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Slim top navigation. No persistent sidebar, no infrastructure indicators. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 py-3">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-y-2 px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <Link href="/" className="whitespace-nowrap leading-none">
              <span className="text-[1.0625rem] font-semibold tracking-tight">Learning OS</span>
            </Link>

            <nav aria-label="Primary" className="flex items-center gap-0.5 sm:gap-1">
              {NAV_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-ctl px-2 py-1.5 text-sm font-medium transition-colors sm:px-3",
                      active
                        ? "text-ink"
                        : "text-muted hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="ml-auto flex basis-full justify-end sm:basis-auto">
            <ThemeControl />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {children}
      </main>
    </div>
  );
}
