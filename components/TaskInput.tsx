"use client";

import { useEffect, useRef, useState } from "react";
import { buildColoredHTML, tagColor } from "@/lib/utils/tags";
import type { Tag } from "@/lib/db/types";

function moveCursorToEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  allTags: Tag[];
};

export default function TaskInput({ value, onChange, onSubmit, placeholder = "Add a task… (try #category)", allTags }: Props) {
  const inputRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Re-render the colored HTML when value changes from outside (e.g., after submit clears it)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (el.innerText !== value) {
      el.innerHTML = buildColoredHTML(value);
      if (focused) moveCursorToEnd(el);
    }
  }, [value, focused]);

  // Detect an in-progress #tagname at the cursor for autocomplete
  const hashMatch = value.match(/#(\w*)$/);
  const tagQuery = hashMatch ? hashMatch[1].toLowerCase() : null;
  const completions = tagQuery !== null
    ? allTags.filter(t => t.name.toLowerCase().startsWith(tagQuery)).slice(0, 6)
    : [];
  const showDropdown = focused && completions.length > 0 && tagQuery !== null;

  function applyCompletion(name: string) {
    const next = value.replace(/#\w*$/, `#${name} `);
    onChange(next);
    const el = inputRef.current;
    if (el) {
      el.innerHTML = buildColoredHTML(next);
      moveCursorToEnd(el);
      el.focus();
    }
  }

  return (
    <div className="relative">
      <div
        className="rounded-xl transition-colors"
        style={{
          background: "var(--surface)",
          border: `2px solid ${value ? "var(--purple)" : "rgba(124,58,237,0.3)"}`,
        }}
      >
        <div className="relative">
          {!value && (
            <span
              className="absolute inset-0 flex items-center px-3 text-sm pointer-events-none font-medium"
              style={{ color: "var(--purple)", opacity: 0.5 }}
            >
              {placeholder}
            </span>
          )}
          <div
            ref={inputRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            className="w-full px-3 py-3 focus:outline-none"
            style={{ color: "var(--text)", fontSize: "16px", minHeight: 44 }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onInput={() => {
              const el = inputRef.current;
              if (!el) return;
              const text = el.innerText.replace(/\n/g, "");
              onChange(text);
              // Re-color in place while preserving caret
              const sel = window.getSelection();
              if (!sel?.rangeCount) return;
              const range = sel.getRangeAt(0).cloneRange();
              range.selectNodeContents(el);
              range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
              const offset = range.toString().length;
              el.innerHTML = buildColoredHTML(text);
              // Restore caret
              const r = document.createRange();
              let rem = offset;
              function walk(node: Node): boolean {
                if (node.nodeType === Node.TEXT_NODE) {
                  const len = node.textContent?.length ?? 0;
                  if (rem <= len) { r.setStart(node, rem); r.setEnd(node, rem); return true; }
                  rem -= len;
                } else {
                  for (const c of Array.from(node.childNodes)) if (walk(c)) return true;
                }
                return false;
              }
              if (!walk(el)) { r.selectNodeContents(el); r.collapse(false); }
              sel.removeAllRanges();
              sel.addRange(r);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (showDropdown && completions[0]) {
                  applyCompletion(completions[0].name);
                } else {
                  onSubmit();
                }
              }
              if (e.key === "Tab" && showDropdown && completions[0]) {
                e.preventDefault();
                applyCompletion(completions[0].name);
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              const txt = e.clipboardData.getData("text/plain").replace(/\n/g, " ");
              document.execCommand("insertText", false, txt); // eslint-disable-line
            }}
          />
        </div>
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full mt-1 z-30 border rounded-xl shadow-lg overflow-hidden"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          {completions.map((tag) => {
            const { bg, fg } = tagColor(tag.name);
            return (
              <button
                key={tag.id}
                onMouseDown={(e) => { e.preventDefault(); applyCompletion(tag.name); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:opacity-80"
                style={{ background: "var(--surface)" }}
              >
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: bg, color: fg }}
                >
                  #{tag.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
