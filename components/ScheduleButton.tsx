"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dateKey } from "@/lib/utils/date";

type Props = {
  scheduledFor: string | null; // YYYY-MM-DD
  onChange: (next: string | null) => void;
};

const POPOVER_WIDTH = 220;
const PADDING = 8;
const GAP = 4;

// Returns YYYY-MM-DD for `today + offsetDays`.
function offsetKey(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return dateKey(d);
}

// "Tue 7/7" style label for a date-key string.
function formatPill(iso: string): string {
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const wk = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${wk} ${d.getMonth() + 1}/${d.getDate()}`;
}

export default function ScheduleButton({ scheduledFor, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [customDate, setCustomDate] = useState("");

  const today = dateKey(new Date());
  const isToday = scheduledFor === today;
  const isFuture = !!scheduledFor && scheduledFor > today;
  // Past dates should render like "unscheduled" (gray plus icon), not the
  // scheduled-purple state, otherwise a stale committed_for_date from a
  // previous day leaves the icon looking active.
  const isScheduled = isToday || isFuture;

  // Recompute popover position based on the trigger's bounding rect
  function recompute() {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const popH = 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < popH + GAP ? rect.top - popH - GAP : rect.bottom + GAP;
    const left = Math.max(PADDING, Math.min(window.innerWidth - POPOVER_WIDTH - PADDING, rect.right - POPOVER_WIDTH));
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
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onReflow() { recompute(); }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(next: string | null) {
    onChange(next);
    setOpen(false);
    setCustomDate("");
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex-shrink-0 flex items-center transition-opacity hover:opacity-100"
        title={isToday ? "Scheduled for today" : isFuture ? `Scheduled for ${formatPill(scheduledFor)}` : "Add to today or schedule"}
        aria-label="Schedule task"
      >
        {isFuture ? (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-md border"
            style={{
              background: "rgba(124,58,237,0.10)",
              borderColor: "rgba(124,58,237,0.35)",
              color: "var(--purple)",
            }}
          >
            {formatPill(scheduledFor)}
          </span>
        ) : isToday ? (
          <span
            className="flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap"
            style={{
              background: "rgba(124,58,237,0.10)",
              borderColor: "rgba(124,58,237,0.35)",
              color: "var(--purple)",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <polyline points="9 16 11 18 16 13" />
            </svg>
            <span>Today</span>
          </span>
        ) : (
          <span
            className="flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-md border border-dashed whitespace-nowrap"
            style={{
              background: "transparent",
              borderColor: "var(--purple-muted)",
              color: "var(--purple-light)",
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="12" y1="14" x2="12" y2="18" />
              <line x1="10" y1="16" x2="14" y2="16" />
            </svg>
            <span>Date</span>
          </span>
        )}
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
          <button
            type="button"
            onClick={() => pick(today)}
            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-left text-sm transition-opacity hover:opacity-80"
            style={{
              background: "var(--surface)",
              color: isToday ? "var(--purple)" : "var(--text)",
              fontWeight: isToday ? 600 : 400,
            }}
          >
            <span>Today</span>
            <span className="text-xs" style={{ color: "var(--text-3)" }}>{formatPill(today)}</span>
          </button>
          <button
            type="button"
            onClick={() => pick(offsetKey(1))}
            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-left text-sm transition-opacity hover:opacity-80"
            style={{ background: "var(--surface)", color: "var(--text)" }}
          >
            <span>Tomorrow</span>
            <span className="text-xs" style={{ color: "var(--text-3)" }}>{formatPill(offsetKey(1))}</span>
          </button>
          <button
            type="button"
            onClick={() => pick(offsetKey(7))}
            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-left text-sm transition-opacity hover:opacity-80"
            style={{ background: "var(--surface)", color: "var(--text)" }}
          >
            <span>Next week</span>
            <span className="text-xs" style={{ color: "var(--text-3)" }}>{formatPill(offsetKey(7))}</span>
          </button>
          <div className="border-t px-3 pt-2 pb-2 space-y-2" style={{ borderColor: "var(--border-2)" }}>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--text-2)" }}>Pick:</span>
              <input
                type="date"
                value={customDate || scheduledFor || ""}
                min={today}
                onChange={(e) => setCustomDate(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 text-sm rounded-md px-2 py-1 focus:outline-none border"
                style={{ background: "var(--bg)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "14px" }}
              />
            </div>
            <button
              type="button"
              onClick={() => { if (customDate) pick(customDate); }}
              disabled={!customDate}
              className="w-full text-xs font-semibold py-1.5 rounded-md text-white disabled:opacity-40"
              style={{ background: "var(--purple)" }}
            >
              Set date
            </button>
          </div>
          {isScheduled && (
            <button
              type="button"
              onClick={() => pick(null)}
              className="w-full text-left text-xs px-3 py-2 border-t transition-opacity hover:opacity-80"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border-2)",
                color: "var(--text-2)",
              }}
            >
              Clear schedule
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
