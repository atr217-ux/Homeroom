"use client";

import { useEffect, useRef, useState } from "react";
import { buildColoredHTML } from "@/lib/utils/tags";
import { useHasHover } from "@/lib/hooks/useHasHover";
import SwipeableRow, { SwipeIcons, SwipeColors } from "@/components/SwipeableRow";
import TagChip from "@/components/TagChip";
import type { Tag } from "@/lib/db/types";

type Props = {
  text: string;
  done: boolean;
  isPrivate: boolean;
  tags: Tag[];
  onToggle: () => void;
  onSave: (newText: string) => void;
  onDelete: () => void;
  onTogglePrivate: () => void;
  onRemoveTag: (tagId: string) => void;
};

export default function TaskRow({ text, done, isPrivate, tags, onToggle, onSave, onDelete, onTogglePrivate, onRemoveTag }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const editRef = useRef<HTMLDivElement>(null);
  const hasHover = useHasHover();

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.innerHTML = buildColoredHTML(draft);
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
    <SwipeableRow
      rightActions={[{
        label: "Delete",
        icon: SwipeIcons.Trash,
        bg: SwipeColors.delete,
        onClick: onDelete,
      }]}
    >
      <div
        className="flex items-start gap-3 px-3 py-3 rounded-xl"
        style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}
      >
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
            <button
              type="button"
              onClick={() => { if (!done) { setDraft(text); setEditing(true); } }}
              className="text-sm leading-snug text-left w-full rounded transition-colors cursor-text"
              style={{
                color: done ? "var(--text-2)" : "var(--text)",
                textDecoration: done ? "line-through" : "none",
                opacity: done ? 0.6 : 1,
              }}
              aria-label="Edit task"
            >
              {text}
            </button>
          )}

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} hasHover={hasHover} forceVisible={editing} onRemove={() => onRemoveTag(tag.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Privacy toggle — state indicator, always visible */}
        <button
          onClick={onTogglePrivate}
          className="p-1 rounded transition-opacity hover:opacity-100 flex-shrink-0"
          style={{ color: isPrivate ? "var(--purple)" : "var(--text-3)", opacity: isPrivate ? 1 : 0.5 }}
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

        {/* Desktop-only: subtle inline trash */}
        {hasHover && !editing && (
          <button
            onClick={onDelete}
            className="p-1 rounded transition-opacity hover:opacity-100 flex-shrink-0"
            style={{ color: "var(--text-2)", opacity: 0.35 }}
            title="Delete"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
        )}
      </div>
    </SwipeableRow>
  );
}

