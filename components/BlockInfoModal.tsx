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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {!data && !error && (
          <div
            className="rounded-2xl border flex items-center justify-center py-16"
            style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}
          >
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
            />
          </div>
        )}

        {error && (
          <div
            className="rounded-2xl border px-6 py-8 text-center text-sm"
            style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}
          >
            {error}
          </div>
        )}

        {data && (
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}
          >
            {/* Header — matches the collapsed UpcomingBlocks card */}
            <div className="w-full flex items-center gap-3 px-3 py-3">
              <div
                className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
                style={{ background: "rgba(124,58,237,0.12)", color: "var(--purple)" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                  {data.name}
                </div>
                <div className="text-xs flex items-center gap-2 mt-0.5" style={{ color: "var(--text-2)" }}>
                  <span className="whitespace-nowrap">
                    {formatTime12h(data.startTime)}–{formatTime12h(data.endTime)}
                  </span>
                  <span aria-hidden style={{ color: "var(--text-3)" }}>·</span>
                  <span className="whitespace-nowrap">
                    {data.tasks.length} task{data.tasks.length === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden style={{ color: "var(--text-3)" }}>·</span>
                  <span className="whitespace-nowrap">
                    {data.participants.length} {data.participants.length === 1 ? "person" : "people"}
                  </span>
                </div>
              </div>
              <div className="flex items-center -space-x-2 flex-shrink-0">
                {data.participants.slice(0, 3).map((p) => (
                  <div
                    key={p.id}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-sm border-2"
                    style={{ background: "var(--surface-2)", borderColor: "var(--surface)" }}
                    title={p.username}
                  >
                    {p.avatar ?? "🙂"}
                  </div>
                ))}
                {data.participants.length > 3 && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold border-2"
                    style={{ background: "var(--surface-2)", borderColor: "var(--surface)", color: "var(--text-2)" }}
                  >
                    +{data.participants.length - 3}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded flex-shrink-0"
                style={{ color: "var(--text-3)" }}
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Body — matches the expanded UpcomingBlocks card */}
            <div
              className="border-t px-3 py-3 space-y-3"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
            >
              {/* Date line — shown here because a task's block may not be today */}
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                {formatDateLong(data.date)}
              </div>

              {/* Tasks */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-2)" }}>
                  Tasks · {data.tasks.filter((t) => t.done).length}/{data.tasks.length}
                </div>
                {data.tasks.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-3)" }}>No tasks assigned yet</p>
                ) : (
                  <div className="space-y-1">
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
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-2)" }}>
                  Who&apos;s in
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.participants.map((p) => (
                    <span
                      key={p.id}
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border"
                      style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)" }}
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
          </div>
        )}
      </div>
    </div>
  );
}
