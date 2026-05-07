"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const INITIAL_LIMIT = 15;
const EXPANDED_LIMIT = 25;

type Task = {
  id: string;
  text: string;
  done: boolean;
  addedAt: string;
  completedAt?: string | null;
  lastSessionTime?: number;
  scheduledForTitle?: string;
  scheduledForDate?: string | null;
  homeroomId?: string | null;
  homeroomStatus?: string | null;
};

type TaskHistory = { text: string; lastSessionTime: number };

function completedLabel(completedAt: string | null | undefined): string {
  if (!completedAt) return "";
  const completed = new Date(completedAt);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const completedStart = new Date(completed.getFullYear(), completed.getMonth(), completed.getDate());
  const diffDays = Math.round((todayStart.getTime() - completedStart.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

function addedAtLabel(addedAt: string): string {
  const added = new Date(addedAt);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addedStart = new Date(added.getFullYear(), added.getMonth(), added.getDate());
  const diffDays = Math.round((todayStart.getTime() - addedStart.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const getWeekStart = (d: Date) => {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    s.setDate(s.getDate() - s.getDay());
    return s;
  };
  const currentWeekStart = getWeekStart(now);
  const addedWeekStart = getWeekStart(added);
  if (addedWeekStart.getTime() === currentWeekStart.getTime()) return "This week";
  const prevWeekStart = new Date(currentWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  if (addedWeekStart.getTime() === prevWeekStart.getTime()) return "Last week";
  const weeksDiff = Math.round((currentWeekStart.getTime() - addedWeekStart.getTime()) / (7 * 86400000));
  return `${weeksDiff} weeks ago`;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  if (sec === 0) return `${m}m`;
  return `${m}m ${sec}s`;
}

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);

const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export default function ListPage() {
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(INITIAL_LIMIT);
  const [sortField, setSortField] = useState<"date" | "time" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [taskHistory, setTaskHistory] = useState<TaskHistory[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const editInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setMyUserId(user.id);
      supabase
        .from("tasks")
        .select("id, text, done, time_spent, created_at, completed_at, homeroom_id")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .then(async ({ data: allTasks }) => {
          const homeroomIds = [...new Set((allTasks ?? []).filter(t => t.homeroom_id).map(t => t.homeroom_id as string))];
          const { data: homeroomsData } = homeroomIds.length
            ? await supabase.from("homerooms").select("id, title, scheduled_for, status").in("id", homeroomIds)
            : { data: [] };
          const hrMap = Object.fromEntries((homeroomsData ?? []).map(h => [h.id, h]));
          setTasks((allTasks ?? []).map(t => {
            const hr = t.homeroom_id ? hrMap[t.homeroom_id] : null;
            return {
              id: t.id,
              text: t.text,
              done: t.done,
              addedAt: t.created_at,
              completedAt: t.completed_at ?? null,
              lastSessionTime: t.time_spent > 0 ? t.time_spent : undefined,
              scheduledForTitle: hr ? hr.title : undefined,
              scheduledForDate: hr?.status === "scheduled" ? hr.scheduled_for : null,
              homeroomId: t.homeroom_id,
              homeroomStatus: hr?.status ?? null,
            };
          }));
        });
    });

    try {
      const h = localStorage.getItem("homeroom-task-history");
      if (h) setTaskHistory(JSON.parse(h));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const suggestions: TaskHistory[] = input.trim().length > 0
    ? taskHistory.filter((h) =>
        h.text.toLowerCase().includes(input.toLowerCase()) &&
        h.text.toLowerCase() !== input.toLowerCase()
      )
    : [];

  async function addTask(text?: string, lastSessionTime?: number) {
    const t = (text ?? input).trim();
    if (!t || !myUserId) return;
    setInput("");
    setShowSuggestions(false);
    const supabase = createClient();
    const { data } = await supabase.from("tasks").insert({
      user_id: myUserId,
      text: t,
      done: false,
      time_spent: lastSessionTime ?? 0,
      homeroom_id: null,
      sort_order: tasks.length,
    }).select("id, created_at").single();
    if (data) {
      setTasks((prev) => [...prev, {
        id: data.id,
        text: t,
        done: false,
        addedAt: data.created_at,
        completedAt: null,
        lastSessionTime,
      }]);
    }
  }

  async function toggleTask(id: string) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const nowDone = !task.done;
    const supabase = createClient();
    await supabase.from("tasks").update({
      done: nowDone,
      completed_at: nowDone ? new Date().toISOString() : null,
    }).eq("id", id);
    setTasks((prev) => prev.map((t) => t.id === id
      ? { ...t, done: nowDone, completedAt: nowDone ? new Date().toISOString() : null }
      : t
    ));
  }

  async function deleteTask(id: string) {
    const supabase = createClient();
    await supabase.from("tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function startEdit(id: string, text: string) {
    setEditingId(id);
    setEditingText(text);
  }

  async function saveEdit() {
    const text = editingText.trim();
    if (text && editingId) {
      const supabase = createClient();
      await supabase.from("tasks").update({ text }).eq("id", editingId);
      setTasks((prev) => prev.map((t) => (t.id === editingId ? { ...t, text } : t)));
    }
    setEditingId(null);
    setEditingText("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingText("");
  }

  function handleSort(field: "date" | "time") {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "date" ? "asc" : "desc");
    }
  }

  const active = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const sortedActive = !sortField
    ? [...active].reverse()
    : [...active].sort((a, b) => {
        if (sortField === "date") {
          const aT = new Date(a.addedAt).getTime();
          const bT = new Date(b.addedAt).getTime();
          return sortDir === "asc" ? aT - bT : bT - aT;
        } else {
          const aT = a.lastSessionTime ?? null;
          const bT = b.lastSessionTime ?? null;
          if (aT === null && bT === null) return 0;
          if (aT === null) return 1;
          if (bT === null) return -1;
          return sortDir === "desc" ? bT - aT : aT - bT;
        }
      });

  const showScrollable = displayLimit === EXPANDED_LIMIT && sortedActive.length > EXPANDED_LIMIT;
  const visibleActive = showScrollable ? sortedActive : sortedActive.slice(0, displayLimit);
  const canShowMore = sortedActive.length > displayLimit && displayLimit < EXPANDED_LIMIT;

  return (
    <div>
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-bold text-lg text-charcoal leading-tight">My List</h1>
              <p className="text-xs text-warm-gray">
                {tasks.length === 0 ? "No tasks yet" : `${active.length} to do · ${done.length} done`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/home" className="flex-1 bg-charcoal text-white font-semibold text-sm py-2.5 rounded-xl flex items-center justify-center gap-1.5 hover:bg-black transition-colors">
              Join a Homeroom
            </Link>
            <Link href="/start" className="flex-1 bg-charcoal text-white font-semibold text-sm py-2.5 rounded-xl flex items-center justify-center gap-1.5 hover:bg-black transition-colors">
              Start a Homeroom
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Add task */}
        <div className="mt-4 relative">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); }}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(); if (e.key === "Escape") setShowSuggestions(false); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Add a task…"
              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-cream text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
            />
            <button
              onClick={() => addTask()}
              style={{ color: "#7C3AED" }}
              className="flex-shrink-0 hover:opacity-70 transition-opacity"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
              </svg>
            </button>
          </div>

          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-8 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-md z-20 overflow-hidden">
              {suggestions.map((s) => (
                <button
                  key={s.text}
                  onMouseDown={() => addTask(s.text, s.lastSessionTime)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <span className="text-sm text-charcoal truncate">{s.text}</span>
                  <span className="text-xs text-warm-gray ml-2 flex-shrink-0">{formatSeconds(s.lastSessionTime)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort controls */}
        {active.length > 1 && (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-warm-gray">Sort:</span>
            {(["date", "time"] as const).map((field) => {
              const isActive = sortField === field;
              const arrow = isActive ? (sortDir === "asc" ? " ↑" : " ↓") : "";
              return (
                <button
                  key={field}
                  onClick={() => handleSort(field)}
                  className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                  style={isActive
                    ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" }
                    : { background: "white", color: "#78716C", borderColor: "#E5E7EB" }}
                >
                  {field === "date" ? "Date added" : "Time required"}{arrow}
                </button>
              );
            })}
            {sortField && (
              <button onClick={() => setSortField(null)} className="text-xs text-warm-gray hover:text-charcoal transition-colors">
                Clear
              </button>
            )}
          </div>
        )}

        {/* Task list */}
        <div className="mt-4 mb-8">
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-warm-gray text-sm">
              No tasks yet. Add one above.
            </div>
          ) : (
            <div className="space-y-2">
              <div
                className={showScrollable ? "overflow-y-auto space-y-2 pr-1" : "space-y-2"}
                style={showScrollable ? { maxHeight: "480px" } : {}}
              >
                {visibleActive.map((t) => (
                  <div key={t.id} className="bg-white rounded-2xl border border-gray-200 px-3 py-2.5 flex items-center gap-2 group hover:shadow-sm transition-all">
                    <button
                      onClick={() => toggleTask(t.id)}
                      className="w-4 h-4 rounded border-2 border-gray-300 flex-shrink-0 hover:border-sage transition-colors"
                    />
                    {editingId === t.id ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                        onBlur={saveEdit}
                        className="flex-1 text-sm text-charcoal border border-sage rounded-lg px-2 py-0.5 focus:outline-none bg-white"
                      />
                    ) : (
                      <span className="text-sm text-charcoal flex-1 min-w-0 truncate">{t.text}</span>
                    )}
                    {t.lastSessionTime !== undefined && (
                      <span className="text-xs flex-shrink-0 px-1.5 py-0.5 rounded-full" style={{ background: "#F5F3FF", color: "#7C3AED" }}>
                        {formatSeconds(t.lastSessionTime)}
                      </span>
                    )}
                    {t.homeroomStatus === "active" && t.scheduledForTitle && (
                      <span className="text-xs flex-shrink-0 px-1.5 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1" style={{ background: "#ECFDF5", color: "#065F46" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                        {t.scheduledForTitle}
                      </span>
                    )}
                    {t.scheduledForDate && (
                      <span className="text-xs flex-shrink-0 px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: "#FEF9C3", color: "#92400E" }}>
                        {t.scheduledForTitle || "Homeroom"} {new Date(t.scheduledForDate).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                      </span>
                    )}
                    <span className="text-xs text-warm-gray opacity-50 flex-shrink-0 group-hover:hidden">
                      {addedAtLabel(t.addedAt)}
                    </span>
                    <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={() => startEdit(t.id, t.text)} className="text-warm-gray hover:text-sage transition-colors p-1">
                        <EditIcon />
                      </button>
                      <button onClick={() => deleteTask(t.id)} className="text-warm-gray hover:text-red-400 transition-colors p-1">
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {canShowMore && (
                <button
                  onClick={() => setDisplayLimit(EXPANDED_LIMIT)}
                  className="w-full text-xs text-warm-gray hover:text-charcoal py-2 border border-dashed border-gray-200 rounded-xl transition-colors"
                >
                  Show more ({sortedActive.length - displayLimit} remaining)
                </button>
              )}

              {done.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => setDoneExpanded((v) => !v)}
                    className="w-full flex items-center justify-between py-1.5 mb-2"
                  >
                    <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide">Done · {done.length}</p>
                    <svg
                      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: doneExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {doneExpanded && done.map((t) => (
                    <div key={t.id} className="bg-white rounded-2xl border border-gray-100 px-3 py-2.5 flex items-center gap-2 group hover:shadow-sm transition-all mb-2 opacity-60">
                      <button
                        onClick={() => toggleTask(t.id)}
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                        style={{ background: "#7C3AED", border: "2px solid #7C3AED" }}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                      <span className="text-sm text-warm-gray flex-1 line-through truncate">{t.text}</span>
                      {t.lastSessionTime !== undefined && (
                        <span className="text-xs text-warm-gray flex-shrink-0">{formatSeconds(t.lastSessionTime)}</span>
                      )}
                      <span className="text-xs text-warm-gray opacity-70 flex-shrink-0">{completedLabel(t.completedAt)}</span>
                      <button
                        onClick={() => deleteTask(t.id)}
                        className="opacity-0 group-hover:opacity-100 text-warm-gray hover:text-red-400 transition-all p-1"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
