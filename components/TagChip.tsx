"use client";

import { useState } from "react";
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
  const showX = !!onRemove && (forceVisible || (hasHover && hovered));

  return (
    <span
      className="inline-flex items-center text-xs px-1.5 py-0.5 rounded-full font-medium gap-1"
      style={{ background: bg, color: fg }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span>#{tag.name}</span>
      {showX && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          className="rounded-full flex items-center justify-center transition-opacity hover:opacity-90"
          style={{ width: 14, height: 14, background: fg, color: "white" }}
          title={`Remove #${tag.name}`}
          aria-label={`Remove #${tag.name}`}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </span>
  );
}
