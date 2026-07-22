"use client";

import { useEffect, useRef, useState } from "react";
import { tagColor } from "@/lib/utils/tags";
import type { Tag } from "@/lib/db/types";

type Props = {
  tag: Tag;
  hasHover: boolean;
  onRemove?: () => void;
  // When true, the X is shown regardless of hover (used during inline edit
  // so mobile users have a way to remove tags).
  forceVisible?: boolean;
};

export default function TagChip({ tag, hasHover, onRemove, forceVisible = false }: Props) {
  const { bg, fg } = tagColor(tag.name);
  const [hovered, setHovered] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Touch (no hover): always show the corner X so mobile users can peel a
  // category off. Desktop (hasHover): only reveal on chip hover — matches
  // the pre-swipe-edit behaviour. forceVisible still overrides during inline
  // edit for parity.
  const showX = !!onRemove && (forceVisible || !hasHover || hovered);

  function armConfirm(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirming(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    // Auto-cancel after a few seconds so the chip doesn't sit stuck in
    // "Remove?" if the user walks away.
    timerRef.current = window.setTimeout(() => setConfirming(false), 4000);
  }

  function doRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    onRemove?.();
  }

  const bgColor = confirming ? "var(--red)" : bg;
  const fgColor = confirming ? "white" : fg;

  return (
    <span
      className="relative inline-flex items-center text-xs px-1.5 py-0.5 rounded-full font-medium transition-colors"
      style={{ background: bgColor, color: fgColor }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); if (confirming) { setConfirming(false); if (timerRef.current) clearTimeout(timerRef.current); } }}
    >
      {confirming ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={doRemove}
          className="text-xs font-semibold"
          title={`Confirm remove #${tag.name}`}
          data-tag-remove
        >
          Remove #{tag.name}?
        </button>
      ) : (
        <span>#{tag.name}</span>
      )}
      {showX && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={confirming ? doRemove : armConfirm}
          className="absolute -top-1 -right-1 rounded-full flex items-center justify-center transition-transform hover:scale-110"
          style={{
            width: 14,
            height: 14,
            background: confirming ? "white" : fg,
            color: confirming ? "var(--red)" : "white",
            border: confirming ? "1px solid white" : "1px solid var(--surface)",
          }}
          title={confirming ? "Confirm remove" : `Remove #${tag.name}`}
          aria-label={confirming ? "Confirm remove" : `Remove #${tag.name}`}
          data-tag-remove
        >
          {confirming ? (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}
