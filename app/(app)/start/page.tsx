"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Task = { id: string; text: string };
type StoredTask = {
  id: string; text: string; done: boolean;
  estimatedMin?: number | null; addedAt?: string;
  scheduledForSessionId?: string;
  scheduledForDate?: string;
  scheduledForTitle?: string;
};

type Friend = { id: string; name: string; initials: string; color: string; username: string };

const USER_COLORS = ["#7C3AED","#0891B2","#059669","#D97706","#DC2626","#DB2777","#65A30D","#0284C7","#BE185D"];
function colorFromUsername(u: string): string {
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) & 0xffffffff;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

const SQUADS: { id: string; name: string; memberIds: string[] }[] = [];

export default function StartPage() {
  const router = useRouter();

  const [myListTasks, setMyListTasks] = useState<Task[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [extraTasks, setExtraTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [showAllTasks, setShowAllTasks] = useState(false);
  const TASK_LIMIT = 10;

  const [status, setStatus] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleHour, setScheduleHour] = useState("");
  const [scheduleMinute, setScheduleMinute] = useState("");
  const [schedulePeriod, setSchedulePeriod] = useState<"AM" | "PM">("AM");
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [friendSearch, setFriendSearch] = useState("");
  const [selectedSquads, setSelectedSquads] = useState<Set<string>>(new Set());
  const [friends, setFriends] = useState<Friend[]>([]);
  const [myUsername, setMyUsername] = useState("");

  function toggleSquad(id: string) {
    setSelectedSquads((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const maxDateStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  })();

  useEffect(() => {
    try {
      const stored = localStorage.getItem("homeroom-tasks");
      if (stored) {
        const parsed: StoredTask[] = JSON.parse(stored);
        const active = parsed.filter((t) => !t.done).map(({ id, text }) => ({ id, text }));
        setMyListTasks(active);
      }
    } catch { /* ignore */ }

    try {
      const carry = localStorage.getItem("homeroom-carry-forward");
      if (carry) {
        const carried: { id: string; text: string }[] = JSON.parse(carry);
        setExtraTasks(carried);
        localStorage.removeItem("homeroom-carry-forward");
      }
    } catch { /* ignore */ }

    const username = localStorage.getItem("homeroom-username") ?? "";
    console.log("[start] homeroom-username:", username);
    setMyUsername(username);
    if (username) {
      const supabase = createClient();
      supabase
        .from("friend_requests")
        .select("*")
        .eq("status", "accepted")
        .or(`from_username.eq.${username},to_username.eq.${username}`)
        .then(({ data, error }) => {
          console.log("[start] friend_requests query:", { data, error });
          if (data) {
            const mapped = data.map((r) => {
              const uname = r.from_username === username ? r.to_username : r.from_username;
              return { id: uname.toLowerCase(), name: uname, initials: uname.slice(0, 2).toUpperCase(), color: colorFromUsername(uname), username: uname };
            });
            console.log("[start] friends mapped:", mapped);
            setFriends(mapped);
          }
        });
    } else {
      console.warn("[start] no username in localStorage — friends won't load");
    }
  }, []);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleInvite(id: string) {
    setInvitedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addExtra() {
    const text = input.trim();
    if (!text) return;
    setExtraTasks((prev) => [...prev, { id: crypto.randomUUID(), text }]);
    setInput("");
  }

  function removeExtra(id: string) {
    setExtraTasks((prev) => prev.filter((t) => t.id !== id));
  }

  const finalDuration = (parseInt(durationHours) || 0) * 60 + (parseInt(durationMinutes) || 0);

  async function launch() {
    const selectedFromList = myListTasks.filter((t) => selectedIds.has(t.id));
    const allTasks = [...extraTasks, ...selectedFromList];
    const invitedFriends = friends.filter((f) => invitedIds.has(f.id));

    if (scheduleMode === "later" && scheduleDate && scheduleHour) {
      const h24 = schedulePeriod === "PM"
        ? (parseInt(scheduleHour) % 12) + 12
        : parseInt(scheduleHour) % 12;
      const scheduledFor = `${scheduleDate}T${String(h24).padStart(2, "0")}:${scheduleMinute.padStart(2, "0") || "00"}`;
      const session = { id: crypto.randomUUID(), title: status, duration: finalDuration, isPublic, tasks: allTasks, invitedFriends, scheduledFor, ownedByMe: true };
      const existing = (() => { try { return JSON.parse(localStorage.getItem("homeroom-scheduled") ?? "[]"); } catch { return []; } })();
      localStorage.setItem("homeroom-scheduled", JSON.stringify([...existing, session]));

      if (invitedFriends.length > 0) {
        if (!myUsername) {
          console.error("room_invites insert skipped: myUsername is empty");
        } else {
          const supabase = createClient();
          const results = await Promise.all(invitedFriends.map((f) =>
            supabase.from("room_invites").upsert({
              from_username: myUsername,
              to_username: f.username,
              session_id: session.id,
              title: status || "Homeroom",
              duration: finalDuration,
              is_public: isPublic,
              scheduled_for: scheduledFor,
            }, { onConflict: "session_id,to_username", ignoreDuplicates: true })
          ));
          results.forEach(({ error }, i) => {
            if (error) console.error(`room_invites insert failed for ${invitedFriends[i].username}:`, error.message);
          });
        }
      }

      // Add extra tasks to list and tag all tasks with this session
      try {
        const listRaw = localStorage.getItem("homeroom-tasks");
        let listTasks: StoredTask[] = listRaw ? JSON.parse(listRaw) : [];
        const taggedIds = new Set(allTasks.map((t) => t.id));
        // Add extra tasks that aren't already in the list
        for (const t of extraTasks) {
          if (!listTasks.some((lt) => lt.id === t.id)) {
            listTasks.push({
              id: t.id, text: t.text, done: false,
              estimatedMin: null, addedAt: new Date().toISOString(),
              scheduledForSessionId: session.id,
              scheduledForDate: session.scheduledFor,
              scheduledForTitle: session.title || "Homeroom",
            });
          }
        }
        // Tag selected list tasks
        listTasks = listTasks.map((lt) =>
          taggedIds.has(lt.id)
            ? { ...lt, scheduledForSessionId: session.id, scheduledForDate: session.scheduledFor, scheduledForTitle: session.title || "Homeroom" }
            : lt
        );
        localStorage.setItem("homeroom-tasks", JSON.stringify(listTasks));
      } catch { /* ignore */ }

      router.push("/home");
    } else {
      // Live session — add extra tasks to the list (no scheduling tags)
      if (extraTasks.length > 0) {
        try {
          const listRaw = localStorage.getItem("homeroom-tasks");
          const listTasks: StoredTask[] = listRaw ? JSON.parse(listRaw) : [];
          for (const t of extraTasks) {
            if (!listTasks.some((lt) => lt.id === t.id)) {
              listTasks.push({ id: t.id, text: t.text, done: false, estimatedMin: null, addedAt: new Date().toISOString() });
            }
          }
          localStorage.setItem("homeroom-tasks", JSON.stringify(listTasks));
        } catch { /* ignore */ }
      }
      const liveSessionId = crypto.randomUUID();
      localStorage.setItem("homeroom-session", JSON.stringify({
        sessionId: liveSessionId, title: status, duration: finalDuration, isPublic, tasks: allTasks, invitedFriends, scheduledFor: null,
      }));

      if (invitedFriends.length > 0) {
        if (!myUsername) {
          console.error("[start] live invite skipped: myUsername is empty");
        } else {
          console.log("[start] inserting live invite for:", invitedFriends.map(f => f.username), "from:", myUsername);
          const supabase = createClient();
          const results = await Promise.all(invitedFriends.map((f) =>
            supabase.from("room_invites").upsert({
              from_username: myUsername,
              to_username: f.username,
              session_id: liveSessionId,
              title: status || "Homeroom",
              duration: finalDuration,
              is_public: isPublic,
              scheduled_for: null,
            }, { onConflict: "session_id,to_username", ignoreDuplicates: true })
          ));
          results.forEach(({ error }, i) => {
            if (error) console.error(`[start] live invite failed for ${invitedFriends[i].username}:`, error.message);
            else console.log(`[start] live invite inserted for ${invitedFriends[i].username}`);
          });
        }
      }

      router.push("/room");
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pb-24">
      {/* Header */}
      <div className="pt-6 pb-4 flex items-center gap-3">
        <Link href="/list" className="text-warm-gray hover:text-charcoal">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="font-bold text-lg text-charcoal">Start a Homeroom</h1>
      </div>

      {/* Two-column: left = settings, right = when */}
      <div className="flex gap-4 mb-5">
        {/* Left: status + duration + visibility */}
        <div className="flex-1 min-w-0">
          {/* Status */}
          <div className="mb-5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-charcoal whitespace-nowrap">I am</span>
              <input
                type="text"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="short description of what you're trying to accomplish"
                className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-cream text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
              />
            </div>
            <p className="text-xs text-warm-gray mt-1.5 ml-9">Will be shared as title of homeroom</p>
          </div>

          {/* Duration */}
          <div className="mb-5">
            <label className="block text-sm font-semibold text-charcoal mb-3">How long are you committing?</label>
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  placeholder="0"
                  className="w-16 text-center text-xl font-semibold border-2 rounded-xl px-2 py-2 focus:outline-none"
                  style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }}
                />
                <span className="text-xs text-warm-gray">hours</span>
              </div>
              <span className="text-xl font-semibold text-charcoal pb-4">:</span>
              <div className="flex flex-col items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="0"
                  className="w-16 text-center text-xl font-semibold border-2 rounded-xl px-2 py-2 focus:outline-none"
                  style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }}
                />
                <span className="text-xs text-warm-gray">minutes</span>
              </div>
              {finalDuration > 0 && (
                <span className="text-sm text-warm-gray pb-4">{finalDuration} min</span>
              )}
            </div>
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-semibold text-charcoal mb-3">Who can join?</label>
            <div className="flex gap-2 flex-wrap">
              {[{ label: "Public", value: true }, { label: "Friends only", value: false }].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setIsPublic(opt.value)}
                  className="px-4 py-1.5 rounded-full text-sm font-medium border transition-colors"
                  style={isPublic === opt.value
                    ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" }
                    : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: when */}
        <div className="w-40 flex-shrink-0">
          <label className="block text-sm font-semibold text-charcoal mb-3">When?</label>
          <div className="flex flex-col gap-2 mb-3">
            {([{ label: "Start now", value: "now" }, { label: "Schedule", value: "later" }] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setScheduleMode(opt.value)}
                className="w-full px-3 py-1.5 rounded-full text-sm font-medium border transition-colors text-left"
                style={scheduleMode === opt.value
                  ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" }
                  : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {scheduleMode === "later" && (
            <div className="flex flex-col gap-2">
              <div>
                <label className="text-xs text-warm-gray mb-1 block">Date</label>
                <input
                  type="date"
                  min={todayStr}
                  max={maxDateStr}
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-cream text-charcoal focus:outline-none focus:border-sage transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-warm-gray mb-1 block">Time</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={scheduleHour}
                    onChange={(e) => setScheduleHour(e.target.value)}
                    placeholder="12"
                    className="w-12 text-center text-base font-semibold border-2 rounded-lg px-1 py-1.5 focus:outline-none"
                    style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }}
                  />
                  <span className="text-base font-semibold text-charcoal">:</span>
                  <input
                    type="number"
                    min="0"
                    max="55"
                    step="5"
                    value={scheduleMinute}
                    onChange={(e) => setScheduleMinute(e.target.value)}
                    placeholder="00"
                    className="w-12 text-center text-base font-semibold border-2 rounded-lg px-1 py-1.5 focus:outline-none"
                    style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }}
                  />
                  <button
                    onClick={() => setSchedulePeriod((p) => p === "AM" ? "PM" : "AM")}
                    className="text-xs font-semibold px-2 py-1.5 rounded-lg border-2 transition-colors"
                    style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }}
                  >
                    {schedulePeriod}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invite friends — full width, same as tasks below */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-semibold text-charcoal">Invite friends</label>
          <button
            onClick={() => setShowFriendsModal(true)}
            className="text-xs font-medium"
            style={{ color: "#7C3AED" }}
          >
            Find other friends
          </button>
        </div>
        {friends.length === 0 ? (
          <p className="text-xs text-warm-gray">
            No friends yet —{" "}
            <a href="/profile" className="underline hover:text-charcoal transition-colors">add them on your profile</a>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {friends.map((f: Friend) => {
              const invited = invitedIds.has(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => toggleInvite(f.id)}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 transition-all"
                  style={{ borderColor: invited ? "#7C3AED" : "#E5E7EB", background: invited ? "#F5F3FF" : "white" }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                    style={{ background: f.color }}
                  >
                    {f.initials}
                  </div>
                  <span className="text-sm text-charcoal">{f.name}</span>
                  {invited && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* All friends modal */}
      {showFriendsModal && (() => {
        const squadMemberIds = selectedSquads.size > 0
          ? new Set(SQUADS.filter((s) => selectedSquads.has(s.id)).flatMap((s) => s.memberIds))
          : null;
        const visibleFriends = friends.filter((f: Friend) => {
          if (squadMemberIds && !squadMemberIds.has(f.id)) return false;
          if (friendSearch && !f.name.toLowerCase().includes(friendSearch.toLowerCase())) return false;
          return true;
        });
        const allVisibleSelected = visibleFriends.length > 0 && visibleFriends.every((f) => invitedIds.has(f.id));

        function selectAll() {
          setInvitedIds((prev) => {
            const next = new Set(prev);
            visibleFriends.forEach((f) => next.add(f.id));
            return next;
          });
        }

        function deselectAll() {
          setInvitedIds((prev) => {
            const next = new Set(prev);
            visibleFriends.forEach((f) => next.delete(f.id));
            return next;
          });
        }

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowFriendsModal(false)} />
            <div className="relative bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-charcoal">All friends</h2>
                <button onClick={() => setShowFriendsModal(false)} className="text-warm-gray hover:text-charcoal p-1">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Search */}
              <input
                type="text"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                placeholder="Search friends…"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-cream text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors mb-3"
              />

              {/* Squad filter — multi-select pills */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {SQUADS.map((s) => {
                  const active = selectedSquads.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSquad(s.id)}
                      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
                      style={active
                        ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" }
                        : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>

              {/* Select all row */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-warm-gray">{visibleFriends.length} shown</span>
                <button
                  onClick={allVisibleSelected ? deselectAll : selectAll}
                  className="text-xs font-medium underline"
                  style={{ color: "#7C3AED" }}
                >
                  {allVisibleSelected ? "Deselect all" : "Select all"}
                </button>
              </div>

              {/* Friend list */}
              <div className="overflow-y-auto space-y-2 flex-1">
                {visibleFriends.length === 0 ? (
                  <p className="text-sm text-warm-gray text-center py-6">No friends found.</p>
                ) : visibleFriends.map((f) => {
                  const invited = invitedIds.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleInvite(f.id)}
                      className="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all text-left"
                      style={{ borderColor: invited ? "#7C3AED" : "#E5E7EB", background: invited ? "#F5F3FF" : "white" }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                        style={{ background: f.color }}
                      >
                        {f.initials}
                      </div>
                      <p className="text-sm text-charcoal flex-1 min-w-0">{f.name}</p>
                      {invited && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setShowFriendsModal(false)}
                className="mt-4 w-full font-semibold text-sm py-3 rounded-xl text-white"
                style={{ background: "#1C1917" }}
              >
                Done
              </button>
            </div>
          </div>
        );
      })()}

      <div className="border-t border-gray-100 pt-5 mb-4">
        <h2 className="text-sm font-semibold text-charcoal mb-1">What are you working on?</h2>
        <p className="text-xs text-warm-gray mb-3">Pick from your list or add tasks for this session.</p>
      </div>

      {/* Add extra task */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addExtra()}
          placeholder="Add a task just for this session…"
          className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-cream text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
        />
        <button onClick={addExtra} style={{ color: "#7C3AED" }} className="flex-shrink-0 hover:opacity-70 transition-opacity">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
          </svg>
        </button>
      </div>

      {/* Extra tasks added for this session */}
      {extraTasks.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Added for this session</p>
          <div className="space-y-2">
            {extraTasks.map((t) => (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-2">
                <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center" style={{ background: "#7C3AED", border: "2px solid #7C3AED" }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span className="text-sm text-charcoal flex-1">{t.text}</span>
                <button onClick={() => removeExtra(t.id)} className="text-warm-gray hover:text-red-400 transition-colors p-1 text-xs">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks from My List */}
      {myListTasks.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">From your list</p>
          <div className="space-y-2">
            {(showAllTasks ? myListTasks : myListTasks.slice(0, TASK_LIMIT)).map((t) => {
              const checked = selectedIds.has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggleSelect(t.id)}
                  className="w-full bg-white rounded-xl border px-3 py-2.5 flex items-center gap-2 hover:shadow-sm transition-all text-left"
                  style={{ borderColor: checked ? "#7C3AED" : "#E5E7EB" }}
                >
                  <div
                    className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                    style={checked
                      ? { background: "#7C3AED", border: "2px solid #7C3AED" }
                      : { border: "2px solid #D1D5DB" }}
                  >
                    {checked && (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-charcoal flex-1">{t.text}</span>
                </button>
              );
            })}
          </div>
          {myListTasks.length > TASK_LIMIT && (
            <button
              onClick={() => setShowAllTasks((v) => !v)}
              className="mt-2 text-xs font-medium underline"
              style={{ color: "#7C3AED" }}
            >
              {showAllTasks ? "Show less" : `Show all ${myListTasks.length} tasks`}
            </button>
          )}
        </div>
      )}

      {myListTasks.length === 0 && extraTasks.length === 0 && (
        <p className="text-sm text-warm-gray mb-6">No tasks on your list yet — add some above.</p>
      )}

      <button
        onClick={launch}
        className="w-full font-bold text-base py-4 rounded-2xl text-white shadow-md transition-colors"
        style={{ background: "#1C1917" }}
      >
        Start Homeroom
      </button>
    </div>
  );
}
