"use client";

import { useTheme } from "@/lib/theme";
import { THEME_MODE_DESCRIPTIONS, THEME_MODE_LABELS, THEME_MODES } from "@/lib/tokens";
import { cn } from "@/lib/cn";

import { HealthPanel } from "@/components/system/HealthPanel";
import { PageHeader, Panel, SectionHead } from "@/components/ui/primitives";

type Counts = {
  questionCount: number | null;
  practiceCount: number | null;
  heldOutCount: number | null;
};

/**
 * Settings: appearance (real, wired to the theme engine), backend diagnostics
 * (real E1 probe) and the about panel. Counts come from E2 when the backend is
 * reachable and are stated honestly as unavailable when it is not.
 */
export function SettingsView({ counts }: { counts: Counts }) {
  const { mode, resolved, setMode, ready } = useTheme();

  const unknown = <span className="text-muted">unavailable</span>;

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Appearance and workspace"
        description="The theme choice is kept in the page address, so ?theme=dark restores it on a later visit."
      />

      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-5" aria-labelledby="appearance-heading">
          <SectionHead>Appearance</SectionHead>

          <Panel className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-col gap-1">
              <h2 id="appearance-heading" className="text-sm font-semibold">
                Theme
              </h2>
              <p className="text-sm leading-relaxed text-muted">
                Theme:{" "}
                <span className="font-medium text-ink">
                  {ready ? THEME_MODE_LABELS[mode] : "…"}
                </span>
                .{" "}
                {ready
                  ? `Currently painting the ${resolved} theme.`
                  : "Reading your device preference."}
              </p>
            </div>

            <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-2">
              {THEME_MODES.map((option) => {
                const active = ready && mode === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(option)}
                    data-testid={`theme-${option}`}
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ctl border px-4 py-3 text-left transition-colors",
                      active
                        ? "border-accent bg-accent-soft"
                        : "border-line hover:border-accent",
                    )}
                  >
                    <span className="text-sm font-medium text-ink">
                      {THEME_MODE_LABELS[option]}
                    </span>
                    <span className="text-sm text-muted">
                      {THEME_MODE_DESCRIPTIONS[option]}
                    </span>
                    {active ? (
                      <span className="eyebrow ml-auto rounded-full border border-accent px-2 py-0.5 text-accent">
                        Current
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Panel>
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="diagnostics-heading">
          <SectionHead>Diagnostics</SectionHead>
          <Panel className="p-5 sm:p-6">
            <HealthPanel />
            <h2 id="diagnostics-heading" className="sr-only">
              Backend diagnostics
            </h2>
          </Panel>
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="about-heading">
          <SectionHead>About this workspace</SectionHead>
          <Panel className="flex flex-col gap-3 p-5 sm:p-6">
            <h2 id="about-heading" className="text-sm font-semibold">
              Learning OS
            </h2>
            <p className="max-w-3xl text-sm leading-relaxed text-muted">
              {counts.questionCount ?? unknown} SQL questions —{" "}
              {counts.practiceCount ?? unknown} practice and {counts.heldOutCount ?? unknown}{" "}
              held out for the removal test. Every submission is executed and compared against
              reference results by Python on Supabase PostgreSQL; the language model only
              writes the explanations. Correctness, hint levels and answer disclosure are
              never decided by the model.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              Progress is session-only by design, and this frontend is being built alongside
              the working Streamlit application, which remains the fallback until this one
              passes acceptance testing.
            </p>
          </Panel>
        </section>
      </div>
    </>
  );
}