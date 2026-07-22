"use client";

import { useEffect, useRef, useState } from "react";
import { buildColoredHTML } from "@/lib/utils/tags";
import { addedAtLabel, dateKey } from "@/lib/utils/date";
import { useHasHover } from "@/lib/hooks/useHasHover";
import SwipeableRow, { SwipeIcons, SwipeColors } from "@/components/SwipeableRow";
import TagChip from "@/components/TagChip";
import MoreMenu from "@/components/MoreMenu";
import ScheduleButton from "@/components/ScheduleButton";
import BlockInfoModal from "@/components/BlockInfoModal";
import { createClient } from "@/lib/supabase/client";
import type { Tag } from "@/lib/db/types";

type Props = {
  text: string;
  done: boolean;
  isPrivate: boolean;
  scheduledFor: string | null;
  blockId?: string | null;
  blockName?: string | null;
  tags: Tag[];
  addedAt: string;
  onToggle: () => void;
  onSave: (newText: string) => void;
  onDelete: () => void;
  onTogglePrivate: () => void;
  onSchedule: (date: string | null) => void;
  onRemoveTag: (tagId: string) => void;
};

export default function TaskRow({ text, done, isPrivate, scheduledFor, blockId, blockName, tags, addedAt, onToggle, onSave, onDelete, onTogglePrivate, onSchedule, onRemoveTag }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [blockInfoOpen, setBlockInfoOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const hasHover = useHasHover();

  useEffect(() => {
    if (!blockInfoOpen || userId) return;
    createClient().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [blockInfoOpen, userId]);

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
      leftActions={done ? [] : (() => {
        const today = dateKey(new Date());
        const isToday = scheduledFor === today;
        return [
          {
            label: "Edit",
            icon: SwipeIcons.Edit,
            bg: SwipeColors.edit,
            onClick: () => { setDraft(text); setEditing(true); },
          },
          {
            label: isToday ? "Off today" : "To today",
            icon: isToday ? SwipeIcons.RemoveFromDay : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <polyline points="9 16 11 18 16 13" />
              </svg>
            ),
            bg: isToday ? SwipeColors.remove : "var(--purple)",
            onClick: () => onSchedule(isToday ? null : today),
          },
          {
            label: isPrivate ? "Public" : "Private",
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d={isPrivate ? "M7 11V7a5 5 0 0 1 9.9-1" : "M7 11V7a5 5 0 0 1 10 0v4"} />
              </svg>
            ),
            bg: "var(--purple)",
            onClick: onTogglePrivate,
          },
        ];
      })()}
      rightActions={[{
        label: "Delete",
        icon: SwipeIcons.Trash,
        bg: SwipeColors.delete,
        onClick: onDelete,
      }]}
    >
      <div
        className="group flex items-start gap-3 px-3 py-2.5 rounded-xl"
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
              // Defer so a TagChip × click can fire before this row exits edit mode.
              onBlur={() => setTimeout(() => { if (editing) commitEdit(); }, 180)}
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

          {/* Bottom row — hashtags + schedule/block chip + added-at on the
              left, lock (and more menu on hover) on the right. Keeps the
              task text line above uncluttered. */}
          {!editing && (
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {isPrivate && (
                  <span
                    className="flex-shrink-0"
                    style={{ color: "var(--purple)" }}
                    title="Private — only you can see this"
                    aria-label="Private task"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                )}
                {!blockName && (
                  <ScheduleButton scheduledFor={scheduledFor} onChange={onSchedule} />
                )}
                {blockName && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (blockId) setBlockInfoOpen(true); }}
                    className="flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap transition-opacity hover:opacity-100"
                    style={{
                      background: "rgba(124,58,237,0.10)",
                      borderColor: "rgba(124,58,237,0.35)",
                      color: "var(--purple)",
                    }}
                    title={`In block "${blockName}" — tap for details`}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span className="max-w-[100px] truncate">{blockName}</span>
                  </button>
                )}
                {tags.map((tag) => (
                  <TagChip key={tag.id} tag={tag} hasHover={hasHover} forceVisible={editing} onRemove={() => onRemoveTag(tag.id)} />
                ))}
                <span
                  className="text-xs whitespace-nowrap"
                  style={{ color: "var(--text-3)" }}
                  title={new Date(addedAt).toLocaleString()}
                >
                  {addedAtLabel(addedAt)}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Padlock only on hover-capable devices (desktop). On touch,
                    users flip privacy via the "Private/Public" left-swipe
                    action; the small purple lock in the metadata row above
                    signals state without eating right-column space. */}
                {hasHover && (
                  <button
                    onClick={onTogglePrivate}
                    className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                    style={isPrivate
                      ? { background: "var(--purple)", color: "white" }
                      : { background: "rgba(124,58,237,0.10)", color: "var(--purple-light)" }}
                    title={isPrivate ? "Private — only you can see this. Tap to make public." : "Public — friends can see when completed. Tap to make private."}
                    aria-label={isPrivate ? "Make public" : "Make private"}
                  >
                    {isPrivate ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                      </svg>
                    )}
                  </button>
                )}
                {hasHover && (
                  <MoreMenu
                    items={[
                      {
                        label: "Delete",
                        destructive: true,
                        onClick: onDelete,
                        icon: (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                          </svg>
                        ),
                      },
                    ]}
                  />
                )}
              </div>
            </div>
          )}
          {/* In edit mode we still want the tag chips reachable */}
          {editing && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} hasHover={hasHover} forceVisible={editing} onRemove={() => onRemoveTag(tag.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {blockInfoOpen && blockId && userId && (
        <BlockInfoModal
          blockId={blockId}
          userId={userId}
          onClose={() => setBlockInfoOpen(false)}
        />
      )}
    </SwipeableRow>
  );
}

