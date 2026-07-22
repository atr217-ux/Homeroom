"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { getOrCreateTag, parseHashtags, stripHashtags } from "@/lib/utils/tags";
import BlockEditModal from "@/components/today/BlockEditModal";
import type { Tag } from "@/lib/db/types";

type Participant = { id: string; username: string; avatar: string | null };
type BlockTask = { id: string; text: string; done: boolean; user_id: string; isShared: boolean; isPrivate: boolean };

type BlockInfo = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  ownerId: string;
  invitedIds: string[];
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

export default function BlockInfoModal({ blockId, userId, onClose }: Props) {
  const [data, setData] = useState<BlockInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [taskDraft, setTaskDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingBlock, setEditingBlock] = useState(false);

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
          invitedIds: inviteeIds.filter((id) => id !== b.user_id),
          participants,
          tasks,
        });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [blockId, reloadKey]);

  async function toggleDone(taskId: string) {
    if (!data) return;
    const t = data.tasks.find((x) => x.id === taskId);
    if (!t || t.user_id !== userId) return;
    const next = !t.done;
    setData({ ...data, tasks: data.tasks.map((x) => x.id === taskId ? { ...x, done: next } : x) });
    await createClient()
      .from("tasks")
      .update({ done: next, completed_at: next ? new Date().toISOString() : null })
      .eq("id", taskId);
  }

  async function toggleShared(taskId: string) {
    if (!data) return;
    const t = data.tasks.find((x) => x.id === taskId);
    if (!t || t.user_id !== userId) return;
    const next = !t.isShared;
    setData({ ...data, tasks: data.tasks.map((x) => x.id === taskId ? { ...x, isShared: next } : x) });
    await createClient().from("tasks").update({ is_shared: next }).eq("id", taskId);
  }

  async function togglePrivate(taskId: string) {
    if (!data) return;
    const t = data.tasks.find((x) => x.id === taskId);
    if (!t || t.user_id !== userId) return;
    const next = !t.isPrivate;
    setData({ ...data, tasks: data.tasks.map((x) => x.id === taskId ? { ...x, isPrivate: next } : x) });
    await createClient().from("tasks").update({ is_private: next }).eq("id", taskId);
  }

  async function addTask() {
    const raw = taskDraft.trim();
    if (!data || !raw || adding) return;
    const tagNames = parseHashtags(raw);
    const text = stripHashtags(raw);
    if (!text) return;
    setAdding(true);
    setTaskDraft("");
    const supabase = createClient();
    const { data: inserted } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        text,
        done: false,
        block_id: data.id,
        committed_for_date: data.date,
      })
      .select("id")
      .single();
    if (inserted && tagNames.length > 0) {
      const tagObjs = (await Promise.all(tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
      if (tagObjs.length > 0) {
        await supabase.from("task_tags").insert(tagObjs.map((tg) => ({ task_id: inserted.id, tag_id: tg.id })));
      }
    }
    setAdding(false);
    setReloadKey((k) => k + 1);
  }

  if (typeof document === "undefined") return null;

  const doneCount = data?.tasks.filter((t) => t.done).length ?? 0;
  const isOwner = data?.ownerId === userId;

  return createPortal(
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
            {/* Header — mirrors the collapsed UpcomingBlocks card */}
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
                <div className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{data.name}</div>
                <div className="text-xs flex items-center gap-2 mt-0.5" style={{ color: "var(--text-2)" }}>
                  <span className="whitespace-nowrap">{formatTime12h(data.startTime)}–{formatTime12h(data.endTime)}</span>
                  <span aria-hidden style={{ color: "var(--text-3)" }}>·</span>
                  <span className="whitespace-nowrap">{data.tasks.length} task{data.tasks.length === 1 ? "" : "s"}</span>
                  <span aria-hidden style={{ color: "var(--text-3)" }}>·</span>
                  <span className="whitespace-nowrap">{data.participants.length} {data.participants.length === 1 ? "person" : "people"}</span>
                </div>
              </div>
              {data.participants.length > 0 && (
                <div className="flex items-center -space-x-1.5 flex-shrink-0">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-sm border-2"
                    style={{ background: "var(--surface-2)", borderColor: "var(--surface)" }}
                    title={data.participants[0].username}
                  >
                    {data.participants[0].avatar ?? "🙂"}
                  </div>
                  {data.participants.length > 1 && (
                    <div
                      className="h-7 min-w-7 px-1.5 rounded-full flex items-center justify-center text-[11px] font-semibold border-2"
                      style={{ background: "var(--surface-2)", borderColor: "var(--surface)", color: "var(--text-2)" }}
                      title={data.participants.slice(1).map((p) => p.username).join(", ")}
                    >
                      +{data.participants.length - 1}
                    </div>
                  )}
                </div>
              )}
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

            {/* Body — interactive, mirrors the expanded UpcomingBlocks card */}
            <div
              className="border-t px-3 py-3 space-y-3"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
            >
              {/* Tasks */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-2)" }}>
                  Tasks · {doneCount}/{data.tasks.length}
                </div>
                {data.tasks.length === 0 ? (
                  <p className="text-xs mb-2" style={{ color: "var(--text-3)" }}>No tasks assigned yet</p>
                ) : (
                  <div className="space-y-1 mb-2">
                    {data.tasks.map((t) => {
                      const ownTask = t.user_id === userId;
                      const canSeeText = ownTask || !t.isPrivate;
                      return (
                        <div key={t.id} className="flex items-center gap-2 text-sm">
                          <button
                            type="button"
                            onClick={() => ownTask && toggleDone(t.id)}
                            disabled={!ownTask}
                            className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center"
                            style={t.done
                              ? { background: "var(--purple)", border: "2px solid var(--purple)" }
                              : { border: "2px solid var(--border-3)" }}
                            aria-label={t.done ? "Mark not done" : "Mark done"}
                          >
                            {t.done && (
                              <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
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
                          {ownTask && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); togglePrivate(t.id); }}
                                className="w-6 h-6 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
                                style={t.isPrivate
                                  ? { background: "var(--purple)", color: "white" }
                                  : { background: "rgba(124,58,237,0.10)", color: "var(--purple-light)" }}
                                title={t.isPrivate ? "Private — tap to make public" : "Public — tap to make private"}
                                aria-label={t.isPrivate ? "Make public" : "Make private"}
                              >
                                {t.isPrivate ? (
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
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleShared(t.id); }}
                                className="w-6 h-6 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
                                style={t.isShared
                                  ? { background: "var(--purple)", color: "white" }
                                  : { background: "rgba(124,58,237,0.10)", color: "var(--purple-light)" }}
                                title={t.isShared ? "Shared — tap to unshare" : "Mark as shared"}
                                aria-label={t.isShared ? "Unshare" : "Share"}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                              </button>
                            </>
                          )}
                          {!ownTask && t.isShared && (
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

                {/* Quick-add */}
                <div className="flex gap-1.5 mt-1">
                  <input
                    type="text"
                    value={taskDraft}
                    onChange={(e) => setTaskDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } }}
                    placeholder="Add a task… (try #category)"
                    className="flex-1 text-sm rounded-lg px-2.5 py-1.5 focus:outline-none border"
                    style={{
                      background: "var(--surface)",
                      borderColor: "var(--border-2)",
                      color: "var(--text)",
                      fontSize: "16px",
                    }}
                  />
                  <button
                    type="button"
                    onClick={addTask}
                    disabled={adding || !taskDraft.trim()}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
                    style={{ background: "var(--purple)" }}
                  >
                    {adding ? "…" : "Add"}
                  </button>
                </div>
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

              {/* Owner action */}
              {isOwner && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setEditingBlock(true)}
                    className="w-full text-xs font-semibold py-2 rounded-xl border transition-colors"
                    style={{ background: "var(--surface)", borderColor: "var(--purple)", color: "var(--purple)" }}
                  >
                    Edit block
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {editingBlock && data && (
        <BlockEditModal
          userId={userId}
          block={{
            id: data.id,
            name: data.name,
            startTime: data.startTime,
            endTime: data.endTime,
            invitedIds: data.invitedIds,
          }}
          onClose={() => setEditingBlock(false)}
          onSaved={() => { setEditingBlock(false); setReloadKey((k) => k + 1); }}
          onDeleted={() => { setEditingBlock(false); onClose(); }}
        />
      )}
    </div>,
    document.body,
  );
}
