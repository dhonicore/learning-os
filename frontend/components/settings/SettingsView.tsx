"use client";

import { useTheme } from "@/lib/theme";
import { THEME_MODE_DESCRIPTIONS, THEME_MODE_LABELS, THEME_MODES } from "@/lib/tokens";
import { cn } from "@/lib/cn";

import { PageHeader, Panel, SectionHead } from "@/components/ui/primitives";

type Counts = {
  questionCount: number | null;
  practiceCount: number | null;
  heldOutCount: number | null;
};

/**
 * Settings: appearance only. Backend/infrastructure diagnostics are not
 * exposed in the learner-facing product.
 */
export function SettingsView({ counts }: { counts: Counts }) {
  const { mode, resolved, setMode, ready } = useTheme();

  const unknown = <span className="text-muted">unavailable</span>;

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Appearance and workspace"
        description="Choose the theme that works best for your environment."
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

        <section className="flex flex-col gap-5" aria-labelledby="about-heading">
          <SectionHead>About this workspace</SectionHead>
          <Panel className="flex flex-col gap-3 p-5 sm:p-6">
            <h2 id="about-heading" className="text-sm font-semibold">
              Learning OS
            </h2>
            <p className="max-w-3xl text-sm leading-relaxed text-muted">
              {counts.questionCount ?? unknown} SQL questions —{" "}
              {counts.practiceCount ?? unknown} practice and {counts.heldOutCount ?? unknown}{" "}
              held out. Every submission is executed and compared against reference results by
              Python; the language model only writes explanations.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              Progress is session-only by design.
            </p>
          </Panel>
        </section>
      </div>
    </>
  );
}
