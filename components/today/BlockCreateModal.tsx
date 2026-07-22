"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/utils/date";
import { getOrCreateTag, parseHashtags, stripHashtags, tagColor } from "@/lib/utils/tags";
import type { Tag } from "@/lib/db/types";

type FriendOption = { id: string; username: string; avatar: string | null };
type TaskOption = { id: string; text: string; isPrivate: boolean; tagIds: string[]; scheduledFor: string | null };

// "Tue 7/9" style label for a YYYY-MM-DD date-key string.
function formatSchedulePill(iso: string): string {
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const wk = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${wk} ${d.getMonth() + 1}/${d.getDate()}`;
}

// Add a duration (hours + minutes) to a "HH:MM" start time and return the
// resulting "HH:MM" end time. Wraps at midnight.
function endTimeFromDuration(start: string, h: number, m: number): string {
  const [sh, sm] = start.split(":").map(Number);
  const total = (sh * 60 + (sm || 0) + h * 60 + m) % (24 * 60);
  const eh = Math.floor(total / 60);
  const em = total % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

// "HH:MM" (24h) -> "h:MM AM/PM" for user-facing labels.
function to12h(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

// Break a "HH:MM" (24h) string into 12-hour components for the custom picker.
function parseClock(t: string): { h12: number; m: number; ampm: "AM" | "PM" } {
  const [h, m] = t.split(":").map(Number);
  const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return { h12, m: m || 0, ampm };
}

// Rebuild "HH:MM" (24h) from picker components.
function composeClock(h12: number, m: number, ampm: "AM" | "PM"): string {
  const h24 = ampm === "PM" ? (h12 === 12 ? 12 : h12 + 12) : (h12 === 12 ? 0 : h12);
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Props = {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
};

export default function BlockCreateModal({ userId, onClose, onCreated }: Props) {
  const today = dateKey(new Date());
  // Default times: next hour rounded up to :00, +1h
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }, []);
  const [name, setName] = useState("Focus block");
  // "now" = start immediately, only pick length. "schedule" = pick date +
  // start time + length as before.
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState(defaultStart);
  // Duration replaces the raw end-time picker — the user chooses a length
  // (in hours + minutes) and we compute end_time from start + duration.
  const [durationH, setDurationH] = useState(1);
  const [durationM, setDurationM] = useState(0);

  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [taskSearch, setTaskSearch] = useState("");

  const [newTaskInput, setNewTaskInput] = useState("");
  const [extraTasks, setExtraTasks] = useState<{ text: string; tagNames: string[] }[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoPrivate, setAutoPrivate] = useState(false);

  // ── Load friends + tasks ───────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      // Friends
      const { data: fr } = await supabase
        .from("friendships")
        .select("user_a, user_b")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`);
      const friendIds = (fr ?? []).map((f) => (f.user_a === userId ? f.user_b : f.user_a)) as string[];
      let friendProfiles: FriendOption[] = [];
      if (friendIds.length > 0) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, username, avatar")
          .in("id", friendIds);
        friendProfiles = ((ps as FriendOption[] | null) ?? []);
      }
      setFriends(friendProfiles);

      // Tasks: open tasks (not done) + tags + profile setting
      const [taskRes, tagsRes, profileRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, text, is_private, committed_for_date, task_tags(tag_id)")
          .eq("user_id", userId)
          .eq("done", false)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("tags").select("id, name").eq("user_id", userId).order("name"),
        supabase.from("profiles").select("auto_private_tasks").eq("id", userId).maybeSingle(),
      ]);
      setTasks(((taskRes.data ?? []) as { id: string; text: string; is_private: boolean; committed_for_date: string | null; task_tags: { tag_id: string }[] | null }[]).map((r) => ({
        id: r.id,
        text: r.text,
        isPrivate: r.is_private ?? false,
        tagIds: (r.task_tags ?? []).map((tt) => tt.tag_id),
        scheduledFor: r.committed_for_date,
      })));
      setAllTags((tagsRes.data ?? []) as Tag[]);
      setAutoPrivate((profileRes.data as { auto_private_tasks: boolean } | null)?.auto_private_tasks ?? false);
    }
    load();
  }, [userId, today]);

  function toggleFriend(id: string) {
    setInvitedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePick(id: string) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addExtra() {
    const raw = newTaskInput.trim();
    if (!raw) return;
    const text = stripHashtags(raw);
    const tagNames = parseHashtags(raw);
    if (!text) return;
    setExtraTasks((prev) => [...prev, { text, tagNames }]);
    setNewTaskInput("");
  }

  function removeExtra(idx: number) {
    setExtraTasks((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Save ───────────────────────────────────────────────────────────────
  async function save() {
    setError(null);
    if (!name.trim()) { setError("Give the block a name"); return; }
    if (durationH === 0 && durationM === 0) { setError("Set a block length"); return; }

    // Resolve the effective date + start_time based on mode.
    let effectiveDate = date;
    let effectiveStart = startTime;
    if (mode === "now") {
      // Start = current wall clock (nearest minute), date = today.
      const nowD = new Date();
      effectiveDate = today;
      effectiveStart = `${String(nowD.getHours()).padStart(2, "0")}:${String(nowD.getMinutes()).padStart(2, "0")}`;
    } else {
      if (!startTime) { setError("Pick a start time"); return; }
      // If scheduling for today, the start time can't already be in the past.
      if (date === today) {
        const [sh, sm] = startTime.split(":").map(Number);
        const startMin = sh * 60 + (sm || 0);
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        if (startMin < nowMin) {
          setError("Start time can't be in the past. Pick a later time or a future date.");
          return;
        }
      }
    }
    const endTime = endTimeFromDuration(effectiveStart, durationH, durationM);
    setSaving(true);

    const supabase = createClient();
    const visibility = invitedIds.size > 0 ? "shared" : "private";

    const { data: block, error: blockErr } = await supabase
      .from("blocks")
      .insert({
        user_id: userId,
        date: effectiveDate,
        name: name.trim(),
        start_time: effectiveStart,
        end_time: endTime,
        visibility,
        position: 0,
      })
      .select("id")
      .single();

    if (blockErr || !block) {
      setError(blockErr?.message ?? "Could not create block");
      setSaving(false);
      return;
    }

    // Invite friends
    if (invitedIds.size > 0) {
      await supabase.from("block_invites").insert(
        Array.from(invitedIds).map((id) => ({ block_id: block.id, invited_user_id: id, status: "invited" as const })),
      );
    }

    // Attach picked existing tasks
    const pickedArr = Array.from(pickedIds);
    if (pickedArr.length > 0) {
      await supabase
        .from("tasks")
        .update({ block_id: block.id, committed_for_date: effectiveDate })
        .in("id", pickedArr);
    }

    // Create extra new tasks under this block
    for (const extra of extraTasks) {
      const { data: t } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          text: extra.text,
          done: false,
          block_id: block.id,
          committed_for_date: effectiveDate,
          is_private: autoPrivate,
        })
        .select("id")
        .single();
      if (t && extra.tagNames.length > 0) {
        const tagObjs = (await Promise.all(extra.tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
        if (tagObjs.length > 0) {
          await supabase.from("task_tags").insert(tagObjs.map((tg) => ({ task_id: t.id, tag_id: tg.id })));
        }
      }
    }

    setSaving(false);
    onCreated();
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const filteredTasks = (taskSearch.trim()
    ? tasks.filter((t) => t.text.toLowerCase().includes(taskSearch.toLowerCase().trim()))
    : tasks
  )
    // Stable sort — committed-for-today tasks bubble to the top; everything
    // else keeps its original (recent-first) order.
    .slice()
    .sort((a, b) => {
      const at = a.scheduledFor === today ? 0 : 1;
      const bt = b.scheduledFor === today ? 0 : 1;
      return at - bt;
    });

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Sticky header */}
      <header
        className="flex items-center justify-between px-4 py-3 border-b sticky top-0 z-10"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <button
          onClick={onClose}
          className="text-sm font-medium px-3 py-1.5 rounded-lg"
          style={{ color: "var(--text-2)" }}
        >
          Cancel
        </button>
        <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Schedule block</h2>
        <button
          onClick={save}
          disabled={saving}
          className="text-sm font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
          style={{ background: "var(--purple)" }}
        >
          {saving ? "…" : "Create"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
          {/* When? — pick Start now vs Schedule mode. Start-now hides the
              date/start pickers and computes start = current wall clock. */}
          <div>
            <label className="text-sm font-bold mb-2 block" style={{ color: "var(--text)" }}>When?</label>
            <div
              className="flex rounded-full border p-1 gap-1"
              style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}
            >
              <button
                type="button"
                onClick={() => setMode("now")}
                className="flex-1 text-sm font-semibold py-2 rounded-full transition-colors"
                style={mode === "now"
                  ? { background: "var(--purple)", color: "white" }
                  : { background: "transparent", color: "var(--text-2)" }}
              >
                Start now
              </button>
              <button
                type="button"
                onClick={() => setMode("schedule")}
                className="flex-1 text-sm font-semibold py-2 rounded-full transition-colors"
                style={mode === "schedule"
                  ? { background: "var(--purple)", color: "white" }
                  : { background: "transparent", color: "var(--text-2)" }}
              >
                Schedule
              </button>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>
              Block name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none border"
              style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
            />
          </div>

          {/* Date — Schedule mode only */}
          {mode === "schedule" && (
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none border"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
              />
            </div>
          )}

          {/* Start + Length — Start card only renders in Schedule mode. Now
              mode goes straight to Length with a note explaining. */}
          {(() => {
            const start = parseClock(startTime);
            const setStart = (h12: number, m: number, ampm: "AM" | "PM") => setStartTime(composeClock(h12, m, ampm));
            const bumpSH = (delta: number) => setStart(((start.h12 - 1 + delta + 12) % 12) + 1, start.m, start.ampm);
            const bumpSM = (delta: number) => setStart(start.h12, (start.m + delta + 60) % 60, start.ampm);
            const stepperBtn = "w-7 h-7 rounded-lg flex items-center justify-center border text-sm font-medium transition-colors flex-shrink-0";
            const numberInput = "w-8 text-center bg-transparent focus:outline-none tabular-nums font-bold";
            const numberStyle = { color: "var(--purple)", fontSize: "1.35rem", lineHeight: 1 } as const;
            const stepperStyle = { background: "var(--surface)", borderColor: "var(--purple-muted)", color: "var(--purple)" } as const;
            const sectionCard = "rounded-2xl border p-3 flex flex-col items-center";
            const sectionStyle = { background: "var(--surface)", borderColor: "var(--border-2)" } as const;
            const sectionLabel = "text-sm font-bold mb-2" as const;
            return (
              <div>
                <div className={mode === "schedule" ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
                  {/* Start — big tap-to-edit tiles with a horizontal AM/PM
                      segmented control underneath. Schedule mode only. */}
                  {mode === "schedule" && (
                    <div className={sectionCard} style={sectionStyle}>
                      <div className={sectionLabel} style={{ color: "var(--text)" }}>Start</div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={start.h12}
                          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setStart(Math.max(1, Math.min(12, Math.floor(v))), start.m, start.ampm); }}
                          className="w-14 h-14 text-center rounded-xl bg-transparent focus:outline-none tabular-nums font-bold"
                          style={{
                            background: "rgba(124,58,237,0.12)",
                            color: "var(--purple)",
                            fontSize: "1.75rem",
                            lineHeight: 1,
                          }}
                          aria-label="Start hour"
                        />
                        <span className="font-bold tabular-nums" style={{ color: "var(--text)", fontSize: "1.75rem", lineHeight: 1 }}>:</span>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          step={5}
                          value={String(start.m).padStart(2, "0")}
                          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setStart(start.h12, Math.max(0, Math.min(59, Math.floor(v))), start.ampm); }}
                          className="w-14 h-14 text-center rounded-xl bg-transparent focus:outline-none tabular-nums font-bold"
                          style={{
                            background: "var(--surface-2)",
                            color: "var(--text)",
                            fontSize: "1.75rem",
                            lineHeight: 1,
                          }}
                          aria-label="Start minutes"
                        />
                      </div>
                      {/* Horizontal AM/PM segmented control below the time */}
                      <div
                        className="flex rounded-lg overflow-hidden border mt-2"
                        style={{ borderColor: "var(--purple-muted)" }}
                      >
                        <button
                          type="button"
                          onClick={() => setStart(start.h12, start.m, "AM")}
                          className="px-4 py-1 text-xs font-bold transition-colors"
                          style={start.ampm === "AM"
                            ? { background: "rgba(124,58,237,0.14)", color: "var(--purple)" }
                            : { background: "var(--surface)", color: "var(--text-2)" }}
                        >
                          AM
                        </button>
                        <div className="w-px" style={{ background: "var(--purple-muted)" }} />
                        <button
                          type="button"
                          onClick={() => setStart(start.h12, start.m, "PM")}
                          className="px-4 py-1 text-xs font-bold transition-colors"
                          style={start.ampm === "PM"
                            ? { background: "rgba(124,58,237,0.14)", color: "var(--purple)" }
                            : { background: "var(--surface)", color: "var(--text-2)" }}
                        >
                          PM
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Length — big tap-to-edit tiles with +/- steppers.
                      Minutes step by 15 to match the requested cadence. */}
                  <div className={sectionCard} style={sectionStyle}>
                    <div className={sectionLabel} style={{ color: "var(--text)" }}>Length</div>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={durationH}
                          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setDurationH(Math.max(0, Math.min(23, Math.floor(v)))); }}
                          className="w-14 h-14 text-center rounded-xl bg-transparent focus:outline-none tabular-nums font-bold"
                          style={{
                            background: "rgba(124,58,237,0.12)",
                            color: "var(--purple)",
                            fontSize: "1.75rem",
                            lineHeight: 1,
                          }}
                          aria-label="Hours"
                        />
                        <div className="flex gap-1">
                          <button type="button" onClick={() => setDurationH((h) => Math.max(0, h - 1))} className="w-6 h-6 rounded-md flex items-center justify-center border text-sm font-medium" style={stepperStyle} aria-label="Decrease hours">−</button>
                          <button type="button" onClick={() => setDurationH((h) => Math.min(23, h + 1))} className="w-6 h-6 rounded-md flex items-center justify-center border text-sm font-medium" style={stepperStyle} aria-label="Increase hours">+</button>
                        </div>
                      </div>
                      <span className="font-bold tabular-nums" style={{ color: "var(--text)", fontSize: "1.75rem", lineHeight: 1, marginTop: -14 }}>:</span>
                      <div className="flex flex-col items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={59}
                          step={15}
                          value={String(durationM).padStart(2, "0")}
                          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setDurationM(Math.max(0, Math.min(59, Math.floor(v)))); }}
                          className="w-14 h-14 text-center rounded-xl bg-transparent focus:outline-none tabular-nums font-bold"
                          style={{
                            background: "var(--surface-2)",
                            color: "var(--text)",
                            fontSize: "1.75rem",
                            lineHeight: 1,
                          }}
                          aria-label="Minutes"
                        />
                        <div className="flex gap-1">
                          <button type="button" onClick={() => setDurationM((m) => (m - 15 + 60) % 60)} className="w-6 h-6 rounded-md flex items-center justify-center border text-sm font-medium" style={stepperStyle} aria-label="Decrease minutes">−</button>
                          <button type="button" onClick={() => setDurationM((m) => (m + 15) % 60)} className="w-6 h-6 rounded-md flex items-center justify-center border text-sm font-medium" style={stepperStyle} aria-label="Increase minutes">+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-center mt-3 tabular-nums" style={{ color: "var(--text-3)" }}>
                  {(() => {
                    const nowD = new Date();
                    const nowHHMM = `${String(nowD.getHours()).padStart(2, "0")}:${String(nowD.getMinutes()).padStart(2, "0")}`;
                    const src = mode === "now" ? nowHHMM : startTime;
                    return `Ends at ${to12h(endTimeFromDuration(src, durationH, durationM))}`;
                  })()}
                </div>
              </div>
            );
          })()}

          {/* Friends */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>
              Invite friends {invitedIds.size > 0 && `(${invitedIds.size})`}
            </label>
            {friends.length === 0 ? (
              <div className="text-sm rounded-xl px-3 py-3 border text-center" style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}>
                You don&apos;t have any friends yet — add them on the Profile tab.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {friends.map((f) => {
                  const sel = invitedIds.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleFriend(f.id)}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border font-medium transition-colors"
                      style={sel
                        ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                        : { background: "var(--surface)", color: "var(--text)", borderColor: "var(--border-2)" }}
                    >
                      <span>{f.avatar ?? "🙂"}</span>
                      <span>{f.username}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pick existing tasks */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>
              Pick tasks for this block {pickedIds.size > 0 && `(${pickedIds.size})`}
            </label>

            <div className="relative mb-2">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                placeholder="Search your tasks…"
                className="w-full text-sm rounded-xl pl-8 pr-3 py-2 focus:outline-none border"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
              />
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {filteredTasks.length === 0 && (
                <p className="text-xs text-center py-2" style={{ color: "var(--text-2)" }}>
                  {tasks.length === 0 ? "No open tasks yet" : "No tasks match"}
                </p>
              )}
              {filteredTasks.map((t) => {
                const sel = pickedIds.has(t.id);
                const isToday = t.scheduledFor === today;
                const isFuture = t.scheduledFor !== null && t.scheduledFor > today;
                return (
                  <button
                    key={t.id}
                    onClick={() => togglePick(t.id)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                    style={{
                      background: sel ? "rgba(124,58,237,0.06)" : "var(--surface)",
                      border: `1.5px solid ${sel ? "var(--purple)" : "var(--border-2)"}`,
                    }}
                  >
                    <div
                      className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-0.5"
                      style={sel
                        ? { background: "var(--purple)", border: "2px solid var(--purple)" }
                        : { border: "2px solid var(--border-3)" }}
                    >
                      {sel && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm" style={{ color: "var(--text)" }}>{t.text}</span>
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
                    {isFuture && t.scheduledFor && (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 whitespace-nowrap"
                        style={{ background: "rgba(124,58,237,0.12)", color: "var(--purple)" }}
                        title={`Scheduled for ${formatSchedulePill(t.scheduledFor)}`}
                      >
                        {formatSchedulePill(t.scheduledFor)}
                      </span>
                    )}
                    {isToday && (
                      <span
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: "var(--purple)" }}
                        title="Scheduled for today"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                          <polyline points="9 16 11 18 16 13" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add brand-new tasks */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>
              Add new tasks
            </label>

            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={newTaskInput}
                onChange={(e) => setNewTaskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }}
                placeholder="New task… (try #category)"
                className="flex-1 text-sm rounded-xl px-3 py-2.5 focus:outline-none border"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
              />
              <button
                onClick={addExtra}
                className="px-3 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "var(--purple)", color: "white" }}
              >
                Add
              </button>
            </div>

            {extraTasks.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {extraTasks.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(124,58,237,0.06)", border: "1px solid var(--purple)" }}
                  >
                    <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className="text-sm" style={{ color: "var(--text)" }}>{t.text}</span>
                      {t.tagNames.map((n) => {
                        const { bg, fg } = tagColor(n);
                        return (
                          <span
                            key={n}
                            className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: bg, color: fg }}
                          >
                            #{n}
                          </span>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => removeExtra(i)}
                      className="p-1 rounded transition-opacity hover:opacity-100"
                      style={{ color: "var(--text-2)", opacity: 0.7 }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div
              className="text-sm rounded-xl px-3 py-2.5 border"
              style={{ background: "rgba(220,38,38,0.08)", borderColor: "rgba(220,38,38,0.3)", color: "var(--red)" }}
            >
              {error}
            </div>
          )}

          {/* Duplicate the header Cancel / Create so users don't have to scroll
              back to the top after filling out the form. */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 text-sm font-semibold py-3 rounded-2xl border transition-colors"
              style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 text-sm font-bold py-3 rounded-2xl text-white disabled:opacity-50"
              style={{ background: "var(--purple)" }}
            >
              {saving ? "Creating…" : "Create block"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
