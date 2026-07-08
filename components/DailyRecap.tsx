"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/utils/date";

type Task = { id: string; text: string; done: boolean };

type RecapData = {
  focus: string;
  completed: Task[];
  incomplete: Task[];
  coworkedMinutes: number;
  streak: number;
  yesterdayLabel: string;
};

// Sum the duration of a block, using its start_time / end_time (HH:MM[:SS]).
function blockMinutes(startTime: string | null, endTime: string | null): number {
  if (!startTime || !endTime) return 0;
  const parse = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  return Math.max(0, parse(endTime) - parse(startTime));
}

export default function DailyRecap() {
  const [data, setData] = useState<RecapData | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [incompleteOpen, setIncompleteOpen] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const uid = session.user.id;

      const today = dateKey(new Date());
      // Fast local check first — avoids re-showing during the network round-trip
      // if the user dismisses and immediately reloads on the same device.
      if (typeof window !== "undefined" && localStorage.getItem("homeroom-recap-shown") === today) return;
      // Cross-device dismissal: check the server flag on the profile.
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("last_recap_dismissed_date")
        .eq("id", uid)
        .maybeSingle();
      const dismissedOn = (profileRow as { last_recap_dismissed_date: string | null } | null)?.last_recap_dismissed_date;
      if (dismissedOn === today) {
        // Keep the local cache in sync when the DB says shown but this device hasn't been told yet.
        if (typeof window !== "undefined") localStorage.setItem("homeroom-recap-shown", today);
        return;
      }

      const yd = new Date();
      yd.setDate(yd.getDate() - 1);
      const yesterday = dateKey(yd);

      // Fetch yesterday's tasks + focus + blocks + 30 days of activity for streak.
      const thirtyAgo = new Date();
      thirtyAgo.setDate(thirtyAgo.getDate() - 30);
      const thirtyAgoKey = dateKey(thirtyAgo);

      const [tasksRes, commitRes, ownedBlocksRes, invitedBlocksRes, activityCommitsRes, activityTasksRes] = await Promise.all([
        supabase.from("tasks")
          .select("id, text, done")
          .eq("user_id", uid)
          .eq("committed_for_date", yesterday),
        supabase.from("daily_commitments")
          .select("commitment")
          .eq("user_id", uid)
          .eq("date", yesterday)
          .maybeSingle(),
        supabase.from("blocks")
          .select("id, start_time, end_time, block_invites(status)")
          .eq("user_id", uid)
          .eq("date", yesterday),
        supabase.from("block_invites")
          .select("status, blocks!inner(id, start_time, end_time, date)")
          .eq("invited_user_id", uid)
          .eq("status", "joined")
          .eq("blocks.date", yesterday),
        supabase.from("daily_commitments")
          .select("date, commitment")
          .eq("user_id", uid)
          .gte("date", thirtyAgoKey),
        supabase.from("tasks")
          .select("committed_for_date")
          .eq("user_id", uid)
          .not("committed_for_date", "is", null)
          .gte("committed_for_date", thirtyAgoKey),
      ]);

      const tasks = (tasksRes.data ?? []) as Task[];
      const focus = ((commitRes.data as { commitment: string } | null)?.commitment ?? "").trim();

      // No activity yesterday → nothing to recap.
      if (tasks.length === 0 && !focus) return;

      // Coworked minutes: blocks I owned that had ≥1 joined invitee, plus blocks I joined.
      const owned = (ownedBlocksRes.data ?? []) as Array<{
        id: string;
        start_time: string | null;
        end_time: string | null;
        block_invites: { status: string }[] | null;
      }>;
      let cow = 0;
      for (const b of owned) {
        const hasJoinedGuest = (b.block_invites ?? []).some((i) => i.status === "joined");
        if (hasJoinedGuest) cow += blockMinutes(b.start_time, b.end_time);
      }
      const invited = (invitedBlocksRes.data ?? []) as unknown as Array<{
        blocks: { start_time: string | null; end_time: string | null } | { start_time: string | null; end_time: string | null }[] | null;
      }>;
      for (const row of invited) {
        const b = Array.isArray(row.blocks) ? row.blocks[0] : row.blocks;
        if (b) cow += blockMinutes(b.start_time, b.end_time);
      }

      // Streak: consecutive days ending yesterday with any activity.
      const activeDays = new Set<string>();
      for (const c of (activityCommitsRes.data ?? []) as { date: string; commitment: string }[]) {
        if ((c.commitment ?? "").trim().length > 0) activeDays.add(c.date);
      }
      for (const t of (activityTasksRes.data ?? []) as { committed_for_date: string }[]) {
        if (t.committed_for_date) activeDays.add(t.committed_for_date);
      }
      let streak = 0;
      if (activeDays.has(yesterday)) {
        const cursor = new Date(yd);
        while (activeDays.has(dateKey(cursor))) {
          streak += 1;
          cursor.setDate(cursor.getDate() - 1);
        }
      }

      const yesterdayLabel = yd.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

      if (cancelled) return;
      setUserId(uid);
      setData({
        focus,
        completed: tasks.filter((t) => t.done),
        incomplete: tasks.filter((t) => !t.done),
        coworkedMinutes: cow,
        streak,
        yesterdayLabel,
      });
    }
    run();
    return () => { cancelled = true; };
  }, []);

  function close() {
    setData(null);
    const today = dateKey(new Date());
    // Instant local flag so a same-device reload during the DB write skips the modal.
    if (typeof window !== "undefined") localStorage.setItem("homeroom-recap-shown", today);
    if (!userId) return;
    // Persist to the profile so other devices also skip it today.
    void createClient()
      .from("profiles")
      .update({ last_recap_dismissed_date: today })
      .eq("id", userId);
  }

  async function markDoneRetro(id: string) {
    if (!data) return;
    const t = data.incomplete.find((x) => x.id === id);
    if (!t) return;
    const supabase = createClient();
    await supabase.from("tasks").update({ done: true, completed_at: new Date().toISOString() }).eq("id", id);
    setData({
      ...data,
      incomplete: data.incomplete.filter((x) => x.id !== id),
      completed: [...data.completed, { ...t, done: true }],
    });
  }

  function carryUnfinished() {
    if (!data || !userId || carrying) return;
    setCarrying(true);
    const ids = data.incomplete.map((t) => t.id);
    if (ids.length > 0 && typeof window !== "undefined") {
      // Hand the IDs to CommitPicker so it can pre-select them at the top of
      // the list. Don't commit yet — the user should confirm on the picker.
      sessionStorage.setItem("homeroom-carry-preselect", JSON.stringify(ids));
    }
    close();
    router.push("/today");
  }

  function goToday() {
    close();
    router.push("/today");
  }

  if (!data) return null;

  const stats = [
    { value: data.completed.length, label: "completed", onClick: data.completed.length > 0 ? () => setCompletedOpen((v) => !v) : undefined, isOpen: completedOpen },
    { value: data.coworkedMinutes, label: data.coworkedMinutes === 1 ? "min coworked" : "mins coworked" },
    { value: data.incomplete.length, label: "left undone", onClick: data.incomplete.length > 0 ? () => setIncompleteOpen((v) => !v) : undefined, isOpen: incompleteOpen },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={close}
    >
      <div
        className="relative w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
        style={{ background: "var(--surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center z-10 hover:opacity-100"
          style={{ color: "var(--text-2)", opacity: 0.6 }}
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="h-1 w-full" style={{ background: "var(--purple)" }} />

        <div className="px-6 pt-6 pb-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.25em] mb-1 text-center" style={{ color: "var(--purple)" }}>
            Yesterday · {data.yesterdayLabel}
          </div>

          {data.focus ? (
            <div className="text-center">
              <div className="text-sm mb-1" style={{ color: "var(--text-2)" }}>Yesterday&apos;s focus</div>
              <div
                className="font-display italic leading-tight break-words"
                style={{ color: "var(--text)", fontSize: "clamp(1.5rem, 6vw, 2.1rem)" }}
              >
                {data.focus}
              </div>
            </div>
          ) : (
            <div
              className="font-display italic leading-tight text-center"
              style={{ color: "var(--text)", fontSize: "clamp(1.5rem, 6vw, 2.1rem)" }}
            >
              Here&apos;s how it went
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 border-t border-b" style={{ borderColor: "var(--border)" }}>
          {stats.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={s.onClick}
              disabled={!s.onClick}
              className="flex flex-col items-center justify-center py-4 transition-colors"
              style={{
                borderLeft: i > 0 ? "1px solid var(--border)" : undefined,
                background: s.isOpen ? "var(--surface-2)" : "transparent",
                cursor: s.onClick ? "pointer" : "default",
              }}
            >
              <span className="font-display tabular-nums" style={{ color: "var(--text)", fontSize: "1.75rem", lineHeight: 1 }}>
                {s.value}
              </span>
              <span className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "var(--text-2)" }}>
                {s.label}
                {s.onClick && (
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: s.isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                )}
              </span>
            </button>
          ))}
        </div>

        {/* Expanded task lists */}
        {completedOpen && data.completed.length > 0 && (
          <div className="px-6 py-3 border-b space-y-1.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            {data.completed.map((t) => (
              <div key={t.id} className="flex items-start gap-2 text-sm" style={{ color: "var(--text-2)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 3, flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="line-through">{t.text}</span>
              </div>
            ))}
          </div>
        )}

        {incompleteOpen && data.incomplete.length > 0 && (
          <div className="px-6 py-3 border-b space-y-1.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            <div className="text-[11px] italic mb-1.5" style={{ color: "var(--text-3)" }}>
              Did you forget to close any?
            </div>
            {data.incomplete.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => markDoneRetro(t.id)}
                className="w-full flex items-start gap-2 text-sm text-left transition-opacity hover:opacity-100"
                style={{ color: "var(--text)", opacity: 0.9 }}
              >
                <span
                  className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                  style={{ border: "2px solid var(--border-3)", marginTop: 1 }}
                />
                <span>{t.text}</span>
              </button>
            ))}
          </div>
        )}

        {/* Streak line */}
        {data.streak > 0 && (
          <div className="px-6 py-4 flex items-center justify-center gap-2 text-sm font-medium" style={{ color: "var(--text)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 3c-.5 4-4 5-4 9a4 4 0 008 0c0-2-1-4-2-5 0 3-2 3-2 3s3-3 0-7z" />
            </svg>
            <span>
              {data.streak === 1
                ? "You just started a new streak"
                : `${data.streak} days committed in a row`}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 pb-4 pt-2 flex flex-col gap-2">
          {data.incomplete.length > 0 && (
            <button
              type="button"
              onClick={carryUnfinished}
              disabled={carrying}
              className="w-full text-sm font-semibold py-3 rounded-2xl border transition-colors"
              style={{
                background: "transparent",
                borderColor: "var(--purple)",
                color: "var(--purple)",
                opacity: carrying ? 0.5 : 1,
              }}
            >
              Carry {data.incomplete.length} unfinished task{data.incomplete.length === 1 ? "" : "s"} into today
            </button>
          )}
          <button
            type="button"
            onClick={goToday}
            className="w-full text-sm font-semibold py-3 rounded-2xl text-white"
            style={{ background: "var(--purple)" }}
          >
            Let&apos;s get today going
          </button>
        </div>
      </div>
    </div>
  );
}
