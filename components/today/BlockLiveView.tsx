"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatTime, isWithinTimeRange } from "@/lib/utils/date";
import { getOrCreateTag, parseHashtags, stripHashtags, tagColor } from "@/lib/utils/tags";
import SwipeableRow, { SwipeIcons, SwipeColors } from "@/components/SwipeableRow";
import TagChip from "@/components/TagChip";
import MoreMenu from "@/components/MoreMenu";
import { useHasHover } from "@/lib/hooks/useHasHover";
import type { Block, Tag } from "@/lib/db/types";

type LiveTask = {
  id: string;
  user_id: string;
  text: string;
  done: boolean;
  isPrivate: boolean;
  isShared: boolean;
  claimedBy: string | null;
  timeSpent: number;
  startedAt: number | null;
  tagIds: string[];
};

type Participant = { id: string; username: string; avatar: string | null };

type Props = {
  block: Block;
  userId: string;
};

export default function BlockLiveView({ block, userId }: Props) {
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  // Quick-add input for the current user's tasks in this block.
  const [newTaskInput, setNewTaskInput] = useState("");
  const [addingTask, setAddingTask] = useState(false);

  // "Add from my list" — pull an existing personal task into this block.
  type AvailableTask = { id: string; text: string; isPrivate: boolean; tagIds: string[]; createdAt: string };
  const [available, setAvailable] = useState<AvailableTask[]>([]);
  const [showAvailable, setShowAvailable] = useState(false);
  const [availableSearch, setAvailableSearch] = useState("");

  async function loadAvailable() {
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .select("id, text, is_private, created_at, block_id, task_tags(tag_id)")
      .eq("user_id", userId)
      .eq("done", false)
      .order("created_at", { ascending: false })
      .limit(200);
    // Exclude tasks already attached to any block (a task belongs to at
    // most one block at a time).
    setAvailable(((data ?? []) as { id: string; text: string; is_private: boolean | null; created_at: string; block_id: string | null; task_tags: { tag_id: string }[] | null }[])
      .filter((r) => !r.block_id)
      .map((r) => ({
        id: r.id,
        text: r.text,
        isPrivate: r.is_private ?? false,
        tagIds: (r.task_tags ?? []).map((tt) => tt.tag_id),
        createdAt: r.created_at,
      })));
  }

  async function openAvailable() {
    setShowAvailable(true);
    await loadAvailable();
  }

  async function importIntoBlock(av: AvailableTask) {
    setAvailable((prev) => prev.filter((t) => t.id !== av.id));
    await createClient()
      .from("tasks")
      .update({ block_id: block.id, committed_for_date: block.date })
      .eq("id", av.id);
    // Realtime subscription refreshes the task list below.
  }

  async function addMyTaskToBlock() {
    const raw = newTaskInput.trim();
    if (!raw || addingTask) return;
    const tagNames = parseHashtags(raw);
    const text = stripHashtags(raw);
    if (!text) return;
    setAddingTask(true);
    setNewTaskInput("");
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        text,
        done: false,
        block_id: block.id,
        committed_for_date: block.date,
      })
      .select("id")
      .single();
    if (data && tagNames.length > 0) {
      const tagObjs = (await Promise.all(tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
      if (tagObjs.length > 0) {
        await supabase.from("task_tags").insert(tagObjs.map((tg) => ({ task_id: data.id, tag_id: tg.id })));
      }
    }
    setAddingTask(false);
    // Realtime subscription in this component will pick up the new row.
  }

  // ── Load ───────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [tasksRes, invitesRes, ownerRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, user_id, text, done, is_private, is_shared, claimed_by_user_id, time_spent, timer_started_at, task_tags(tag_id)")
          .eq("block_id", block.id),
        supabase
          .from("block_invites")
          .select("invited_user_id, status")
          .eq("block_id", block.id)
          .in("status", ["invited", "joined"]),
        supabase.from("profiles").select("id, username, avatar").eq("id", block.user_id).single(),
      ]);

      const inviteeIds = ((invitesRes.data ?? []) as { invited_user_id: string }[]).map((r) => r.invited_user_id);

      const ownerProfile = ownerRes.data as Participant | null;
      let inviteeProfiles: Participant[] = [];
      if (inviteeIds.length > 0) {
        const { data } = await supabase
          .from("profiles")
          .select("id, username, avatar")
          .in("id", inviteeIds);
        inviteeProfiles = ((data ?? []) as Participant[]);
      }
      const allParticipants: Participant[] = [];
      if (ownerProfile) allParticipants.push(ownerProfile);
      for (const p of inviteeProfiles) if (!allParticipants.find((x) => x.id === p.id)) allParticipants.push(p);
      setParticipants(allParticipants);

      // Tags used by these tasks
      const tagIdsSet = new Set<string>();
      for (const t of (tasksRes.data ?? []) as { task_tags: { tag_id: string }[] | null }[]) {
        for (const tt of (t.task_tags ?? [])) tagIdsSet.add(tt.tag_id);
      }
      if (tagIdsSet.size > 0) {
        const { data: tagData } = await supabase
          .from("tags")
          .select("id, name")
          .in("id", Array.from(tagIdsSet));
        setAllTags((tagData ?? []) as Tag[]);
      }

      setTasks(((tasksRes.data ?? []) as {
        id: string;
        user_id: string;
        text: string;
        done: boolean;
        is_private: boolean | null;
        is_shared: boolean;
        claimed_by_user_id: string | null;
        time_spent: number;
        timer_started_at: string | null;
        task_tags: { tag_id: string }[] | null;
      }[]).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        text: r.text,
        done: r.done,
        isPrivate: r.is_private ?? false,
        isShared: r.is_shared ?? false,
        claimedBy: r.claimed_by_user_id,
        timeSpent: r.time_spent ?? 0,
        startedAt: r.timer_started_at ? new Date(r.timer_started_at).getTime() : null,
        tagIds: (r.task_tags ?? []).map((tt) => tt.tag_id),
      })));
      setLoading(false);
    }
    load();

    const supabase = createClient();
    const channel = supabase
      .channel(`block-live-${block.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `block_id=eq.${block.id}` }, load)
      .subscribe();

    const ticker = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(ticker);
    };
  }, [block.id, block.user_id]);

  function elapsed(t: LiveTask): number {
    return t.startedAt === null ? t.timeSpent : t.timeSpent + Math.floor((Date.now() - t.startedAt) / 1000);
  }

  async function toggleDone(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const spent = elapsed(t);
    const nowDone = !t.done;
    setTasks((prev) => prev.map((x) => x.id === id ? { ...x, done: nowDone, timeSpent: spent, startedAt: null } : x));
    await createClient().from("tasks").update({
      done: nowDone,
      time_spent: spent,
      timer_started_at: null,
      completed_at: nowDone ? new Date().toISOString() : null,
      completed_by_user_id: nowDone ? userId : null,
    }).eq("id", id);
  }

  async function startTimer(id: string) {
    const now = Date.now();
    const supabase = createClient();
    const running = tasks.find((t) => t.startedAt !== null && t.id !== id);
    await Promise.all([
      supabase.from("tasks").update({ timer_started_at: new Date(now).toISOString() }).eq("id", id),
      running ? supabase.from("tasks").update({ timer_started_at: null, time_spent: elapsed(running) }).eq("id", running.id) : Promise.resolve(),
    ]);
    setTasks((prev) => prev.map((t) => {
      if (t.id === id) return { ...t, startedAt: now };
      if (t.startedAt !== null) return { ...t, timeSpent: elapsed(t), startedAt: null };
      return t;
    }));
  }

  async function stopTimer(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const spent = elapsed(t);
    await createClient().from("tasks").update({ timer_started_at: null, time_spent: spent }).eq("id", id);
    setTasks((prev) => prev.map((x) => x.id === id ? { ...x, timeSpent: spent, startedAt: null } : x));
  }

  async function saveEdit(id: string) {
    const raw = editingText.trim();
    if (!raw) { setEditingId(null); return; }
    const tagNames = parseHashtags(raw);
    const text = stripHashtags(raw);
    if (!text) { setEditingId(null); return; }

    const supabase = createClient();
    const existing = tasks.find((t) => t.id === id)?.tagIds ?? [];
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, text } : t));
    setEditingId(null);
    await supabase.from("tasks").update({ text }).eq("id", id);

    if (tagNames.length === 0) return;
    const tagObjs = (await Promise.all(tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
    const newOnes = tagObjs.filter((tg) => !existing.includes(tg.id));
    if (newOnes.length > 0) {
      await supabase.from("task_tags").insert(newOnes.map((tg) => ({ task_id: id, tag_id: tg.id })));
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, tagIds: [...t.tagIds, ...newOnes.map((n) => n.id)] } : t));
    }
    // Ensure new tags are in the local tag map so the chip renders
    setAllTags((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      for (const t of tagObjs) map.set(t.id, t);
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function togglePrivate(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const next = !t.isPrivate;
    setTasks((prev) => prev.map((x) => x.id === id ? { ...x, isPrivate: next } : x));
    await createClient().from("tasks").update({ is_private: next }).eq("id", id);
  }

  async function toggleShared(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const next = !t.isShared;
    setTasks((prev) => prev.map((x) => x.id === id ? { ...x, isShared: next, claimedBy: next ? x.claimedBy : null } : x));
    await createClient()
      .from("tasks")
      .update({ is_shared: next, claimed_by_user_id: next ? t.claimedBy : null })
      .eq("id", id);
  }

  async function removeFromBlock(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await createClient().from("tasks").update({ block_id: null, is_shared: false, claimed_by_user_id: null }).eq("id", id);
  }

  async function removeTagFromTask(taskId: string, tagId: string) {
    setTasks((prev) => prev.map((x) => x.id === taskId ? { ...x, tagIds: x.tagIds.filter((id) => id !== tagId) } : x));
    await createClient().from("task_tags").delete().eq("task_id", taskId).eq("tag_id", tagId);
  }

  async function claim(id: string) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, claimedBy: userId } : t));
    await createClient().from("tasks").update({ claimed_by_user_id: userId }).eq("id", id);
  }

  async function unclaim(id: string) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, claimedBy: null } : t));
    await createClient().from("tasks").update({ claimed_by_user_id: null }).eq("id", id);
  }

  void tick;

  // ── Partition tasks ────────────────────────────────────────────────────
  const sharedUnclaimed = tasks.filter((t) => t.isShared && t.claimedBy === null && !t.done);
  // "Mine": tasks I own (and not shared/claimed by someone else) OR tasks I've claimed
  const myTasks = tasks.filter((t) =>
    (t.user_id === userId && !t.isShared) ||
    (t.user_id === userId && t.isShared && (t.claimedBy === null || t.claimedBy === userId)) ||
    (t.user_id !== userId && t.claimedBy === userId),
  );

  // Other participants' tasks (excluding me, excluding shared-unclaimed which is in its own bucket)
  const othersByUser = new Map<string, LiveTask[]>();
  for (const t of tasks) {
    if (t.user_id === userId) continue;
    // Skip shared-unclaimed (lives in shared bucket)
    if (t.isShared && t.claimedBy === null) continue;
    // Skip tasks I've claimed (those are in myTasks)
    if (t.claimedBy === userId) continue;
    const ownerId = t.claimedBy ?? t.user_id;
    if (!othersByUser.has(ownerId)) othersByUser.set(ownerId, []);
    othersByUser.get(ownerId)!.push(t);
  }

  const stillLive = block.start_time && block.end_time
    ? isWithinTimeRange(block.start_time, block.end_time)
    : true;

  // Progress + elapsed helpers for the header + section counters.
  const myDone = myTasks.filter((t) => t.done).length;
  const totalDone = tasks.filter((t) => t.done).length;
  function timeToMin(t: string | null | undefined): number {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  }
  const startMin = timeToMin(block.start_time);
  const endMin = timeToMin(block.end_time);
  const totalMin = Math.max(1, endMin - startMin);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const elapsedMin = Math.max(0, Math.min(totalMin, nowMin - startMin));
  const remainingMin = Math.max(0, totalMin - elapsedMin);
  const pct = Math.min(100, Math.round((elapsedMin / totalMin) * 100));

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-32">
      {/* Header */}
      <div className="rounded-2xl overflow-hidden mb-4 shadow-lg" style={{ background: "var(--purple)" }}>
        <div className="px-4 py-4 text-white">
          <div className="flex items-center justify-between mb-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              {stillLive ? "LIVE" : "BLOCK ENDED"}
            </span>
            <span className="text-xs opacity-80 tabular-nums">
              {block.start_time?.slice(0, 5)} – {block.end_time?.slice(0, 5)}
            </span>
          </div>
          <h1 className="text-xl font-bold">{block.name}</h1>
          {participants.length > 1 && (
            <div className="flex items-center gap-1.5 mt-2">
              {participants.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(255,255,255,0.15)" }}
                >
                  <span>{p.avatar ?? "🙂"}</span>
                  <span>{p.username}</span>
                </span>
              ))}
            </div>
          )}

          {/* Elapsed timer + progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] opacity-90 tabular-nums mb-1">
              <span>
                {stillLive
                  ? `${elapsedMin} of ${totalMin} min in`
                  : `${totalMin} of ${totalMin} min — done`}
              </span>
              <span>
                {stillLive ? `${remainingMin} min left` : "wrap it up"}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.2)" }}>
              <div
                className="h-full transition-all"
                style={{ width: `${pct}%`, background: "white" }}
              />
            </div>
          </div>

          {/* Celebratory tally — grows as tasks are completed */}
          {totalDone > 0 && (
            <div className="mt-3 text-sm font-semibold flex items-center gap-1.5">
              <span aria-hidden>🎉</span>
              <span>
                You&apos;ve completed {totalDone} {totalDone === 1 ? "task" : "tasks"} in this block!
              </span>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex justify-center pt-12">
          <div
            className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
          />
        </div>
      )}

      {/* Shared / claimable tasks */}
      {!loading && sharedUnclaimed.length > 0 && (
        <section className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2 px-1" style={{ color: "var(--purple)" }}>
            Up for grabs ({sharedUnclaimed.length})
          </h2>
          <div
            className="rounded-2xl border-2 border-dashed p-3 space-y-1"
            style={{ borderColor: "var(--purple)", background: "rgba(124,58,237,0.04)" }}
          >
            {sharedUnclaimed.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl"
                style={{ background: "var(--surface)" }}
              >
                <span className="text-sm flex-1 break-words" style={{ color: "var(--text)" }}>{t.text}</span>
                <button
                  onClick={() => claim(t.id)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: "var(--purple)", color: "white" }}
                >
                  Claim
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My tasks */}
      {!loading && (
        <section className="mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2 px-1 flex items-center gap-2" style={{ color: "var(--text-2)" }}>
            <span>My tasks</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full tabular-nums"
              style={{ background: "rgba(124,58,237,0.12)", color: "var(--purple)" }}
            >
              {myDone}/{myTasks.length} done
            </span>
          </h2>
          <TaskSection
            tasks={myTasks}
            allTags={allTags}
            elapsed={elapsed}
            onToggle={toggleDone}
            onStart={startTimer}
            onStop={stopTimer}
            onUnclaim={unclaim}
            onEdit={(id, current) => { setEditingId(id); setEditingText(current); }}
            onToggleShared={toggleShared}
            onTogglePrivate={togglePrivate}
            onRemoveFromBlock={removeFromBlock}
            onRemoveTag={removeTagFromTask}
            onSaveEdit={saveEdit}
            onCancelEdit={() => setEditingId(null)}
            editingId={editingId}
            editingText={editingText}
            onEditingTextChange={setEditingText}
            editInputRef={editInputRef}
            currentUserId={userId}
          />
          {/* Inline quick-add so anyone in the block (not just the host) can
              drop tasks in for themselves. Tags parsed from #hashtags. */}
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newTaskInput}
              onChange={(e) => setNewTaskInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMyTaskToBlock(); } }}
              placeholder="Add a task to this block… (try #category)"
              className="flex-1 text-sm rounded-xl px-3 py-2 focus:outline-none border"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border-2)",
                color: "var(--text)",
                fontSize: "16px",
              }}
            />
            <button
              type="button"
              onClick={addMyTaskToBlock}
              disabled={addingTask || !newTaskInput.trim()}
              className="text-sm font-semibold px-3 py-2 rounded-xl text-white disabled:opacity-40"
              style={{ background: "var(--purple)" }}
            >
              {addingTask ? "…" : "Add"}
            </button>
          </div>

          {/* Pull an existing task from your master list into this block */}
          <button
            type="button"
            onClick={showAvailable ? () => setShowAvailable(false) : openAvailable}
            className="w-full text-sm font-medium py-2 rounded-xl border mt-2 flex items-center justify-center gap-1.5 transition-colors"
            style={showAvailable
              ? { borderColor: "var(--purple)", color: "var(--purple)", background: "rgba(124,58,237,0.06)" }
              : { borderColor: "var(--border-3)", color: "var(--text-2)", background: "transparent" }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              style={{ transform: showAvailable ? "rotate(45deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {showAvailable ? "Close" : "Add from my list"}
          </button>

          {showAvailable && (
            <div
              className="rounded-2xl border p-3 space-y-2 mt-2"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={availableSearch}
                  onChange={(e) => setAvailableSearch(e.target.value)}
                  placeholder="Search your list…"
                  className="w-full text-sm rounded-xl pl-8 pr-3 py-2 focus:outline-none border"
                  style={{
                    background: "var(--bg)",
                    borderColor: availableSearch ? "var(--purple)" : "var(--border-2)",
                    color: "var(--text)",
                    fontSize: "16px",
                  }}
                />
              </div>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(() => {
                  const filtered = availableSearch.trim()
                    ? available.filter((t) => t.text.toLowerCase().includes(availableSearch.toLowerCase().trim()))
                    : available;
                  if (available.length === 0) {
                    return (
                      <p className="text-xs text-center py-3" style={{ color: "var(--text-2)" }}>
                        No unassigned open tasks in your list
                      </p>
                    );
                  }
                  if (filtered.length === 0) {
                    return (
                      <p className="text-xs text-center py-3" style={{ color: "var(--text-2)" }}>
                        No tasks match
                      </p>
                    );
                  }
                  return filtered.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => importIntoBlock(t)}
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-opacity hover:opacity-80"
                      style={{ background: "var(--bg)", border: "1px solid var(--border-2)" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--purple)", flexShrink: 0, marginTop: 2 }}>
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm" style={{ color: "var(--text)" }}>{t.text}</span>
                          {t.isPrivate && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--purple)", flexShrink: 0 }}>
                              <rect x="3" y="11" width="18" height="11" rx="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          )}
                        </div>
                        {t.tagIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {t.tagIds.map((tid) => {
                              const tag = allTags.find((tg) => tg.id === tid);
                              if (!tag) return null;
                              const { bg, fg } = tagColor(tag.name);
                              return (
                                <span key={tid} className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>
                                  #{tag.name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </button>
                  ));
                })()}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Each participant's tasks */}
      {!loading && Array.from(othersByUser.entries()).map(([ownerId, ownerTasks]) => {
        const profile = participants.find((p) => p.id === ownerId);
        const ownerDone = ownerTasks.filter((t) => t.done).length;
        return (
          <section key={ownerId} className="mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2 px-1 flex items-center gap-2" style={{ color: "var(--text-2)" }}>
              <span>{profile?.avatar ?? "🙂"}</span>
              <span>{profile?.username ?? "Someone"}</span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full tabular-nums"
                style={{ background: "rgba(124,58,237,0.12)", color: "var(--purple)" }}
              >
                {ownerDone}/{ownerTasks.length} done
              </span>
            </h2>
            <TaskSection
              tasks={ownerTasks}
              allTags={allTags}
              elapsed={elapsed}
              onToggle={undefined}
              onStart={undefined}
              onStop={undefined}
              onUnclaim={undefined}
              currentUserId={userId}
              readonly
            />
          </section>
        );
      })}

      {!loading && tasks.length === 0 && (
        <p className="text-sm text-center py-12" style={{ color: "var(--text-2)" }}>
          This block has no tasks yet.
        </p>
      )}
    </div>
  );
}

function TaskSection({
  tasks,
  allTags,
  elapsed,
  onToggle,
  onStart,
  onStop,
  onUnclaim,
  onEdit,
  onToggleShared,
  onTogglePrivate,
  onRemoveFromBlock,
  onRemoveTag,
  onSaveEdit,
  onCancelEdit,
  editingId,
  editingText,
  onEditingTextChange,
  editInputRef,
  currentUserId,
  readonly = false,
}: {
  tasks: LiveTask[];
  allTags: Tag[];
  elapsed: (t: LiveTask) => number;
  onToggle?: (id: string) => void;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onUnclaim?: (id: string) => void;
  onEdit?: (id: string, currentText: string) => void;
  onToggleShared?: (id: string) => void;
  onTogglePrivate?: (id: string) => void;
  onRemoveFromBlock?: (id: string) => void;
  onRemoveTag?: (taskId: string, tagId: string) => void;
  onSaveEdit?: (id: string) => void;
  onCancelEdit?: () => void;
  editingId?: string | null;
  editingText?: string;
  onEditingTextChange?: (text: string) => void;
  editInputRef?: React.RefObject<HTMLInputElement | null>;
  currentUserId: string;
  readonly?: boolean;
}) {
  const hasHover = useHasHover();

  if (tasks.length === 0) {
    return (
      <p className="text-xs px-3 py-3 rounded-xl border text-center" style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}>
        Nothing yet
      </p>
    );
  }

  function rowContent(t: LiveTask) {
    const e = elapsed(t);
    const running = t.startedAt !== null;
    const isClaimed = t.claimedBy === currentUserId;
    const isEditing = !readonly && editingId === t.id;

    return (
      <div
        className="group flex items-center gap-2.5 px-2 py-2.5 transition-colors"
        style={{
          background: running
            ? "linear-gradient(rgba(124,58,237,0.06), rgba(124,58,237,0.06)), var(--surface)"
            : "var(--surface)",
          opacity: t.done ? 0.55 : 1,
        }}
      >
        {readonly ? (
          <div
            className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
            style={t.done
              ? { background: "var(--purple)", border: "2px solid var(--purple)" }
              : { border: "2px solid var(--border-3)" }}
          >
            {t.done && (
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        ) : (
          <button
            onClick={() => onToggle?.(t.id)}
            className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors"
            style={t.done
              ? { background: "var(--purple)", border: "2px solid var(--purple)" }
              : { border: `2px solid ${running ? "var(--purple)" : "var(--border-3)"}` }}
            aria-label={t.done ? "Mark not done" : "Mark done"}
          >
            {t.done && (
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        )}

        <Inner
          t={t}
          allTags={allTags}
          isClaimed={isClaimed}
          hasHover={hasHover}
          readonly={readonly}
          isEditing={isEditing && !!onSaveEdit && !!onCancelEdit && !!onEditingTextChange}
          editingText={editingText ?? ""}
          editInputRef={editInputRef}
          onClickText={!readonly && onEdit ? () => onEdit(t.id, t.text) : undefined}
          onRemoveTag={!readonly && onRemoveTag ? (tagId) => onRemoveTag(t.id, tagId) : undefined}
          onEditingTextChange={onEditingTextChange}
          onSaveEdit={onSaveEdit ? () => onSaveEdit(t.id) : undefined}
          onCancelEdit={onCancelEdit}
        />
        {isEditing && onCancelEdit && (
          <button onClick={onCancelEdit} className="text-xs flex-shrink-0 px-1" style={{ color: "var(--text-2)" }}>
            ✕
          </button>
        )}

        {!isEditing && !readonly && isClaimed && onUnclaim && (
          <button
            onClick={() => onUnclaim(t.id)}
            className="text-xs px-2 py-1 rounded-full font-medium transition-opacity hover:opacity-100"
            style={{ background: "var(--surface-2)", color: "var(--text-2)", opacity: 0.7 }}
          >
            Release
          </button>
        )}

        {/* Share toggle — always visible with a circular purple chip like
            the padlock. Solid purple + white icon when shared, light purple
            tint bg + purple-light icon when not. */}
        {!isEditing && !readonly && onToggleShared && (
          <button
            onClick={() => onToggleShared(t.id)}
            className="w-6 h-6 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
            style={t.isShared
              ? { background: "var(--purple)", color: "white" }
              : { background: "rgba(124,58,237,0.10)", color: "var(--purple-light)" }}
            title={t.isShared ? "Currently shared — tap to unshare" : "Make shareable"}
            aria-label={t.isShared ? "Unshare task" : "Share task"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
        )}

        {!isEditing && !readonly && hasHover && onRemoveFromBlock && (
          <MoreMenu
            items={[
              {
                label: "Remove from block",
                destructive: true,
                onClick: () => onRemoveFromBlock(t.id),
                icon: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                    <line x1="9" y1="16" x2="15" y2="16" />
                  </svg>
                ),
              },
            ]}
          />
        )}

        {!isEditing && !t.done && (e > 0 || running) && (
          <span
            className="text-xs font-mono w-10 text-right flex-shrink-0 tabular-nums"
            style={{ color: running ? "var(--purple)" : "var(--text-2)" }}
          >
            {formatTime(e)}
          </span>
        )}

        {!isEditing && !readonly && !t.done && (
          <button
            onClick={() => running ? onStop?.(t.id) : onStart?.(t.id)}
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
            style={running ? { background: "var(--purple)" } : { background: "var(--border-2)" }}
            title={running ? "Stop timer" : "Start timer"}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={running ? "white" : "var(--text-2)"} strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
        )}

        {!isEditing && t.done && (
          <span className="text-xs font-mono flex-shrink-0 tabular-nums" style={{ color: "var(--text-2)" }}>
            {formatTime(t.timeSpent)}
          </span>
        )}

        {!isEditing && !readonly && onTogglePrivate && (
          <button
            onClick={() => onTogglePrivate(t.id)}
            className="p-1 rounded flex-shrink-0 transition-opacity hover:opacity-100"
            style={{ color: t.isPrivate ? "var(--purple)" : "var(--text-3)", opacity: t.isPrivate ? 1 : 0.5 }}
            title={t.isPrivate ? "Private — tap to make public" : "Public — tap to make private"}
            aria-label={t.isPrivate ? "Make public" : "Make private"}
          >
            {t.isPrivate ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-2 space-y-1"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {tasks.map((t) => {
        const isEditing = !readonly && editingId === t.id;
        if (readonly || isEditing || !onEdit || !onToggleShared || !onRemoveFromBlock) {
          return <div key={t.id} className="rounded-xl overflow-hidden">{rowContent(t)}</div>;
        }
        return (
          <SwipeableRow
            key={t.id}
            leftActions={[
              {
                label: "Edit",
                icon: SwipeIcons.Edit,
                bg: SwipeColors.edit,
                onClick: () => onEdit(t.id, t.text),
              },
              {
                label: t.isShared ? "Unshare" : "Share",
                icon: t.isShared ? SwipeIcons.Unshare : SwipeIcons.Share,
                bg: SwipeColors.share,
                onClick: () => onToggleShared(t.id),
              },
            ]}
            rightActions={[{
              label: "Off block",
              icon: SwipeIcons.RemoveFromDay,
              bg: SwipeColors.remove,
              onClick: () => onRemoveFromBlock(t.id),
            }]}
          >
            {rowContent(t)}
          </SwipeableRow>
        );
      })}
    </div>
  );
}

function Inner({
  t,
  allTags,
  isClaimed,
  hasHover,
  readonly,
  isEditing,
  editingText,
  editInputRef,
  onClickText,
  onRemoveTag,
  onEditingTextChange,
  onSaveEdit,
  onCancelEdit,
}: {
  t: LiveTask;
  allTags: Tag[];
  isClaimed: boolean;
  hasHover: boolean;
  readonly: boolean;
  isEditing: boolean;
  editingText: string;
  editInputRef?: React.RefObject<HTMLInputElement | null>;
  onClickText?: () => void;
  onRemoveTag?: (tagId: string) => void;
  onEditingTextChange?: (text: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        {isEditing && onEditingTextChange && onSaveEdit ? (
          <input
            ref={editInputRef}
            autoFocus
            className="flex-1 min-w-0 text-sm bg-transparent focus:outline-none border-b"
            style={{ borderColor: "var(--purple)", color: "var(--text)" }}
            value={editingText}
            onChange={(ev) => onEditingTextChange(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") { ev.preventDefault(); onSaveEdit(); }
              if (ev.key === "Escape") { ev.preventDefault(); onCancelEdit?.(); }
            }}
            // Defer so TagChip × click can fire before edit mode exits.
            onBlur={() => setTimeout(() => onSaveEdit(), 180)}
          />
        ) : readonly || !onClickText ? (
          <span
            className="text-sm break-words"
            style={{
              color: "var(--text)",
              textDecoration: t.done ? "line-through" : "none",
            }}
          >
            {t.text}
          </span>
        ) : (
          <button
            type="button"
            onClick={onClickText}
            className="text-sm break-words text-left cursor-text"
            style={{
              color: "var(--text)",
              textDecoration: t.done ? "line-through" : "none",
            }}
            aria-label="Edit task"
          >
            {t.text}
          </button>
        )}
        {t.isShared && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(5,150,105,0.12)", color: "#059669" }}>
            shared
          </span>
        )}
        {isClaimed && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(124,58,237,0.12)", color: "var(--purple)" }}>
            yours
          </span>
        )}
      </div>
      {t.tagIds.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {t.tagIds.map((tid) => {
            const tag = allTags.find((tg) => tg.id === tid);
            if (!tag) return null;
            if (onRemoveTag) {
              return (
                <TagChip
                  key={tid}
                  tag={tag}
                  hasHover={hasHover}
                  forceVisible={isEditing}
                  onRemove={() => onRemoveTag(tid)}
                />
              );
            }
            const { bg, fg } = tagColor(tag.name);
            return (
              <span key={tid} className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>
                #{tag.name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}


