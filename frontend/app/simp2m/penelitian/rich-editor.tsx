"use client";

import { Bold, Eraser, Italic, List, ListOrdered, Underline } from "lucide-react";
import { useEffect, useRef } from "react";

export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

export function countWordsFromHtml(html: string): number {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function sanitizeClientHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "");
}

export function RichTextEditor({
  id,
  label,
  value,
  disabled,
  limit,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  limit?: number;
  onChange: (next: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastExternal = useRef<string>(value);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value !== lastExternal.current && el.innerHTML !== value) {
      el.innerHTML = sanitizeClientHtml(value);
      lastExternal.current = value;
    }
  }, [value]);

  useEffect(() => {
    const el = editorRef.current;
    if (el && el.innerHTML === "" && value) {
      el.innerHTML = sanitizeClientHtml(value);
      lastExternal.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(command: string) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false);
    const html = sanitizeClientHtml(editorRef.current?.innerHTML ?? "");
    lastExternal.current = html;
    onChange(html);
  }

  function handleInput() {
    const html = sanitizeClientHtml(editorRef.current?.innerHTML ?? "");
    lastExternal.current = html;
    onChange(html);
  }

  const count = countWordsFromHtml(value);

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="overflow-hidden rounded-md border border-input bg-background">
        {!disabled && (
          <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/40 px-2 py-1" role="toolbar" aria-label={`Pemformatan ${label}`}>
            <button type="button" onClick={() => exec("bold")} title="Tebal (Bold)" aria-label="Tebal"
              className="rounded p-1.5 text-xs hover:bg-muted">
              <Bold size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => exec("italic")} title="Miring (Italic)" aria-label="Miring"
              className="rounded p-1.5 text-xs hover:bg-muted">
              <Italic size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => exec("underline")} title="Garis bawah" aria-label="Garis bawah"
              className="rounded p-1.5 text-xs hover:bg-muted">
              <Underline size={14} aria-hidden="true" />
            </button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <button type="button" onClick={() => exec("insertUnorderedList")} title="Daftar poin" aria-label="Daftar poin"
              className="rounded p-1.5 text-xs hover:bg-muted">
              <List size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => exec("insertOrderedList")} title="Daftar bernomor" aria-label="Daftar bernomor"
              className="rounded p-1.5 text-xs hover:bg-muted">
              <ListOrdered size={14} aria-hidden="true" />
            </button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <button type="button" onClick={() => exec("removeFormat")} title="Bersihkan format" aria-label="Bersihkan format"
              className="rounded p-1.5 text-xs hover:bg-muted">
              <Eraser size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        <div
          id={id}
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          className={`min-h-[120px] max-h-[360px] overflow-y-auto p-2.5 text-sm outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 ${
            disabled ? "bg-muted/30 text-muted-foreground cursor-default" : "focus:ring-1 focus:ring-ring"
          }`}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={limit && count > limit ? "text-destructive font-medium" : "text-muted-foreground"}>
          {limit ? `${count} dari ${limit} kata` : `${count} kata`}
        </span>
      </div>
    </div>
  );
}

