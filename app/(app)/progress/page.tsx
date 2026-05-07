"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function calcStreak(dates: string[]): number {
  if (!dates.length) return 0;
  const unique = [...new Set(dates.map(d => d.slice(0, 10)))].sort().reverse();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (unique[0] !== today && unique[0] !== yesterday) return 0;
  let streak = 1;
  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1]);
    const curr = new Date(unique[i]);
    const diff = Math.round((prev.getTime() - curr.getTime()) / 86400000);
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

type WeekDay = { label: string; active: boolean; isToday: boolean };

export default function ProgressPage() {
  const [sessions, setSessions] = useState(0);
  const [tasksDone, setTasksDone] = useState(0);
  const [timeSpentSec, setTimeSpentSec] = useState(0);
  const [streak, setStreak] = useState(0);
  const [weekDays, setWeekDays] = useState<WeekDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Sessions: completed homerooms the user participated in
      const { data: participated } = await supabase
        .from("homeroom_participants")
        .select("homeroom_id")
        .eq("user_id", user.id);

      const participatedIds = (participated ?? []).map(p => p.homeroom_id as string);
      const { data: completedRoomsData } = participatedIds.length
        ? await supabase.from("homerooms").select("id, ended_at").eq("status", "completed").in("id", participatedIds)
        : { data: [] };

      const completedRooms = (completedRoomsData ?? []) as { id: string; ended_at: string | null }[];
      setSessions(completedRooms.length);

      // Day streak + weekly activity from ended_at dates
      const endedDates = completedRooms
        .map(r => r.ended_at)
        .filter(Boolean) as string[];
      setStreak(calcStreak(endedDates));

      // Build last 7 days activity
      const activeDays = new Set(endedDates.map(d => d.slice(0, 10)));
      const days: WeekDay[] = [];
      const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        days.push({
          label: DAY_LABELS[d.getDay()],
          active: activeDays.has(key),
          isToday: i === 0,
        });
      }
      setWeekDays(days);

      // Tasks done
      const { count: doneCount } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("done", true);
      setTasksDone(doneCount ?? 0);

      // Hours: sum time_spent across all tasks
      const { data: timeTasks } = await supabase
        .from("tasks")
        .select("time_spent")
        .eq("user_id", user.id)
        .gt("time_spent", 0);
      const totalSec = (timeTasks ?? []).reduce((sum, t) => sum + (t.time_spent ?? 0), 0);
      setTimeSpentSec(totalSec);

      setLoading(false);
    })();
  }, []);

  const stats = [
    { label: "Sessions", value: loading ? "—" : String(sessions) },
    { label: "Tasks done", value: loading ? "—" : String(tasksDone) },
    { label: "Hours in", value: loading ? "—" : formatHours(timeSpentSec) },
    { label: "Day streak", value: loading ? "—" : `${streak}🔥` },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-28">
      <h1 className="text-2xl font-bold text-charcoal mb-1">Progress</h1>
      <p className="text-sm text-warm-gray mb-6">Your focus history at a glance.</p>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 text-center">
            <div className="text-2xl font-bold text-charcoal">{s.value}</div>
            <div className="text-xs text-warm-gray mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Weekly activity */}
      <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4 mb-6">
        <p className="text-sm font-semibold text-charcoal mb-4">This week</p>
        <div className="flex justify-between">
          {weekDays.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={
                  d.active
                    ? { background: "#7C3AED" }
                    : d.isToday
                    ? { background: "#EDE9FE" }
                    : { background: "#F3F4F6" }
                }
              >
                {d.active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span
                className="text-xs font-medium"
                style={{ color: d.isToday ? "#7C3AED" : "#78716C" }}
              >
                {d.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {!loading && sessions === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 px-5 py-8 text-center">
          <div className="text-3xl mb-2">🚀</div>
          <p className="text-sm font-semibold text-charcoal">No sessions yet</p>
          <p className="text-xs text-warm-gray mt-1">Complete a homeroom to start tracking your progress.</p>
        </div>
      )}
    </div>
  );
}
