"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MoreMenuItem = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  destructive?: boolean;
};

type Props = {
  items: MoreMenuItem[];
};

const POPOVER_WIDTH = 180;
const ITEM_HEIGHT = 36;
const PADDING = 8;
const GAP = 4;

// Kebab (3-dot) button that opens a small popover of secondary actions.
// The popover uses position:fixed + computed coords so it escapes any
// ancestor `overflow:hidden` (e.g. SwipeableRow).
export default function MoreMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const popoverHeight = items.length * ITEM_HEIGHT + PADDING * 2;

  function recompute() {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < popoverHeight + GAP
      ? rect.top - popoverHeight - GAP
      : rect.bottom + GAP;
    const left = Math.max(8, Math.min(window.innerWidth - POPOVER_WIDTH - 8, rect.right - POPOVER_WIDTH));
    setCoords({ top, left });
  }

  useLayoutEffect(() => {
    if (open) recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      recompute();
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1 rounded transition-opacity hover:opacity-100 flex-shrink-0"
        style={{ color: "var(--purple-light)", opacity: open ? 1 : 0.55 }}
        title="More"
        aria-label="More actions"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          className="border rounded-xl shadow-lg overflow-hidden"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: POPOVER_WIDTH,
            background: "var(--surface)",
            borderColor: "var(--border)",
            zIndex: 50,
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-opacity hover:opacity-80"
              style={{
                background: "var(--surface)",
                color: item.destructive ? "var(--red)" : "var(--text)",
                height: ITEM_HEIGHT,
              }}
            >
              <span className="flex-shrink-0" style={{ color: "currentColor", opacity: 0.7 }}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
