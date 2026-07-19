"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/utils/date";
import { getOrCreateTag, parseHashtags, stripHashtags } from "@/lib/utils/tags";
import BlockEditModal from "@/components/today/BlockEditModal";
import type { Tag } from "@/lib/db/types";

type Participant = { id: string; username: string; avatar: string | null };
type BlockTask = { id: string; text: string; done: boolean; user_id: string };

type UpcomingBlock = {
  id: string;
  name: string;
  startTime: string; // HH:MM[:SS]
  endTime: string;
  ownerId: string;
  participants: Participant[];
  invitedIds: string[]; // excludes host
  tasks: BlockTask[];
};

type Props = {
  userId: string;
};

// "HH:MM[:SS]" -> "1:00 PM"
function formatTime12h(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

// "HH:MM[:SS]" -> minutes since midnight, robust to null
function toMinutes(t: string | null): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export default function UpcomingBlocks({ userId }: Props) {
  const [blocks, setBlocks] = useState<UpcomingBlock[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Per-block "add a task" input drafts + in-flight state
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);

  async function addTaskToBlock(blockId: string) {
    const raw = (taskDrafts[blockId] ?? "").trim();
    if (!raw || addingFor === blockId) return;
    const tagNames = parseHashtags(raw);
    const text = stripHashtags(raw);
    if (!text) return;

    setAddingFor(blockId);
    setTaskDrafts((prev) => ({ ...prev, [blockId]: "" }));

    const supabase = createClient();
    const today = dateKey(new Date());
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        text,
        done: false,
        block_id: blockId,
        committed_for_date: today,
      })
      .select("id")
      .single();

    if (!error && data && tagNames.length > 0) {
      const tagObjs = (await Promise.all(tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
      if (tagObjs.length > 0) {
        await supabase.from("task_tags").insert(tagObjs.map((t) => ({ task_id: data.id, tag_id: t.id })));
      }
    }

    setAddingFor(null);
    setReloadKey((k) => k + 1);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();
      const today = dateKey(new Date());
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      // Blocks I own for today
      const ownedRes = await supabase
        .from("blocks")
        .select("id, user_id, name, start_time, end_time")
        .eq("user_id", userId)
        .eq("date", today);

      // Blocks I'm invited to for today (any status other than declined counts)
      const invitesRes = await supabase
        .from("block_invites")
        .select("block_id, status, blocks!inner(id, user_id, name, start_time, end_time, date)")
        .eq("invited_user_id", userId)
        .in("status", ["invited", "joined"])
        .eq("blocks.date", today);

      const owned = (ownedRes.data ?? []) as {
        id: string; user_id: string; name: string; start_time: string | null; end_time: string | null;
      }[];
      const invitedRaw = (invitesRes.data ?? []) as unknown as {
        block_id: string;
        blocks: { id: string; user_id: string; name: string; start_time: string | null; end_time: string | null } | { id: string; user_id: string; name: string; start_time: string | null; end_time: string | null }[] | null;
      }[];

      const seen = new Set<string>();
      const merged: {
        id: string; ownerId: string; name: string; startTime: string; endTime: string;
      }[] = [];
      for (const b of owned) {
        if (!b.start_time || !b.end_time) continue;
        if (toMinutes(b.start_time) <= nowMin) continue; // already started or done
        seen.add(b.id);
        merged.push({ id: b.id, ownerId: b.user_id, name: b.name, startTime: b.start_time, endTime: b.end_time });
      }
      for (const row of invitedRaw) {
        const b = Array.isArray(row.blocks) ? row.blocks[0] : row.blocks;
        if (!b || !b.start_time || !b.end_time) continue;
        if (seen.has(b.id)) continue;
        if (toMinutes(b.start_time) <= nowMin) continue;
        seen.add(b.id);
        merged.push({ id: b.id, ownerId: b.user_id, name: b.name, startTime: b.start_time, endTime: b.end_time });
      }

      merged.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

      if (merged.length === 0) {
        if (!cancelled) { setBlocks([]); setLoading(false); }
        return;
      }

      const blockIds = merged.map((b) => b.id);

      const [tasksRes, invitesFullRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, text, done, user_id, block_id")
          .in("block_id", blockIds),
        supabase
          .from("block_invites")
          .select("block_id, invited_user_id, status")
          .in("block_id", blockIds)
          .in("status", ["invited", "joined"]),
      ]);

      const tasks = (tasksRes.data ?? []) as { id: string; text: string; done: boolean; user_id: string; block_id: string }[];
      const invitesAll = (invitesFullRes.data ?? []) as { block_id: string; invited_user_id: string; status: string }[];

      // Gather every participant id we need to resolve
      const participantIds = new Set<string>();
      for (const b of merged) participantIds.add(b.ownerId);
      for (const i of invitesAll) participantIds.add(i.invited_user_id);

      let profiles: Participant[] = [];
      if (participantIds.size > 0) {
        const { data } = await supabase
          .from("profiles")
          .select("id, username, avatar")
          .in("id", Array.from(participantIds));
        profiles = (data ?? []) as Participant[];
      }
      const profileById = new Map(profiles.map((p) => [p.id, p]));

      const result: UpcomingBlock[] = merged.map((b) => {
        const parts: Participant[] = [];
        const invitedForBlock: string[] = [];
        const owner = profileById.get(b.ownerId);
        if (owner) parts.push(owner);
        for (const i of invitesAll) {
          if (i.block_id !== b.id) continue;
          if (i.invited_user_id === b.ownerId) continue;
          invitedForBlock.push(i.invited_user_id);
          const p = profileById.get(i.invited_user_id);
          if (p) parts.push(p);
        }
        const blockTasks = tasks
          .filter((t) => t.block_id === b.id)
          .map((t) => ({ id: t.id, text: t.text, done: t.done, user_id: t.user_id }));
        return {
          id: b.id,
          name: b.name,
          startTime: b.startTime,
          endTime: b.endTime,
          ownerId: b.ownerId,
          participants: parts,
          invitedIds: invitedForBlock,
          tasks: blockTasks,
        };
      });

      if (!cancelled) { setBlocks(result); setLoading(false); }
    }

    load();

    const supabase = createClient();
    const channel = supabase
      .channel(`upcoming-blocks-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks", filter: `user_id=eq.${userId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "block_invites", filter: `invited_user_id=eq.${userId}` }, load)
      .subscribe();

    // Also re-check every 60s so a block sliding into the past drops from the list.
    const interval = setInterval(load, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [userId, reloadKey]);

  if (loading || blocks.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--text-2)" }}>
          Coming up
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
          {blocks.length} block{blocks.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-2">
        {blocks.map((b) => {
          const isOwner = b.ownerId === userId;
          const isExpanded = expanded.has(b.id);
          const doneCount = b.tasks.filter((t) => t.done).length;
          return (
            <div
              key={b.id}
              className="rounded-2xl border overflow-hidden"
              style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}
            >
              {/* Header */}
              <button
                type="button"
                onClick={() => setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                  return next;
                })}
                className="w-full flex items-center gap-3 px-3 py-3 text-left"
              >
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
                    {b.name}
                  </div>
                  <div className="text-xs flex items-center gap-2 mt-0.5" style={{ color: "var(--text-2)" }}>
                    <span className="whitespace-nowrap">
                      {formatTime12h(b.startTime)}–{formatTime12h(b.endTime)}
                    </span>
                    <span aria-hidden style={{ color: "var(--text-3)" }}>·</span>
                    <span className="whitespace-nowrap">
                      {b.tasks.length} task{b.tasks.length === 1 ? "" : "s"}
                    </span>
                    <span aria-hidden style={{ color: "var(--text-3)" }}>·</span>
                    <span className="whitespace-nowrap">
                      {b.participants.length} {b.participants.length === 1 ? "person" : "people"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center -space-x-2 flex-shrink-0">
                  {b.participants.slice(0, 3).map((p) => (
                    <div
                      key={p.id}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-sm border-2"
                      style={{ background: "var(--surface-2)", borderColor: "var(--surface)" }}
                      title={p.username}
                    >
                      {p.avatar ?? "🙂"}
                    </div>
                  ))}
                  {b.participants.length > 3 && (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold border-2"
                      style={{ background: "var(--surface-2)", borderColor: "var(--surface)", color: "var(--text-2)" }}
                    >
                      +{b.participants.length - 3}
                    </div>
                  )}
                </div>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-shrink-0"
                  style={{
                    color: "var(--text-3)",
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s",
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Expanded */}
              {isExpanded && (
                <div
                  className="border-t px-3 py-3 space-y-3"
                  style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
                >
                  {/* Tasks */}
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-2)" }}>
                      Tasks · {doneCount}/{b.tasks.length}
                    </div>
                    {b.tasks.length === 0 ? (
                      <p className="text-xs mb-2" style={{ color: "var(--text-3)" }}>No tasks assigned yet</p>
                    ) : (
                      <div className="space-y-1 mb-2">
                        {b.tasks.map((t) => (
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
                              className="truncate"
                              style={{
                                color: t.done ? "var(--text-3)" : "var(--text)",
                                textDecoration: t.done ? "line-through" : "none",
                              }}
                            >
                              {t.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Inline quick-add — adds a task to this block for the current user */}
                    <div className="flex gap-1.5 mt-1">
                      <input
                        type="text"
                        value={taskDrafts[b.id] ?? ""}
                        onChange={(e) => setTaskDrafts((prev) => ({ ...prev, [b.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); addTaskToBlock(b.id); }
                        }}
                        onClick={(e) => e.stopPropagation()}
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
                        onClick={(e) => { e.stopPropagation(); addTaskToBlock(b.id); }}
                        disabled={addingFor === b.id || !(taskDrafts[b.id] ?? "").trim()}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
                        style={{ background: "var(--purple)" }}
                      >
                        {addingFor === b.id ? "…" : "Add"}
                      </button>
                    </div>
                  </div>

                  {/* Participants */}
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-2)" }}>
                      Who&apos;s in
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {b.participants.map((p) => (
                        <span
                          key={p.id}
                          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border"
                          style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)" }}
                        >
                          <span>{p.avatar ?? "🙂"}</span>
                          <span>{p.username}</span>
                          {p.id === b.ownerId && (
                            <span className="text-[9px] font-semibold uppercase" style={{ color: "var(--purple)" }}>Host</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Owner-only actions */}
                  {isOwner && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditingId(b.id); }}
                        className="w-full text-xs font-semibold py-2 rounded-xl border transition-colors"
                        style={{ background: "var(--surface)", borderColor: "var(--purple)", color: "var(--purple)" }}
                      >
                        Edit block
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingId && (() => {
        const target = blocks.find((b) => b.id === editingId);
        if (!target) return null;
        return (
          <BlockEditModal
            userId={userId}
            block={{
              id: target.id,
              name: target.name,
              startTime: target.startTime,
              endTime: target.endTime,
              invitedIds: target.invitedIds,
            }}
            onClose={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null);
              setReloadKey((k) => k + 1);
            }}
            onDeleted={() => {
              setEditingId(null);
              setReloadKey((k) => k + 1);
            }}
          />
        );
      })()}
    </div>
  );
}
