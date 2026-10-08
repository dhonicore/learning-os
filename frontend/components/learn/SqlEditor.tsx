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

  const handleEditorDidMount = (
    editor: monacoTypes.editor.IStandaloneCodeEditor,
    monaco: typeof monacoTypes,
  ) => {
    // Define both palettes up front so a later theme switch does not need to
    // re-define anything; then apply the theme that is current at mount time.
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

    const currentTheme = resolvedRef.current === "dark" ? "learning-dark" : "learning-light";
    monaco.editor.setTheme(currentTheme);

    setMounted(true);
    onMount?.(editor);
  };

  return (
    <div className={cn("rounded-ctl border border-line bg-code p-3", disabled && "opacity-50 cursor-not-allowed")} data-testid="sql-editor" data-monaco-ready={mounted ? "true" : "false"}>
      <p className="font-mono text-xs text-muted">SQL editor</p>
      {!mounted && (
        <div className="h-84 flex items-center justify-center text-muted text-sm">
          Loading editor…
        </div>
      )}
      <MonacoEditor
        value={value}
        onChange={(val, editor) => {
          if (editor == null) return;
          onChange(val ?? "");
        }}
        onMount={handleEditorDidMount}
        language="sql"
        theme={monacoTheme}
        width="100%"
        height={340}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          wordWrap: "on",
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
        }}
      />
    </div>
  );
}
