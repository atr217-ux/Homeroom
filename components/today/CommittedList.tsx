"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addedAtLabel, dateKey, formatTime } from "@/lib/utils/date";
import { getOrCreateTag, parseHashtags, stripHashtags, tagColor } from "@/lib/utils/tags";
import TaskInput from "@/components/TaskInput";
import SwipeableRow, { SwipeIcons, SwipeColors } from "@/components/SwipeableRow";
import TagChip from "@/components/TagChip";
import MoreMenu from "@/components/MoreMenu";
import { useHasHover } from "@/lib/hooks/useHasHover";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Tag } from "@/lib/db/types";

type CommittedTask = {
  id: string;
  text: string;
  done: boolean;
  isPrivate: boolean;
  timeSpent: number;
  startedAt: number | null;
  tagIds: string[];
  sortOrder: number;
  createdAt: string;
};

type Props = {
  userId: string;
  onOpenSchedule: () => void;
};

type AvailableTask = {
  id: string;
  text: string;
  isPrivate: boolean;
  tagIds: string[];
  createdAt: string;
};

export default function CommittedList({ userId, onOpenSchedule }: Props) {
  const [tasks, setTasks] = useState<CommittedTask[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [tick, setTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // ── Available (master-list) tasks for the "From my list" panel ─────────
  const [available, setAvailable] = useState<AvailableTask[]>([]);
  const [showAvailable, setShowAvailable] = useState(false);
  const [availableSearch, setAvailableSearch] = useState("");

  // ── Tag filter ─────────────────────────────────────────────────────────
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // ── Daily commitment ───────────────────────────────────────────────────
  const [commitment, setCommitment] = useState("");
  const [editingCommitment, setEditingCommitment] = useState(false);
  const commitmentInputRef = useRef<HTMLTextAreaElement>(null);

  function autoGrowCommitment() {
    const el = commitmentInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (editingCommitment) autoGrowCommitment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCommitment, commitment]);

  const hasHover = useHasHover();

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // ── Load ───────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const today = dateKey(new Date());
      const [tasksRes, tagsRes, commitmentRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, text, done, is_private, time_spent, timer_started_at, sort_order, created_at, task_tags(tag_id)")
          .eq("user_id", userId)
          .eq("committed_for_date", today)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),
        supabase.from("tags").select("id, name").eq("user_id", userId).order("name"),
        supabase
          .from("daily_commitments")
          .select("commitment")
          .eq("user_id", userId)
          .eq("date", today)
          .maybeSingle(),
      ]);

      setTasks((tasksRes.data ?? []).map((r, i) => ({
        id: r.id as string,
        text: r.text as string,
        done: r.done as boolean,
        isPrivate: (r.is_private as boolean) ?? false,
        timeSpent: (r.time_spent as number) ?? 0,
        startedAt: r.timer_started_at ? new Date(r.timer_started_at as string).getTime() : null,
        tagIds: ((r.task_tags as { tag_id: string }[] | null) ?? []).map((tt) => tt.tag_id),
        sortOrder: (r.sort_order as number | null) ?? i * 10,
        createdAt: r.created_at as string,
      })));
      setAllTags((tagsRes.data ?? []) as Tag[]);
      setCommitment((commitmentRes.data as { commitment: string } | null)?.commitment ?? "");
      setLoading(false);
    }
    load();
    const ticker = setInterval(() => setTick((t) => t + 1), 1000);

    function onOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);

    return () => {
      clearInterval(ticker);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [userId]);

  // ── Load available tasks (master list, excluding ones already in today) ─
  async function loadAvailable() {
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .select("id, text, is_private, created_at, task_tags(tag_id)")
      .eq("user_id", userId)
      .eq("done", false)
      .order("created_at", { ascending: false })
      .limit(200);
    const inTodayIds = new Set(tasks.map((t) => t.id));
    setAvailable(((data ?? []) as { id: string; text: string; is_private: boolean | null; created_at: string; task_tags: { tag_id: string }[] | null }[])
      .filter((r) => !inTodayIds.has(r.id))
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

  async function importTask(av: AvailableTask) {
    const today = dateKey(new Date());
    const supabase = createClient();
    // Optimistic: move from `available` to `tasks` immediately
    setAvailable((prev) => prev.filter((t) => t.id !== av.id));
    const maxOrder = tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    setTasks((prev) => [...prev, {
      id: av.id,
      text: av.text,
      done: false,
      isPrivate: av.isPrivate,
      timeSpent: 0,
      startedAt: null,
      tagIds: av.tagIds,
      sortOrder: maxOrder + 10,
      createdAt: av.createdAt,
    }]);
    await supabase
      .from("tasks")
      .update({ committed_for_date: today, sort_order: maxOrder + 10 })
      .eq("id", av.id);
  }

  function elapsed(t: CommittedTask): number {
    return t.startedAt === null ? t.timeSpent : t.timeSpent + Math.floor((Date.now() - t.startedAt) / 1000);
  }

  // ── Mutations ──────────────────────────────────────────────────────────
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

  async function togglePrivate(id: string) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const next = !t.isPrivate;
    setTasks((prev) => prev.map((x) => x.id === id ? { ...x, isPrivate: next } : x));
    await createClient().from("tasks").update({ is_private: next }).eq("id", id);
  }

  async function removeTagFromTask(taskId: string, tagId: string) {
    setTasks((prev) => prev.map((x) => x.id === taskId ? { ...x, tagIds: x.tagIds.filter((id) => id !== tagId) } : x));
    await createClient().from("task_tags").delete().eq("task_id", taskId).eq("tag_id", tagId);
  }

  async function saveCommitment(next: string) {
    const trimmed = next.trim();
    const today = dateKey(new Date());
    setCommitment(trimmed);
    await createClient().from("daily_commitments").upsert({
      user_id: userId,
      date: today,
      commitment: trimmed,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,date" });
  }

  // ── Drag-to-reorder ─────────────────────────────────────────────────────
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const undoneTasks = tasks.filter((t) => !t.done);
    const oldIndex = undoneTasks.findIndex((t) => t.id === active.id);
    const newIndex = undoneTasks.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(undoneTasks, oldIndex, newIndex);
    // Reassign sort_order with spacing so future inserts have room
    const updates = reordered.map((t, i) => ({ id: t.id, sortOrder: i * 10 }));
    const updatedMap = new Map(updates.map((u) => [u.id, u.sortOrder]));

    setTasks((prev) =>
      prev.map((t) => (updatedMap.has(t.id) ? { ...t, sortOrder: updatedMap.get(t.id)! } : t))
        .sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1;
          return a.sortOrder - b.sortOrder;
        }),
    );

    const supabase = createClient();
    void Promise.all(updates.map((u) => supabase.from("tasks").update({ sort_order: u.sortOrder }).eq("id", u.id)));
  }

  // Remove from today only — task stays in your master list
  async function removeFromToday(id: string) {
    const t = tasks.find((x) => x.id === id);
    setTasks((prev) => prev.filter((x) => x.id !== id));
    await createClient().from("tasks").update({ committed_for_date: null }).eq("id", id);
    // If the available panel is open, surface this task there
    if (showAvailable && t) {
      setAvailable((prev) => [
        { id: t.id, text: t.text, isPrivate: t.isPrivate, tagIds: t.tagIds, createdAt: t.createdAt },
        ...prev,
      ]);
    }
  }

  // Hard delete — removes from DB entirely
  async function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await createClient().from("tasks").delete().eq("id", id);
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
    setAllTags((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      for (const t of tagObjs) map.set(t.id, t);
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  // ── Add an extra task to today ─────────────────────────────────────────
  async function addQuickTask() {
    const raw = input.trim();
    if (!raw) return;
    const tagNames = parseHashtags(raw);
    const text = stripHashtags(raw);
    if (!text) return;
    setInput("");

    const today = dateKey(new Date());
    const maxOrder = tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        text,
        done: false,
        committed_for_date: today,
        sort_order: maxOrder + 10,
      })
      .select("id, created_at")
      .single();
    if (!data) return;

    const tagObjs = (await Promise.all(tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
    if (tagObjs.length > 0) {
      await supabase.from("task_tags").insert(tagObjs.map((t) => ({ task_id: data.id, tag_id: t.id })));
    }
    setTasks((prev) => [...prev, {
      id: data.id as string,
      text,
      done: false,
      isPrivate: false,
      timeSpent: 0,
      startedAt: null,
      tagIds: tagObjs.map((t) => t.id),
      sortOrder: maxOrder + 10,
      createdAt: data.created_at as string,
    }]);
    setAllTags((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      for (const t of tagObjs) map.set(t.id, t);
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  void tick;

  const tagMatches = (t: CommittedTask) =>
    tagFilters.length === 0 || tagFilters.some((id) => t.tagIds.includes(id));
  const undone = tasks.filter((t) => !t.done && tagMatches(t));
  const done = tasks.filter((t) => t.done && tagMatches(t));
  const usedTagIds = Array.from(new Set(tasks.flatMap((t) => t.tagIds)));
  const today = new Date();

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-32">
      {/* Header */}
      <div className="pb-5 flex items-end justify-between">
        <div>
          <h1
            className="font-display italic leading-none"
            style={{ color: "var(--text)", fontSize: "clamp(3rem, 12vw, 4.5rem)" }}
          >
            {today.toLocaleDateString(undefined, { weekday: "long" })}{" "}
            <span className="tabular-nums" style={{ color: "var(--text)", fontSize: "0.7em" }}>
              {String(today.getMonth() + 1).padStart(2, "0")}/{String(today.getDate()).padStart(2, "0")}
            </span>
          </h1>
        </div>
        {tasks.length > 0 && (
          <span
            className="text-sm font-semibold px-3 py-1 rounded-full mb-1"
            style={{
              background: done.length === tasks.length ? "rgba(124,58,237,0.15)" : "rgba(124,58,237,0.08)",
              color: "var(--purple)",
            }}
          >
            {done.length}/{tasks.length} done
          </span>
        )}
      </div>

      {/* Daily commitment / focus */}
      {!loading && (
        <div className="mb-5">
          {editingCommitment ? (
            <>
              <textarea
                ref={commitmentInputRef}
                autoFocus
                rows={1}
                value={commitment}
                onChange={(e) => { setCommitment(e.target.value); autoGrowCommitment(); }}
                onBlur={() => { saveCommitment(commitment); setEditingCommitment(false); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
                  if (e.key === "Escape") { e.preventDefault(); setEditingCommitment(false); }
                }}
                maxLength={80}
                placeholder="Today's focus…"
                className="focus-input-purple w-full text-base font-medium rounded-xl px-3 py-2.5 focus:outline-none border transition-colors resize-none overflow-hidden"
                style={{
                  background: "var(--surface)",
                  borderColor: "var(--purple)",
                  color: "var(--text)",
                  fontSize: "16px",
                  lineHeight: 1.4,
                }}
              />
              <div className="text-[11px] text-right mt-1 tabular-nums" style={{ color: "var(--text-3)" }}>
                {commitment.length}/80
              </div>
            </>
          ) : commitment ? (
            <button
              type="button"
              onClick={() => setEditingCommitment(true)}
              className="w-full text-left rounded-xl px-3 py-2.5 border transition-colors"
              style={{
                background: "linear-gradient(rgba(124,58,237,0.06), rgba(124,58,237,0.06)), var(--surface)",
                borderColor: "rgba(124,58,237,0.25)",
              }}
              aria-label="Edit today's focus"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide block mb-0.5" style={{ color: "var(--purple)" }}>
                Focus
              </span>
              <span className="text-sm" style={{ color: "var(--text)" }}>{commitment}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditingCommitment(true)}
              className="w-full text-sm font-medium rounded-xl px-3 py-2.5 border border-dashed flex items-center gap-2 transition-colors"
              style={{ borderColor: "rgba(124,58,237,0.35)", color: "var(--purple)", background: "transparent" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Declare today&apos;s focus
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="flex justify-center pt-12">
          <div
            className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
          />
        </div>
      )}

      {/* Tag filter */}
      {!loading && tasks.length > 0 && usedTagIds.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div ref={tagDropdownRef} className="relative">
            <button
              onClick={() => setTagDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-colors"
              style={tagFilters.length > 0
                ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="8" y1="12" x2="16" y2="12" />
                <line x1="11" y1="18" x2="13" y2="18" />
              </svg>
              {tagFilters.length > 0 ? `${tagFilters.length} tag${tagFilters.length > 1 ? "s" : ""}` : "Filter by tag"}
              {tagFilters.length > 0 && (
                <span onClick={(e) => { e.stopPropagation(); setTagFilters([]); }} className="ml-1 opacity-70">×</span>
              )}
            </button>
            {tagDropdownOpen && (
              <div
                className="absolute left-0 top-full mt-1 z-20 border rounded-xl shadow-md overflow-hidden min-w-[180px] max-h-72 overflow-y-auto"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                {usedTagIds.map((tid) => {
                  const tag = allTags.find((tg) => tg.id === tid);
                  if (!tag) return null;
                  const { bg, fg } = tagColor(tag.name);
                  const checked = tagFilters.includes(tid);
                  return (
                    <button
                      key={tid}
                      onClick={() => setTagFilters((prev) => checked ? prev.filter((i) => i !== tid) : [...prev, tid])}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
                      style={{ background: "var(--surface)" }}
                    >
                      <span
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2"
                        style={checked
                          ? { background: "var(--purple)", borderColor: "var(--purple)" }
                          : { borderColor: "var(--border-3)" }}
                      >
                        {checked && (
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5">
                            <polyline points="2 6 5 9 10 3" />
                          </svg>
                        )}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>
                        #{tag.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {tagFilters.length > 0 && (
            <span className="text-xs" style={{ color: "var(--text-2)" }}>
              {undone.length + done.length} of {tasks.length}
            </span>
          )}
        </div>
      )}

      {/* Task block */}
      {!loading && (
        <div
          className="rounded-2xl border overflow-hidden mb-4"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="h-1 w-full" style={{ background: "var(--purple)" }} />

          <div className="p-3">
            {tasks.length === 0 && (
              <p className="text-sm text-center py-4" style={{ color: "var(--text-2)" }}>
                No tasks committed yet — add one below.
              </p>
            )}

            {/* Undone */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={undone.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {undone.map((t) => {
                    const e = elapsed(t);
                    const running = t.startedAt !== null;
                    const isEditing = editingId === t.id;
                    return (
                  <SortableTaskRow
                    key={t.id}
                    id={t.id}
                    disabled={isEditing || tagFilters.length > 0}
                  >
                    {(dragListeners, isDragging) => (
                  <SwipeableRow
                    key={t.id}
                    leftActions={isEditing ? [] : [{
                      label: "Edit",
                      icon: SwipeIcons.Edit,
                      bg: SwipeColors.edit,
                      onClick: () => { setEditingId(t.id); setEditingText(t.text); },
                    }]}
                    rightActions={isEditing ? [] : [
                      {
                        label: "Off today",
                        icon: SwipeIcons.RemoveFromDay,
                        bg: SwipeColors.remove,
                        onClick: () => removeFromToday(t.id),
                      },
                      {
                        label: "Delete",
                        icon: SwipeIcons.Trash,
                        bg: SwipeColors.delete,
                        onClick: () => deleteTask(t.id),
                      },
                    ]}
                  >
                    <div
                      className="group flex items-center gap-2.5 px-2 py-2.5 transition-colors"
                      style={{
                        background: running
                          ? "linear-gradient(rgba(124,58,237,0.06), rgba(124,58,237,0.06)), var(--surface)"
                          : "var(--surface)",
                      }}
                    >
                      {/* Drag handle (hidden when filtering or editing) */}
                      {!isEditing && tagFilters.length === 0 && (
                        <button
                          {...dragListeners}
                          className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none p-0.5 -ml-1"
                          style={{ color: "var(--text-3)", opacity: 0.5 }}
                          aria-label="Drag to reorder"
                          title="Drag to reorder"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="6" r="1.5" />
                            <circle cx="9" cy="12" r="1.5" />
                            <circle cx="9" cy="18" r="1.5" />
                            <circle cx="15" cy="6" r="1.5" />
                            <circle cx="15" cy="12" r="1.5" />
                            <circle cx="15" cy="18" r="1.5" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => toggleDone(t.id)}
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors"
                        style={{ border: `2px solid ${running ? "var(--purple)" : "var(--border-3)"}` }}
                        aria-label="Mark done"
                      />
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            autoFocus
                            className="w-full text-sm bg-transparent focus:outline-none border-b"
                            style={{ borderColor: "var(--purple)", color: "var(--text)" }}
                            value={editingText}
                            onChange={(ev) => setEditingText(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") { ev.preventDefault(); saveEdit(t.id); }
                              if (ev.key === "Escape") { ev.preventDefault(); setEditingId(null); }
                            }}
                            // Defer save so a click on a tag X (which blurs the
                            // input first) can fire before this row unmounts.
                            onBlur={() => {
                              const id = t.id;
                              setTimeout(() => {
                                if (editingId === id) saveEdit(id);
                              }, 180);
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setEditingId(t.id); setEditingText(t.text); }}
                            className="text-sm break-words text-left w-full cursor-text"
                            style={{ color: "var(--text)" }}
                            aria-label="Edit task"
                          >
                            {t.text}
                          </button>
                        )}
                        {t.tagIds.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            {t.tagIds.map((tid) => {
                              const tag = allTags.find((tg) => tg.id === tid);
                              if (!tag) return null;
                              return (
                                <TagChip
                                  key={tid}
                                  tag={tag}
                                  hasHover={hasHover}
                                  forceVisible={isEditing}
                                  onRemove={() => removeTagFromTask(t.id, tid)}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {isEditing ? (
                        <button onClick={() => setEditingId(null)} className="text-xs flex-shrink-0 px-1" style={{ color: "var(--text-2)" }}>
                          ✕
                        </button>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="text-xs font-mono w-10 text-right tabular-nums"
                              style={{ color: running ? "var(--purple)" : "var(--text-2)", opacity: e > 0 || running ? 1 : 0 }}
                            >
                              {formatTime(e)}
                            </span>
                            <button
                              onClick={() => running ? stopTimer(t.id) : startTimer(t.id)}
                              className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                              style={running ? { background: "var(--purple)" } : { background: "var(--border-2)" }}
                              title={running ? "Stop timer" : "Start timer"}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={running ? "white" : "var(--text-2)"} strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                              </svg>
                            </button>
                            <button
                              onClick={() => togglePrivate(t.id)}
                              className="p-1 rounded transition-opacity hover:opacity-100"
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
                            {hasHover && (
                              <MoreMenu
                                items={[
                                  {
                                    label: "Remove from today",
                                    onClick: () => removeFromToday(t.id),
                                    icon: (
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="4" width="18" height="18" rx="2" />
                                        <line x1="3" y1="10" x2="21" y2="10" />
                                        <line x1="9" y1="16" x2="15" y2="16" />
                                      </svg>
                                    ),
                                  },
                                  {
                                    label: "Delete",
                                    destructive: true,
                                    onClick: () => deleteTask(t.id),
                                    icon: (
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                        <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                                      </svg>
                                    ),
                                  },
                                ]}
                              />
                            )}
                          </div>
                          <span
                            className="text-xs whitespace-nowrap pr-1"
                            style={{ color: "var(--text-3)" }}
                            title={new Date(t.createdAt).toLocaleString()}
                          >
                            {addedAtLabel(t.createdAt)}
                          </span>
                        </div>
                      )}
                    </div>
                  </SwipeableRow>
                    )}
                  </SortableTaskRow>
                );
                  })}
                </div>
              </SortableContext>
            </DndContext>

            {/* Done */}
            {done.length > 0 && (
              <div className="space-y-1 border-t pt-2 mt-2" style={{ borderColor: "var(--border-2)" }}>
                {done.map((t) => (
                  <SwipeableRow
                    key={t.id}
                    rightActions={[
                      {
                        label: "Off today",
                        icon: SwipeIcons.RemoveFromDay,
                        bg: SwipeColors.remove,
                        onClick: () => removeFromToday(t.id),
                      },
                      {
                        label: "Delete",
                        icon: SwipeIcons.Trash,
                        bg: SwipeColors.delete,
                        onClick: () => deleteTask(t.id),
                      },
                    ]}
                  >
                    <div className="group flex items-center gap-2.5 px-2 py-2.5 opacity-55" style={{ background: "var(--surface)" }}>
                      <button
                        onClick={() => toggleDone(t.id)}
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                        style={{ background: "var(--purple)", border: "2px solid var(--purple)" }}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                      </button>
                      <span className="text-sm flex-1 min-w-0 line-through" style={{ color: "var(--text-2)" }}>{t.text}</span>
                      <span className="text-xs font-mono flex-shrink-0 tabular-nums" style={{ color: "var(--text-2)" }}>
                        {formatTime(t.timeSpent)}
                      </span>
                      {hasHover && (
                        <MoreMenu
                          items={[
                            {
                              label: "Remove from today",
                              onClick: () => removeFromToday(t.id),
                              icon: (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="4" width="18" height="18" rx="2" />
                                  <line x1="3" y1="10" x2="21" y2="10" />
                                  <line x1="9" y1="16" x2="15" y2="16" />
                                </svg>
                              ),
                            },
                            {
                              label: "Delete",
                              destructive: true,
                              onClick: () => deleteTask(t.id),
                              icon: (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                  <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                                </svg>
                              ),
                            },
                          ]}
                        />
                      )}
                    </div>
                  </SwipeableRow>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick add + from-my-list */}
      {!loading && (
        <div className="mb-3 space-y-2">
          <TaskInput
            value={input}
            onChange={setInput}
            onSubmit={addQuickTask}
            allTags={allTags}
            placeholder="Add another task to today…"
          />

          {/* Toggle: bring in existing tasks from master list */}
          <button
            onClick={showAvailable ? () => setShowAvailable(false) : openAvailable}
            className="w-full text-sm font-medium py-2.5 rounded-2xl border flex items-center justify-center gap-1.5 transition-colors"
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
              className="rounded-2xl border p-3 space-y-2"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              {/* Search */}
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

              {/* List */}
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(() => {
                  const filtered = availableSearch.trim()
                    ? available.filter((t) => t.text.toLowerCase().includes(availableSearch.toLowerCase().trim()))
                    : available;
                  if (available.length === 0) {
                    return (
                      <p className="text-xs text-center py-3" style={{ color: "var(--text-2)" }}>
                        All your tasks are already in today&apos;s list
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
                      onClick={() => importTask(t)}
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
        </div>
      )}

      {/* Schedule a block */}
      {!loading && (
        <button
          onClick={onOpenSchedule}
          className="w-full text-sm font-semibold py-3 rounded-2xl flex items-center justify-center gap-2 transition-colors"
          style={{ background: "var(--purple)", color: "white" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Schedule a block
        </button>
      )}
    </div>
  );
}

function SortableTaskRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (dragListeners: Record<string, unknown> | undefined, isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : "auto",
    position: "relative",
    boxShadow: isDragging ? "0 10px 24px rgba(0,0,0,0.18)" : undefined,
    borderRadius: 12,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(disabled ? undefined : listeners, isDragging)}
    </div>
  );
}

