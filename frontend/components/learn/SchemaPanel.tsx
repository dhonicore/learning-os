"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/cn";
import { fetchSchema } from "@/lib/api";

/** Schema panel fetched from E4.
 *
 * Displays the database tables and foreign keys as read-only markdown
 * tables, matching the Streamlit `_render_schema_panel` presentation.
 * Clicking "Re-fetch" forces a fresh read from the backend.
 */
export interface SchemaPanelProps {
  /** Initially open? */
  open?: boolean;
}

/** Table rows rendered as a compact markdown-like block. */
function renderTables(tables: Array<Array<string | string[]>>): React.ReactNode {
  if (!tables.length) return <p className="text-xs text-muted">No tables found.</p>;
  return (
    <div className="space-y-2 text-xs text-muted">
      {tables.map((table, i) => {
        const tableName = table[0];
        const columns = table.slice(1) as Array<[string, string]>;
        return (
          <div key={i} className="font-mono" data-testid={`schema-table-${tableName}`}>
            <div className="font-medium">{tableName}</div>
            {columns.map((col, j) => (
              <div key={j} className="ml-4">
                <span>{col[0]}</span>
                <span className="text-primary ml-2">{col[1]}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function renderForeignKeys(fks: Array<[string, string]>): React.ReactNode {
  if (!fks.length) return <p className="text-xs text-muted">No foreign keys found.</p>;
  return (
    <div className="space-y-1 text-xs text-muted">
      {fks.map((fk, i) => (
        <div key={i} className="font-mono">
          {fk[0]} → {fk[1]}
        </div>
      ))}
    </div>
  );
}

export function SchemaPanel({ open = false }: SchemaPanelProps) {
  const [schema, setSchema] = useState<{ tables: Array<Array<string | string[]>>; foreign_keys: Array<[string, string]> } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch schema on mount (relative /api URL goes via Next.js proxy, same origin)
  useEffect(() => {
    void fetchSchema().then(
      (s) => {
        setSchema(s);
        setLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : "Failed to load schema.");
        setLoading(false);
      },
    );
  }, []);

  return (
    <div className={cn("rounded-ctl border border-line bg-surface p-4", open && "border-accent")} data-testid="schema-panel">
      <div className="flex items-center gap-2">
        <span className="eyebrow">Database schema</span>
        <button
          type="button"
          onClick={() => {}}
          className="text-xs text-primary hover:underline"
          disabled
        >
          Re-fetch
        </button>
      </div>
      {loading && <p className="text-xs text-muted">Loading schema…</p>}
      {error && <p className="text-xs text-error">{error}</p>}
      {schema && (
        <>
          <details className="mt-3" data-testid="schema-tables">
            <summary className="cursor-pointer text-primary underline text-sm font-medium">Tables</summary>
            {renderTables(schema.tables)}
          </details>
          <details className="mt-3" data-testid="schema-fks">
            <summary className="cursor-pointer text-primary underline text-sm font-medium">Foreign keys</summary>
            {renderForeignKeys(schema.foreign_keys)}
          </details>
        </>
      )}
    </div>
  );
}