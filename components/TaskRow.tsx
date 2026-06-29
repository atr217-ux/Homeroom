"use client";

import { useEffect, useRef, useState } from "react";
import { buildColoredHTML, tagColor } from "@/lib/utils/tags";
import type { Tag } from "@/lib/db/types";

type Props = {
  id: string;
  text: string;
  done: boolean;
  isPrivate: boolean;
  tags: Tag[];
  onToggle: () => void;
  onSave: (newText: string) => void;
  onDelete: () => void;
  onTogglePrivate: () => void;
};

export default function TaskRow({ id, text, done, isPrivate, tags, onToggle, onSave, onDelete, onTogglePrivate }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.innerHTML = buildColoredHTML(draft);
      // place cursor at end
      const range = document.createRange();
      range.selectNodeContents(editRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      editRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function commitEdit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== text) onSave(next);
    else setDraft(text);
  }

  return (
    <div
      className="group flex items-start gap-3 px-3 py-3 rounded-xl transition-colors"
      style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors mt-0.5"
        style={done
          ? { background: "var(--purple)", border: "2px solid var(--purple)" }
          : { border: "2px solid var(--border-3)" }}
        aria-label={done ? "Mark as not done" : "Mark as done"}
      >
        {done && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      {/* Text or inline editor */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div
            ref={editRef}
            contentEditable
            suppressContentEditableWarning
            className="text-sm focus:outline-none border-b"
            style={{ color: "var(--text)", borderColor: "var(--purple)", minHeight: 22 }}
            onInput={(e) => setDraft((e.target as HTMLDivElement).innerText.replace(/\n/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") { e.preventDefault(); setDraft(text); setEditing(false); }
            }}
            onBlur={commitEdit}
            onPaste={(e) => {
              e.preventDefault();
              const txt = e.clipboardData.getData("text/plain").replace(/\n/g, " ");
              document.execCommand("insertText", false, txt); // eslint-disable-line
            }}
          />
        ) : (
          <span
            className="text-sm leading-snug"
            style={{
              color: done ? "var(--text-2)" : "var(--text)",
              textDecoration: done ? "line-through" : "none",
              opacity: done ? 0.6 : 1,
            }}
          >
            {text}
          </span>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {tags.map((tag) => {
              const { bg, fg } = tagColor(tag.name);
              return (
                <span
                  key={tag.id}
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: bg, color: fg }}
                >
                  #{tag.name}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Right-side icons */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {/* Privacy toggle — always visible */}
        <button
          onClick={onTogglePrivate}
          className="p-1 rounded transition-opacity hover:opacity-70"
          style={{ color: isPrivate ? "var(--purple)" : "var(--text-3)" }}
          title={isPrivate ? "Private — only you can see this" : "Public — friends can see when completed"}
          aria-label={isPrivate ? "Make public" : "Make private"}
        >
          {isPrivate ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
          )}
        </button>

        {/* Edit + delete — visible on hover */}
        {!done && !editing && (
          <button
            onClick={() => { setDraft(text); setEditing(true); }}
            className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-70"
            style={{ color: "var(--text-2)" }}
            title="Edit"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-70"
          style={{ color: "var(--text-2)" }}
          title="Delete"
          aria-label={`Delete task ${id}`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
