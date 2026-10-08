"use client";

import { useState, useEffect } from "react";
import { fetchSchema } from "@/lib/api";

/** Schema reference panel.
 *
 * Supporting information, not a dashboard card. Tables and foreign keys are
 * presented as a quiet, scannable reference.
 */
export interface SchemaPanelProps {
  /** Initially open? Desktop defaults to open; mobile to closed. */
  open?: boolean;
}

function renderTables(tables: Array<Array<string | string[]>>): React.ReactNode {
  if (!tables.length) return <p className="text-xs text-muted">No tables found.</p>;
  return (
    <div className="flex flex-col gap-4 text-sm">
      {tables.map((table, i) => {
        const tableName = table[0] as string;
        const columns = (table[1] ?? []) as unknown as Array<[string, string]>;
        return (
          <div key={i} className="font-mono" data-testid={`schema-table-${tableName}`}>
            <div className="text-sm font-medium text-ink">{tableName}</div>
            <div className="mt-1.5 flex flex-col gap-0.5">
              {columns.map((col, j) => (
                <div key={j} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 text-xs">
                  <span className="text-ink">{col[0]}</span>
                  <span className="text-muted">{col[1]}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderForeignKeys(fks: Array<[string, string]>): React.ReactNode {
  if (!fks.length) return <p className="text-xs text-muted">No foreign keys found.</p>;
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted">
      {fks.map((fk, i) => (
        <div key={i} className="font-mono">
          {fk[0]} → {fk[1]}
        </div>
      ))}
    </div>
  );
}

export function SchemaPanel({ open = false }: SchemaPanelProps) {
  const [tablesOpen, setTablesOpen] = useState(false);
  const [foreignKeysOpen, setForeignKeysOpen] = useState(false);
  const [schema, setSchema] = useState<{ tables: Array<Array<string | string[]>>; foreign_keys: Array<[string, string]> } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    const syncDisclosure = () => {
      setTablesOpen(open && desktop.matches);
      setForeignKeysOpen(open && desktop.matches);
    };
    syncDisclosure();
    desktop.addEventListener("change", syncDisclosure);
    return () => desktop.removeEventListener("change", syncDisclosure);
  }, [open]);

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
    <div data-testid="schema-panel" className="flex flex-col gap-3">
      <p className="eyebrow">Reference</p>

      {loading && <p className="text-xs text-muted">Loading schema…</p>}
      {error && <p className="text-xs text-error">{error}</p>}

      {schema && (
        <div className="flex flex-col gap-4">
          <details
            className="group"
            open={tablesOpen}
            onToggle={(event) => setTablesOpen(event.currentTarget.open)}
            data-testid="schema-tables"
          >
            <summary className="cursor-pointer text-sm font-medium text-ink hover:text-accent">
              Tables
            </summary>
            <div className="mt-3 pl-0.5">{renderTables(schema.tables)}</div>
          </details>
          <details
            className="group"
            open={foreignKeysOpen}
            onToggle={(event) => setForeignKeysOpen(event.currentTarget.open)}
            data-testid="schema-fks"
          >
            <summary className="cursor-pointer text-sm font-medium text-ink hover:text-accent">
              Foreign keys
            </summary>
            <div className="mt-3 pl-0.5">{renderForeignKeys(schema.foreign_keys)}</div>
          </details>
        </div>
      )}
    </div>
  );
}
