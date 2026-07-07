"use client";

import { useRef, useState, type ReactNode } from "react";

export type SwipeAction = {
  label: string;
  icon: ReactNode;
  bg: string;       // background color (CSS value)
  onClick: () => void;
};

type Props = {
  children: ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
};

const ACTION_WIDTH = 54; // px per action button
const ACTION_INSET = 6;  // px — pulls buttons in from the container edges so their corners stay tucked behind the row's rounded corners

// SwipeableRow — touch-friendly row that reveals action buttons when swiped
// left or right. Acts as a transparent wrapper on desktop unless the user
// horizontally drags (mouse drag is supported but rare on desktop).
export default function SwipeableRow({ children, leftActions = [], rightActions = [] }: Props) {
  const leftWidth = leftActions.length * ACTION_WIDTH;
  const rightWidth = rightActions.length * ACTION_WIDTH;

  const [tx, setTx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const startTx = useRef(0);
  const lockedAxis = useRef<"horizontal" | "vertical" | null>(null);

  function beginDrag(clientX: number, clientY: number) {
    startX.current = clientX;
    startY.current = clientY;
    startTx.current = tx;
    lockedAxis.current = null;
    setDragging(true);
  }

  function continueDrag(clientX: number, clientY: number) {
    if (!dragging) return;
    const dx = clientX - startX.current;
    const dy = clientY - startY.current;

    // Decide axis on first meaningful movement
    if (lockedAxis.current === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      lockedAxis.current = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
    }
    if (lockedAxis.current === "vertical") {
      // Cancel — let scroll happen
      setDragging(false);
      return;
    }

    let next = startTx.current + dx;
    if (next > leftWidth) next = leftWidth;
    if (next < -rightWidth) next = -rightWidth;
    setTx(next);
  }

  function endDrag() {
    if (!dragging) return;
    setDragging(false);
    if (tx > leftWidth / 2 && leftActions.length > 0) {
      setTx(leftWidth);
    } else if (tx < -rightWidth / 2 && rightActions.length > 0) {
      setTx(-rightWidth);
    } else {
      setTx(0);
    }
  }

  function close() {
    setTx(0);
  }

  const isOpen = tx !== 0;

  return (
    <div className="relative overflow-hidden rounded-xl" style={{ touchAction: "pan-y" }}>
      {/* Left actions — fade in as user swipes right, so nothing peeks at rest. */}
      {leftActions.length > 0 && (
        <div
          className="absolute flex z-0"
          style={{
            top: ACTION_INSET,
            bottom: ACTION_INSET,
            left: 0,
            width: leftWidth,
            opacity: Math.min(1, Math.max(0, tx / leftWidth)),
            transition: dragging ? "none" : "opacity 0.22s ease-out",
            pointerEvents: tx > 0 ? "auto" : "none",
          }}
        >
          {leftActions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); a.onClick(); close(); }}
              className="flex flex-col items-center justify-center gap-0.5 text-white font-semibold transition-opacity active:opacity-80"
              style={{ width: ACTION_WIDTH, background: a.bg }}
              aria-label={a.label}
            >
              {a.icon}
              <span className="text-[10px]">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Right actions — fade in as user swipes left. */}
      {rightActions.length > 0 && (
        <div
          className="absolute flex z-0"
          style={{
            top: ACTION_INSET,
            bottom: ACTION_INSET,
            right: 0,
            width: rightWidth,
            opacity: Math.min(1, Math.max(0, -tx / rightWidth)),
            transition: dragging ? "none" : "opacity 0.22s ease-out",
            pointerEvents: tx < 0 ? "auto" : "none",
          }}
        >
          {rightActions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); a.onClick(); close(); }}
              className="flex flex-col items-center justify-center gap-0.5 text-white font-semibold transition-opacity active:opacity-80"
              style={{ width: ACTION_WIDTH, background: a.bg }}
              aria-label={a.label}
            >
              {a.icon}
              <span className="text-[10px]">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Foreground row */}
      <div
        className="relative z-10"
        style={{
          transform: `translateX(${tx}px)`,
          transition: dragging ? "none" : "transform 0.22s ease-out",
        }}
        onTouchStart={(e) => beginDrag(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => continueDrag(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
        onMouseDown={(e) => {
          // Don't intercept clicks on interactive elements inside the row
          const target = e.target as HTMLElement;
          if (target.closest("button, input, [contenteditable]")) return;
          beginDrag(e.clientX, e.clientY);
        }}
        onMouseMove={(e) => continueDrag(e.clientX, e.clientY)}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onClick={isOpen ? close : undefined}
      >
        {children}
      </div>
    </div>
  );
}

// ── Pre-built icons for common actions ───────────────────────────────────────
export const SwipeIcons = {
  Edit: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  Trash: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  ),
  RemoveFromDay: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="16" x2="15" y2="16" />
    </svg>
  ),
  Share: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="12" r="3" />
      <circle cx="17" cy="6" r="3" />
      <circle cx="17" cy="18" r="3" />
      <line x1="11.6" y1="10.6" x2="14.4" y2="7.4" />
      <line x1="11.6" y1="13.4" x2="14.4" y2="16.6" />
    </svg>
  ),
  Unshare: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="12" r="3" />
      <line x1="5" y1="5" x2="19" y2="19" />
    </svg>
  ),
};

export const SwipeColors = {
  edit: "#0891B2",      // cyan
  share: "#059669",     // green
  remove: "#D97706",    // amber
  delete: "#DC2626",    // red
};
