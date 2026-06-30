"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type MoreMenuItem = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  destructive?: boolean;
};

type Props = {
  items: MoreMenuItem[];
};

// Kebab (3-dot) button that reveals a small popover of secondary actions.
// Used to keep desktop rows tidy without losing functionality.
export default function MoreMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1 rounded transition-opacity hover:opacity-100"
        style={{ color: "var(--text-2)", opacity: open ? 1 : 0.5 }}
        title="More"
        aria-label="More actions"
        aria-expanded={open}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-30 border rounded-xl shadow-lg overflow-hidden min-w-[160px]"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-opacity hover:opacity-80"
              style={{
                background: "var(--surface)",
                color: item.destructive ? "var(--red)" : "var(--text)",
              }}
            >
              <span className="flex-shrink-0" style={{ color: "currentColor", opacity: 0.7 }}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
