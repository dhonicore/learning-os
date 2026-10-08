"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";
import MonacoEditor from "@monaco-editor/react";
import * as monacoTypes from "monaco-editor";
import { fullPalette, monacoColors } from "@/lib/tokens";

export interface SqlEditorProps {
  value: string;
  onChange: (sql: string) => void;
  disabled?: boolean;
  /** Called when the editor is ready (mounted). */
  onMount?: (editor: monacoTypes.editor.IStandaloneCodeEditor) => void;
}

const PLACEHOLDER = "Write your query to answer the question above.";

export function SqlEditor({ value, onChange, disabled = false, onMount }: SqlEditorProps) {
  const theme = useTheme();
  const resolved = theme.resolved;
  const monacoTheme = resolved === "dark" ? "learning-dark" : "learning-light";
  const resolvedRef = useRef(resolved);
  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const monaco = (typeof window !== "undefined" ? (window as Window & { monaco?: typeof monacoTypes }).monaco : undefined);
    if (monaco) {
      monaco.editor.setTheme(monacoTheme);
    }
  }, [monacoTheme]);

  const handleEditorWillMount = (monaco: typeof monacoTypes) => {
    const lightColors = monacoColors(fullPalette("light"));
    const darkColors = monacoColors(fullPalette("dark"));

    monaco.editor.defineTheme("learning-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: lightColors,
    });
    monaco.editor.defineTheme("learning-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: darkColors,
    });
  };

  const handleEditorDidMount = (
    editor: monacoTypes.editor.IStandaloneCodeEditor,
    monaco: typeof monacoTypes,
  ) => {
    const currentTheme = resolvedRef.current === "dark" ? "learning-dark" : "learning-light";
    monaco.editor.setTheme(currentTheme);

    setMounted(true);
    onMount?.(editor);
  };

  return (
    <div
      className={cn(
        "relative rounded-ctl border border-line-strong bg-code",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      data-testid="sql-editor"
      data-monaco-ready={mounted ? "true" : "false"}
    >
      <div className="p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-mono text-xs text-muted">Your query</p>
          <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted">
            SQL
          </span>
        </div>
        <div className="h-[220px] sm:h-[260px] lg:h-[280px]">
          <MonacoEditor
            value={value}
            onChange={(val, editor) => {
              if (editor == null) return;
              onChange(val ?? "");
            }}
            beforeMount={handleEditorWillMount}
            onMount={handleEditorDidMount}
            language="sql"
            theme={monacoTheme}
            width="100%"
            height="100%"
            loading={
              <div className="flex h-full w-full items-center justify-center text-xs text-muted">
                Loading editor…
              </div>
            }
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              wordWrap: "on",
              renderLineHighlight: "line",
              cursorBlinking: "smooth",
              ariaLabel: "SQL editor",
              placeholder: PLACEHOLDER,
            }}
          />
        </div>
      </div>
    </div>
  );
}
