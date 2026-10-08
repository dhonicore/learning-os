"use client";

import { useState } from "react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";
import MonacoEditor from "@monaco-editor/react";
import * as monaco from "monaco-editor";

export interface SqlEditorProps {
  value: string;
  onChange: (sql: string) => void;
  disabled?: boolean;
  /** Called when the editor is ready (mounted). */
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

export function SqlEditor({ value, onChange, disabled = false, onMount }: SqlEditorProps) {
  const theme = useTheme();
  // Slice C: `mode` is the user's preference setting (system/light/dark);
  // `resolved` is the theme actually painted. Keying Monaco off `mode` left
  // the editor white whenever the device was dark and the mode was System.
  const monacoTheme = theme.resolved === "dark" ? "vs-dark" : "light";
  const [mounted, setMounted] = useState(false);

  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
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