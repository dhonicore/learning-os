export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div className="h-4 w-24 rounded bg-raised" />
      <div className="h-9 w-72 max-w-full rounded bg-raised" />
      <div className="h-64 rounded-card border border-line bg-surface" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
