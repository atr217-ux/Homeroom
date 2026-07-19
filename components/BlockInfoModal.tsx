"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Participant = { id: string; username: string; avatar: string | null };
type BlockTask = { id: string; text: string; done: boolean; user_id: string; isShared: boolean; isPrivate: boolean };

type BlockInfo = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  ownerId: string;
  participants: Participant[];
  tasks: BlockTask[];
};

type Props = {
  blockId: string;
  userId: string;
  onClose: () => void;
};

function formatTime12h(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export default function BlockInfoModal({ blockId, userId, onClose }: Props) {
  const [data, setData] = useState<BlockInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const [blockRes, tasksRes, invitesRes] = await Promise.all([
        supabase
          .from("blocks")
          .select("id, name, date, start_time, end_time, user_id")
          .eq("id", blockId)
          .single(),
        supabase
          .from("tasks")
          .select("id, text, done, user_id, is_private, is_shared")
          .eq("block_id", blockId),
        supabase
          .from("block_invites")
          .select("invited_user_id, status")
          .eq("block_id", blockId)
          .in("status", ["invited", "joined"]),
      ]);

      if (blockRes.error || !blockRes.data) {
        if (!cancelled) setError("Could not load block");
        return;
      }
      const b = blockRes.data as {
        id: string; name: string; date: string;
        start_time: string | null; end_time: string | null; user_id: string;
      };
      if (!b.start_time || !b.end_time) {
        if (!cancelled) setError("Block times are missing");
        return;
      }

      const inviteeIds = ((invitesRes.data ?? []) as { invited_user_id: string }[]).map((r) => r.invited_user_id);
      const partIds = Array.from(new Set([b.user_id, ...inviteeIds]));
      let profiles: Participant[] = [];
      if (partIds.length > 0) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, username, avatar")
          .in("id", partIds);
        profiles = (ps ?? []) as Participant[];
      }
      const profileById = new Map(profiles.map((p) => [p.id, p]));

      const participants: Participant[] = [];
      const owner = profileById.get(b.user_id);
      if (owner) participants.push(owner);
      for (const id of inviteeIds) {
        if (id === b.user_id) continue;
        const p = profileById.get(id);
        if (p) participants.push(p);
      }

      const tasks = ((tasksRes.data ?? []) as {
        id: string; text: string; done: boolean; user_id: string;
        is_private: boolean | null; is_shared: boolean | null;
      }[]).map((t) => ({
        id: t.id,
        text: t.text,
        done: t.done,
        user_id: t.user_id,
        isShared: t.is_shared ?? false,
        isPrivate: t.is_private ?? false,
      }));

      if (!cancelled) {
        setData({
          id: b.id,
          name: b.name,
          date: b.date,
          startTime: b.start_time,
          endTime: b.end_time,
          ownerId: b.user_id,
          participants,
          tasks,
        });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [blockId]);

  const doneCount = data?.tasks.filter((t) => t.done).length ?? 0;
  const totalTasks = data?.tasks.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        style={{ background: "var(--surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center z-10 hover:opacity-100"
          style={{ color: "var(--text-2)", opacity: 0.6 }}
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="h-1 w-full flex-shrink-0" style={{ background: "var(--purple)" }} />

        {!data && !error && (
          <div className="flex items-center justify-center py-16">
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
            />
          </div>
        )}

        {error && (
          <div className="px-6 py-8 text-center text-sm" style={{ color: "var(--text-2)" }}>
            {error}
          </div>
        )}

        {data && (
          <div className="flex-1 overflow-y-auto">
            {/* Header */}
            <div className="px-6 pt-6 pb-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.25em] mb-1" style={{ color: "var(--purple)" }}>
                Block
              </div>
              <div
                className="font-display italic leading-tight break-words"
                style={{ color: "var(--text)", fontSize: "clamp(1.5rem, 6vw, 2rem)" }}
              >
                {data.name}
              </div>
              <div className="text-sm mt-2" style={{ color: "var(--text-2)" }}>
                {formatDateLong(data.date)} · {formatTime12h(data.startTime)}–{formatTime12h(data.endTime)}
              </div>
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-2 border-t border-b" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-col items-center justify-center py-3">
                <span className="font-display tabular-nums" style={{ color: "var(--text)", fontSize: "1.5rem", lineHeight: 1 }}>
                  {doneCount}/{totalTasks}
                </span>
                <span className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>tasks done</span>
              </div>
              <div className="flex flex-col items-center justify-center py-3" style={{ borderLeft: "1px solid var(--border)" }}>
                <span className="font-display tabular-nums" style={{ color: "var(--text)", fontSize: "1.5rem", lineHeight: 1 }}>
                  {data.participants.length}
                </span>
                <span className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>
                  {data.participants.length === 1 ? "person" : "people"}
                </span>
              </div>
            </div>

            {/* Tasks */}
            <div className="px-6 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-2)" }}>
                Tasks
              </div>
              {data.tasks.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-3)" }}>No tasks assigned yet</p>
              ) : (
                <div className="space-y-1.5">
                  {data.tasks.map((t) => {
                    const canSeeText = t.user_id === userId || !t.isPrivate;
                    return (
                      <div key={t.id} className="flex items-center gap-2 text-sm">
                        <span
                          className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center"
                          style={t.done
                            ? { background: "var(--purple)", border: "2px solid var(--purple)" }
                            : { border: "2px solid var(--border-3)" }}
                        >
                          {t.done && (
                            <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <span
                          className="flex-1 truncate"
                          style={{
                            color: t.done ? "var(--text-3)" : "var(--text)",
                            textDecoration: t.done ? "line-through" : "none",
                            fontStyle: canSeeText ? "normal" : "italic",
                          }}
                        >
                          {canSeeText ? t.text : "Private task"}
                        </span>
                        {t.isShared && (
                          <span style={{ color: "var(--purple)", opacity: 0.7 }} title="Shared task">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Participants */}
            <div className="px-6 pb-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-2)" }}>
                Who&apos;s in
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.participants.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border"
                    style={{ background: "var(--surface-2)", borderColor: "var(--border-2)", color: "var(--text)" }}
                  >
                    <span>{p.avatar ?? "🙂"}</span>
                    <span>{p.username}</span>
                    {p.id === data.ownerId && (
                      <span className="text-[9px] font-semibold uppercase" style={{ color: "var(--purple)" }}>Host</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
