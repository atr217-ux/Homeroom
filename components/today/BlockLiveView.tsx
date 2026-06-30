"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatTime, isWithinTimeRange } from "@/lib/utils/date";
import { tagColor } from "@/lib/utils/tags";
import SwipeableRow, { SwipeIcons, SwipeColors } from "@/components/SwipeableRow";
import TagChip from "@/components/TagChip";
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
    const next = editingText.trim();
    if (!next) { setEditingId(null); return; }
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, text: next } : t));
    setEditingId(null);
    await createClient().from("tasks").update({ text: next }).eq("id", id);
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
            <span className="text-xs opacity-80">
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
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-2 px-1" style={{ color: "var(--text-2)" }}>
            My tasks ({myTasks.length})
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
        </section>
      )}

      {/* Each participant's tasks */}
      {!loading && Array.from(othersByUser.entries()).map(([ownerId, ownerTasks]) => {
        const profile = participants.find((p) => p.id === ownerId);
        return (
          <section key={ownerId} className="mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2 px-1 flex items-center gap-1.5" style={{ color: "var(--text-2)" }}>
              <span>{profile?.avatar ?? "🙂"}</span>
              <span>{profile?.username ?? "Someone"} ({ownerTasks.length})</span>
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
        className="flex items-center gap-2.5 px-2 py-2.5 transition-colors"
        style={{
          background: running ? "rgba(124,58,237,0.05)" : "var(--surface)",
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

        {!isEditing && !readonly && hasHover && onToggleShared && (
          <button
            onClick={() => onToggleShared(t.id)}
            className="p-1 rounded transition-opacity hover:opacity-100 flex-shrink-0"
            style={{ color: t.isShared ? "#059669" : "var(--text-2)", opacity: t.isShared ? 1 : 0.35 }}
            title={t.isShared ? "Currently shared — tap to unshare" : "Make shareable"}
          >
            {t.isShared ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="12" r="3" />
                <line x1="5" y1="5" x2="19" y2="19" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="12" r="3" />
                <circle cx="17" cy="6" r="3" />
                <circle cx="17" cy="18" r="3" />
                <line x1="11.6" y1="10.6" x2="14.4" y2="7.4" />
                <line x1="11.6" y1="13.4" x2="14.4" y2="16.6" />
              </svg>
            )}
          </button>
        )}
        {!isEditing && !readonly && hasHover && onRemoveFromBlock && (
          <button
            onClick={() => onRemoveFromBlock(t.id)}
            className="p-1 rounded transition-opacity hover:opacity-100 flex-shrink-0"
            style={{ color: "var(--text-2)", opacity: 0.35 }}
            title="Remove from block"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="9" y1="16" x2="15" y2="16" />
            </svg>
          </button>
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
            leftActions={[{
              label: t.isShared ? "Unshare" : "Share",
              icon: t.isShared ? SwipeIcons.Unshare : SwipeIcons.Share,
              bg: SwipeColors.share,
              onClick: () => onToggleShared(t.id),
            }]}
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
            onBlur={() => onSaveEdit()}
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


