"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/utils/date";

type Habit = {
  id: string;
  name: string;
  sortOrder: number;
};

type Props = {
  userId: string;
};

// Return a list of the last `n` dates (as YYYY-MM-DD keys), oldest first
// so the row reads left-to-right chronologically.
function lastNDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const c = new Date(d);
    c.setDate(d.getDate() - i);
    out.push(dateKey(c));
  }
  return out;
}

// "M" for Monday, "T" for Tuesday, etc. Uses the parsed date's weekday.
function weekdayInitial(iso: string): string {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: "narrow" });
}

export default function HabitTracker({ userId }: Props) {
  const [habits, setHabits] = useState<Habit[]>([]);
  // Map habit_id -> Set<dateKey> of completed dates in the last 30 days.
  const [completions, setCompletions] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingOpen, setAddingOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const today = dateKey(new Date());
  const last7 = lastNDates(7);
  const last30 = lastNDates(30);

  async function load() {
    const supabase = createClient();
    const { data: hs } = await supabase
      .from("habits")
      .select("id, name, sort_order")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    const habitRows = ((hs ?? []) as { id: string; name: string; sort_order: number }[]).map((h) => ({
      id: h.id,
      name: h.name,
      sortOrder: h.sort_order,
    }));
    setHabits(habitRows);

    if (habitRows.length > 0) {
      // Fetch completions for the last 30 days for all this user's habits.
      const thirtyAgo = last30[0];
      const { data: cs } = await supabase
        .from("habit_completions")
        .select("habit_id, date")
        .in("habit_id", habitRows.map((h) => h.id))
        .gte("date", thirtyAgo);
      const map = new Map<string, Set<string>>();
      for (const c of (cs ?? []) as { habit_id: string; date: string }[]) {
        const set = map.get(c.habit_id) ?? new Set<string>();
        set.add(c.date);
        map.set(c.habit_id, set);
      }
      setCompletions(map);
    } else {
      setCompletions(new Map());
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function addHabit() {
    const trimmed = newName.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const supabase = createClient();
    const maxOrder = habits.reduce((m, h) => Math.max(m, h.sortOrder), 0);
    const { data } = await supabase
      .from("habits")
      .insert({ user_id: userId, name: trimmed, sort_order: maxOrder + 10 })
      .select("id, name, sort_order")
      .single();
    setSaving(false);
    if (data) {
      setHabits((prev) => [...prev, { id: data.id as string, name: data.name as string, sortOrder: data.sort_order as number }]);
      setNewName("");
      setAddingOpen(false);
    }
  }

  async function toggleCompletion(habitId: string, date: string) {
    if (date > today) return; // No pre-checking the future.
    const set = completions.get(habitId) ?? new Set<string>();
    const already = set.has(date);
    const nextSet = new Set(set);
    if (already) nextSet.delete(date);
    else nextSet.add(date);
    const nextMap = new Map(completions);
    nextMap.set(habitId, nextSet);
    setCompletions(nextMap);
    const supabase = createClient();
    if (already) {
      await supabase.from("habit_completions").delete().eq("habit_id", habitId).eq("date", date);
    } else {
      await supabase.from("habit_completions").upsert({ habit_id: habitId, date }, { onConflict: "habit_id,date" });
    }
  }

  async function deleteHabit(id: string) {
    setHabits((prev) => prev.filter((h) => h.id !== id));
    setCompletions((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setConfirmDeleteId(null);
    await createClient().from("habits").delete().eq("id", id);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (loading && habits.length === 0) return null; // Silent on first load — no big empty state.

  return (
    <section className="mb-4">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em]" style={{ color: "var(--text-2)" }}>
          Habits
        </h3>
        <button
          type="button"
          onClick={() => setAddingOpen((v) => !v)}
          className="text-xs font-semibold flex items-center gap-1"
          style={{ color: "var(--purple)" }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: addingOpen ? "rotate(45deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {addingOpen ? "Close" : "Add habit"}
        </button>
      </div>

      {/* Habit rows */}
      {habits.length > 0 && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}
        >
          {habits.map((h, idx) => {
            const completed = completions.get(h.id) ?? new Set<string>();
            const last7Count = last7.filter((d) => completed.has(d)).length;
            const last30Count = last30.filter((d) => completed.has(d)).length;
            const isExpanded = expanded.has(h.id);
            return (
              <div key={h.id} style={{ borderTop: idx > 0 ? "1px solid var(--border)" : undefined }}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(h.id)}
                    className="flex-1 min-w-0 text-left flex items-center gap-2"
                    aria-expanded={isExpanded}
                  >
                    <span
                      className={`text-sm font-medium ${isExpanded ? "break-words" : "truncate"}`}
                      style={{ color: "var(--text)" }}
                    >
                      {h.name}
                    </span>
                    <span
                      className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: "rgba(124,58,237,0.10)", color: "var(--purple)" }}
                    >
                      {last7Count}/7
                    </span>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {last7.map((d) => {
                      const done = completed.has(d);
                      const isToday = d === today;
                      const inFuture = d > today;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleCompletion(h.id, d)}
                          disabled={inFuture}
                          className="w-6 h-6 rounded-md flex flex-col items-center justify-center transition-transform active:scale-95"
                          style={{
                            background: done ? "var(--purple)" : "var(--surface-2)",
                            border: isToday ? "1.5px solid var(--purple)" : "1px solid var(--border-2)",
                            color: done ? "white" : "var(--text-3)",
                          }}
                          title={d}
                          aria-label={`${d}: ${done ? "done" : "not done"}`}
                        >
                          <span className="text-[8px] font-semibold leading-none">{weekdayInitial(d)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {isExpanded && (
                  <div
                    className="border-t px-3 py-3 space-y-2"
                    style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-2)" }}>
                        Last 30 days
                      </span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--purple)" }}>
                        {last30Count}/30 days
                      </span>
                    </div>
                    {/* 30-day heatmap */}
                    <div className="grid grid-cols-15 gap-0.5" style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}>
                      {last30.map((d) => {
                        const done = completed.has(d);
                        const isToday = d === today;
                        return (
                          <div
                            key={d}
                            className="aspect-square rounded"
                            style={{
                              background: done ? "var(--purple)" : "var(--surface)",
                              border: isToday ? "1.5px solid var(--purple)" : "1px solid var(--border-2)",
                            }}
                            title={d}
                          />
                        );
                      })}
                    </div>
                    {/* Delete row */}
                    {confirmDeleteId === h.id ? (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="flex-1 text-xs font-medium py-1.5 rounded-md border"
                          style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteHabit(h.id)}
                          className="flex-1 text-xs font-semibold py-1.5 rounded-md text-white"
                          style={{ background: "var(--red)" }}
                        >
                          Delete habit
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(h.id)}
                        className="text-xs w-full py-1"
                        style={{ color: "var(--text-3)" }}
                      >
                        Delete habit
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add-habit input */}
      {addingOpen && (
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHabit(); } }}
            placeholder="e.g. Read 15 min, Meditate…"
            className="flex-1 text-sm rounded-xl px-3 py-2 focus:outline-none border"
            style={{
              background: "var(--surface)",
              borderColor: newName ? "var(--purple)" : "var(--border-2)",
              color: "var(--text)",
              fontSize: "16px",
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={addHabit}
            disabled={saving || !newName.trim()}
            className="text-sm font-semibold px-3 py-2 rounded-xl text-white disabled:opacity-40"
            style={{ background: "var(--purple)" }}
          >
            {saving ? "…" : "Add"}
          </button>
        </div>
      )}

      {/* Empty state — only when the user has none yet */}
      {habits.length === 0 && !addingOpen && (
        <button
          type="button"
          onClick={() => setAddingOpen(true)}
          className="w-full text-xs font-medium py-3 rounded-xl border border-dashed"
          style={{ borderColor: "var(--purple-muted)", color: "var(--purple-light)", background: "transparent" }}
        >
          + Track your first habit
        </button>
      )}
    </section>
  );
}
