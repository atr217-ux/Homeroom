"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey, formatTime } from "@/lib/utils/date";
import { getOrCreateTag, parseHashtags, stripHashtags, tagColor } from "@/lib/utils/tags";
import TaskInput from "@/components/TaskInput";
import type { Tag } from "@/lib/db/types";

type CommittedTask = {
  id: string;
  text: string;
  done: boolean;
  isPrivate: boolean;
  timeSpent: number;
  startedAt: number | null;
  tagIds: string[];
};

type Props = {
  userId: string;
  onOpenSchedule: () => void;
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

  // ── Load ───────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const today = dateKey(new Date());
      const [tasksRes, tagsRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, text, done, is_private, time_spent, timer_started_at, task_tags(tag_id)")
          .eq("user_id", userId)
          .eq("committed_for_date", today)
          .order("created_at", { ascending: true }),
        supabase.from("tags").select("id, name").eq("user_id", userId).order("name"),
      ]);

      setTasks((tasksRes.data ?? []).map((r) => ({
        id: r.id as string,
        text: r.text as string,
        done: r.done as boolean,
        isPrivate: (r.is_private as boolean) ?? false,
        timeSpent: (r.time_spent as number) ?? 0,
        startedAt: r.timer_started_at ? new Date(r.timer_started_at as string).getTime() : null,
        tagIds: ((r.task_tags as { tag_id: string }[] | null) ?? []).map((tt) => tt.tag_id),
      })));
      setAllTags((tagsRes.data ?? []) as Tag[]);
      setLoading(false);
    }
    load();
    const ticker = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(ticker);
  }, [userId]);

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

  async function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    // Don't delete from DB — just unset committed_for_date so it goes back to the master list
    await createClient().from("tasks").update({ committed_for_date: null }).eq("id", id);
  }

  async function saveEdit(id: string) {
    const next = editingText.trim();
    if (!next) { setEditingId(null); return; }
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, text: next } : t));
    setEditingId(null);
    await createClient().from("tasks").update({ text: next }).eq("id", id);
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
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        text,
        done: false,
        committed_for_date: today,
      })
      .select("id")
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
    }]);
    setAllTags((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      for (const t of tagObjs) map.set(t.id, t);
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  void tick;

  const undone = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const today = new Date();

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-32">
      {/* Header */}
      <div className="pb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
            {today.toLocaleDateString(undefined, { weekday: "long" })}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-2)" }}>
            {today.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
          </p>
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

      {loading && (
        <div className="flex justify-center pt-12">
          <div
            className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
          />
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
            <div className="space-y-0.5">
              {undone.map((t) => {
                const e = elapsed(t);
                const running = t.startedAt !== null;
                const isEditing = editingId === t.id;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl transition-colors"
                    style={{ background: running ? "rgba(124,58,237,0.05)" : "transparent" }}
                  >
                    <button
                      onClick={() => toggleDone(t.id)}
                      className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors"
                      style={{ border: `2px solid ${running ? "var(--purple)" : "var(--border-3)"}` }}
                      aria-label="Mark done"
                    />
                    {isEditing ? (
                      <>
                        <input
                          ref={editInputRef}
                          autoFocus
                          className="flex-1 text-sm bg-transparent focus:outline-none border-b"
                          style={{ borderColor: "var(--purple)", color: "var(--text)" }}
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); saveEdit(t.id); }
                            if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                          }}
                          onBlur={() => saveEdit(t.id)}
                        />
                        <button onClick={() => setEditingId(null)} className="text-xs flex-shrink-0 px-1" style={{ color: "var(--text-2)" }}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0 flex items-center gap-1.5">
                          <span className="text-sm break-words" style={{ color: "var(--text)" }}>
                            {t.text}
                          </span>
                          {t.isPrivate && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--purple)", flexShrink: 0 }}>
                              <rect x="3" y="11" width="18" height="11" rx="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          )}
                        </div>
                        <button
                          onClick={() => { setEditingId(t.id); setEditingText(t.text); }}
                          className="p-1 rounded transition-opacity hover:opacity-100"
                          style={{ color: "var(--text-2)", opacity: 0.6 }}
                          title="Edit"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteTask(t.id)}
                          className="p-1 rounded transition-opacity hover:opacity-100"
                          style={{ color: "var(--text-2)", opacity: 0.6 }}
                          title="Remove from today"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                          </svg>
                        </button>
                        <span
                          className="text-xs font-mono w-10 text-right flex-shrink-0 tabular-nums"
                          style={{ color: running ? "var(--purple)" : "var(--text-2)", opacity: e > 0 || running ? 1 : 0 }}
                        >
                          {formatTime(e)}
                        </span>
                        <button
                          onClick={() => running ? stopTimer(t.id) : startTimer(t.id)}
                          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                          style={running ? { background: "var(--purple)" } : { background: "var(--border-2)" }}
                          title={running ? "Stop timer" : "Start timer"}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={running ? "white" : "var(--text-2)"} strokeWidth="2.5">
                            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Done */}
            {done.length > 0 && (
              <div className="space-y-0.5 border-t pt-2 mt-2" style={{ borderColor: "var(--border-2)" }}>
                {done.map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl opacity-55">
                    <button
                      onClick={() => toggleDone(t.id)}
                      className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                      style={{ background: "var(--purple)", border: "2px solid var(--purple)" }}
                    >
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                    </button>
                    <span className="text-sm flex-1 min-w-0 line-through" style={{ color: "var(--text-2)" }}>{t.text}</span>
                    <span className="text-xs font-mono flex-shrink-0 tabular-nums mr-1" style={{ color: "var(--text-2)" }}>
                      {formatTime(t.timeSpent)}
                    </span>
                    <button
                      onClick={() => deleteTask(t.id)}
                      className="p-1 rounded transition-opacity hover:opacity-100 flex-shrink-0"
                      style={{ color: "var(--text-2)", opacity: 0.6 }}
                      title="Remove from today"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick add */}
      {!loading && (
        <div className="mb-3">
          <TaskInput
            value={input}
            onChange={setInput}
            onSubmit={addQuickTask}
            allTags={allTags}
            placeholder="Add another task to today…"
          />
        </div>
      )}

      {/* Tag legend */}
      {!loading && tasks.some((t) => t.tagIds.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-3 px-1">
          {Array.from(new Set(tasks.flatMap((t) => t.tagIds))).map((tid) => {
            const tag = allTags.find((t) => t.id === tid);
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
