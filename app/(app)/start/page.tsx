"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Friend = { id: string; name: string; initials: string; color: string; username: string; userId: string };
type ListTask = { id: string; text: string; done: boolean; homeroom_id: string | null; sort_order: number; homeroomStatus?: string | null; scheduledForDate?: string | null; homeroomTitle?: string | null };

const USER_COLORS = ["#7C3AED","#0891B2","#059669","#D97706","#DC2626","#DB2777","#65A30D","#0284C7","#BE185D"];
function colorFromUsername(u: string): string {
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) & 0xffffffff;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

function StartPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scheduleOnly = searchParams.get("scheduleOnly") === "true";
  const supabase = createClient();

  const [myUserId, setMyUserId] = useState("");
  const [myUsername, setMyUsername] = useState("");
  const [myListTasks, setMyListTasks] = useState<ListTask[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [extraTasks, setExtraTasks] = useState<{ id: string; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [showAllTasks, setShowAllTasks] = useState(false);
  const TASK_LIMIT = 10;

  const [title, setTitle] = useState("");
  const [durationHours, setDurationHours] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [isPrivate, setIsPrivate] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">(scheduleOnly ? "later" : "now");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleHour, setScheduleHour] = useState("");
  const [scheduleMinute, setScheduleMinute] = useState("");
  const [schedulePeriod, setSchedulePeriod] = useState<"AM" | "PM">("AM");
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [friendSearch, setFriendSearch] = useState("");
  const [selectedSquads, setSelectedSquads] = useState<Set<string>>(new Set());
  const [userSquads, setUserSquads] = useState<{ id: string; name: string; emoji: string }[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [carryForward, setCarryForward] = useState<{ id: string; text: string }[]>([]);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem("homeroom-carry-forward");
      if (raw) {
        const tasks = JSON.parse(raw) as { id: string; text: string }[];
        setCarryForward(tasks);
        setSelectedIds(new Set(tasks.map(t => t.id)));
        localStorage.removeItem("homeroom-carry-forward");
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setMyUserId(user.id);
      const cached = localStorage.getItem("homeroom-username") ?? "";
      setMyUsername(cached);

      // Load friends via friend_requests (username-based for now)
      supabase.from("friend_requests")
        .select("from_username, to_username")
        .eq("status", "accepted")
        .or(`from_username.eq.${cached},to_username.eq.${cached}`)
        .then(async ({ data: fr }) => {
          if (!fr) return;
          const friendUsernames = fr.map(r => r.from_username === cached ? r.to_username : r.from_username);
          if (!friendUsernames.length) return;
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, username, avatar")
            .in("username", friendUsernames);
          if (profiles) {
            setFriends(profiles.map(p => ({
              id: p.username.toLowerCase(),
              name: p.username,
              initials: p.username.slice(0, 2).toUpperCase(),
              color: colorFromUsername(p.username),
              username: p.username,
              userId: p.id,
            })));
            const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
            const { data: presence } = await supabase
              .from("profiles")
              .select("id")
              .in("id", profiles.map(p => p.id))
              .gte("last_seen", cutoff);
            setOnlineUserIds(new Set((presence ?? []).map(p => p.id)));
          }
        });

      // Load my list tasks with homeroom status so badges are accurate
      supabase.from("tasks")
        .select("id, text, done, homeroom_id, sort_order")
        .eq("user_id", user.id)
        .eq("done", false)
        .order("sort_order", { ascending: true })
        .then(async ({ data }) => {
          if (!data) return;
          const ids = [...new Set(data.filter(t => t.homeroom_id).map(t => t.homeroom_id as string))];
          const { data: hrs } = ids.length
            ? await supabase.from("homerooms").select("id, title, status, scheduled_for").in("id", ids)
            : { data: [] };
          const hrMap = Object.fromEntries((hrs ?? []).map(h => [h.id, h]));
          const today = new Date(); today.setHours(0, 0, 0, 0);
          setMyListTasks(data.map(t => {
            const hr = t.homeroom_id ? hrMap[t.homeroom_id] : null;
            return {
              ...t,
              homeroomStatus: hr?.status ?? null,
              homeroomTitle: hr?.title ?? null,
              scheduledForDate: hr?.status === "scheduled" && hr.scheduled_for && new Date(hr.scheduled_for) >= today
                ? hr.scheduled_for : null,
            } as ListTask;
          }));
        });

      // Load squads
      supabase.from("squad_members")
        .select("squad_id, squads(id, name, emoji)")
        .eq("username", cached)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(({ data }) => {
          if (data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setUserSquads((data as any[]).flatMap(row => {
              const s = Array.isArray(row.squads) ? row.squads[0] : row.squads;
              return s ? [{ id: s.id, name: s.name, emoji: s.emoji }] : [];
            }));
          }
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalDuration = durationHours * 60 + durationMinutes;

  function toggleInvite(id: string) {
    setInvitedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function addExtra() {
    const text = input.trim();
    if (!text) return;
    setExtraTasks(prev => [...prev, { id: crypto.randomUUID(), text }]);
    setInput("");
  }

  async function launch() {
    if (!myUserId) { setError("Not logged in."); return; }
    setLaunching(true);
    setError("");

    let scheduledFor: string | null = null;
    if (scheduleMode === "later" && scheduleDate && scheduleHour) {
      const h24 = schedulePeriod === "PM"
        ? (parseInt(scheduleHour) % 12) + 12
        : parseInt(scheduleHour) % 12;
      scheduledFor = new Date(`${scheduleDate}T${String(h24).padStart(2,"0")}:${scheduleMinute.padStart(2,"0") || "00"}:00`).toISOString();
    }

    const isLive = scheduleMode === "now";

    // Create the homeroom
    const { data: homeroom, error: hrErr } = await supabase.from("homerooms").insert({
      created_by: myUserId,
      title: title.trim() || "Homeroom",
      is_private: isPrivate,
      duration: finalDuration,
      status: isLive ? "active" : "scheduled",
      scheduled_for: scheduledFor,
      started_at: isLive ? new Date().toISOString() : null,
      squad_tags: [...selectedSquads],
    }).select("id").single();

    if (hrErr || !homeroom) {
      setError("Failed to create homeroom: " + hrErr?.message);
      setLaunching(false);
      return;
    }

    const homeroomId = homeroom.id;

    // Create tasks for this homeroom
    const selectedFromList = myListTasks.filter(t => selectedIds.has(t.id));
    const taskInserts = [];

    // Extra one-off tasks
    for (const t of extraTasks) {
      taskInserts.push({ id: t.id, user_id: myUserId, text: t.text, done: false, homeroom_id: homeroomId, sort_order: taskInserts.length });
    }
    await supabase.from("tasks").insert(taskInserts.map(t => ({ ...t })));

    // Tag list tasks with this homeroom
    if (selectedFromList.length > 0) {
      await supabase.from("tasks").update({ homeroom_id: homeroomId })
        .in("id", selectedFromList.map(t => t.id));
    }

    // Send invites
    const invitedFriends = friends.filter(f => invitedIds.has(f.id));
    if (invitedFriends.length > 0) {
      await supabase.from("homeroom_invites").insert(
        invitedFriends.map(f => ({
          homeroom_id: homeroomId,
          from_user: myUserId,
          to_user: f.userId,
          status: "pending",
        }))
      );
    }

    if (isLive) {
      // Save any existing private active session to background before displacing it
      try {
        const existingId = localStorage.getItem("homeroom-active-id");
        if (existingId && existingId !== homeroomId) {
          const { data: existing } = await supabase
            .from("homerooms").select("id, is_private, status")
            .eq("id", existingId).eq("status", "active").single();
          if (existing?.is_private) {
            const prev: string[] = JSON.parse(localStorage.getItem("homeroom-bg-sessions") || "[]");
            if (!prev.includes(existingId)) {
              localStorage.setItem("homeroom-bg-sessions", JSON.stringify([...prev, existingId]));
            }
          }
        }
      } catch { /* ignore */ }
      localStorage.setItem("homeroom-active-id", homeroomId);
      router.push(`/room?id=${homeroomId}`);
    } else {
      router.push("/home");
    }
  }

  const carryForwardIds = new Set(carryForward.map(t => t.id));
  const allSelectableTasks = myListTasks.filter(t => !t.done && !carryForwardIds.has(t.id));

  return (
    <div className="max-w-2xl mx-auto px-4 pb-24">
      {/* Header */}
      <div className="pt-6 pb-6 flex items-center gap-3">
        <Link href="/home" className="text-warm-gray hover:text-charcoal">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="font-bold text-xl text-charcoal">Start a Homeroom</h1>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* Title */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-charcoal mb-2">What are you doing?</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What are you trying to accomplish?"
          className="w-full text-sm border border-gray-200 rounded-xl px-3 py-3 bg-cream text-charcoal placeholder:text-violet-500 placeholder:font-semibold focus:outline-none focus:border-sage transition-colors"
        />
        <p className="text-xs text-warm-gray mt-1.5">Will be shared as the title of your homeroom</p>
      </div>

      {/* When */}
      <div className="mb-6">
        {!scheduleOnly && (
          <>
            <label className="block text-sm font-semibold text-charcoal mb-2">When?</label>
            <div className="flex gap-2 mb-3">
              {([{ label: "Start now", value: "now" }, { label: "Schedule", value: "later" }] as const).map(opt => (
                <button key={opt.value} onClick={() => setScheduleMode(opt.value)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors"
                  style={scheduleMode === opt.value ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" } : { background: "var(--surface)", color: "var(--text-2)", borderColor: "#E5E2DC" }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
        {(scheduleOnly || scheduleMode === "later") && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-warm-gray mb-2 block">Date</label>
              <div className="relative flex items-center gap-3 border-2 rounded-xl px-3 py-2.5"
                style={{ borderColor: "var(--purple)", background: "var(--purple-bg-2)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span className="text-base font-semibold flex-1" style={{ color: scheduleDate ? "var(--purple)" : "var(--purple-light)" }}>
                  {scheduleDate ? new Date(scheduleDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "Pick a date"}
                </span>
                <input type="date" min={todayStr} value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </div>
            </div>
            <div>
              <label className="text-xs text-warm-gray mb-1 block">Time</label>
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="12" value={scheduleHour} onChange={e => setScheduleHour(e.target.value)} placeholder="12"
                  className="w-16 text-center text-base font-semibold border-2 rounded-xl px-1 py-2.5 focus:outline-none"
                  style={{ borderColor: "var(--purple)", color: "var(--purple)", background: "var(--purple-bg-2)" }} />
                <span className="text-base font-semibold text-charcoal">:</span>
                <input type="number" min="0" max="55" step="5" value={scheduleMinute} onChange={e => setScheduleMinute(e.target.value)} placeholder="00"
                  className="w-16 text-center text-base font-semibold border-2 rounded-xl px-1 py-2.5 focus:outline-none"
                  style={{ borderColor: "var(--purple)", color: "var(--purple)", background: "var(--purple-bg-2)" }} />
                <button onClick={() => setSchedulePeriod(p => p === "AM" ? "PM" : "AM")}
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl border-2 transition-colors"
                  style={{ borderColor: "var(--purple)", color: "var(--purple)", background: "var(--purple-bg-2)" }}>
                  {schedulePeriod}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Duration */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-charcoal mb-3">How long are you committing?</label>
        <div className="flex items-center gap-4">
          {/* Hours */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDurationHours(h => Math.min(23, h + 1))}
                className="w-9 h-9 rounded-xl text-lg font-bold flex items-center justify-center border-2 transition-colors"
                style={{ borderColor: "var(--purple)", color: "var(--purple)", background: "var(--purple-bg-2)" }}>+</button>
              <span className="w-8 text-center text-xl font-semibold" style={{ color: "var(--purple)" }}>{durationHours}</span>
              <button type="button" onClick={() => setDurationHours(h => Math.max(0, h - 1))}
                className="w-9 h-9 rounded-xl text-lg font-bold flex items-center justify-center border-2 transition-colors"
                style={{ borderColor: "var(--purple)", color: "var(--purple)", background: "var(--purple-bg-2)" }}>−</button>
            </div>
            <span className="text-xs text-warm-gray">hours</span>
          </div>
          <span className="text-xl font-semibold text-charcoal mb-4">:</span>
          {/* Minutes — cycles 0 / 15 / 30 / 45 */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDurationMinutes(m => m === 45 ? 0 : m + 15)}
                className="w-9 h-9 rounded-xl text-lg font-bold flex items-center justify-center border-2 transition-colors"
                style={{ borderColor: "var(--purple)", color: "var(--purple)", background: "var(--purple-bg-2)" }}>+</button>
              <span className="w-8 text-center text-xl font-semibold" style={{ color: "var(--purple)" }}>{String(durationMinutes).padStart(2, "0")}</span>
              <button type="button" onClick={() => setDurationMinutes(m => m === 0 ? 45 : m - 15)}
                className="w-9 h-9 rounded-xl text-lg font-bold flex items-center justify-center border-2 transition-colors"
                style={{ borderColor: "var(--purple)", color: "var(--purple)", background: "var(--purple-bg-2)" }}>−</button>
            </div>
            <span className="text-xs text-warm-gray">minutes</span>
          </div>
        </div>
      </div>

      {/* Visibility */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-charcoal mb-2">Who can join?</label>
        <div className="flex gap-2">
          {[{ label: "Public", value: false }, { label: "Friends only", value: true }].map(opt => (
            <button key={opt.label} onClick={() => setIsPrivate(opt.value)}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors"
              style={isPrivate === opt.value ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" } : { background: "var(--surface)", color: "var(--text-2)", borderColor: "#E5E2DC" }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Squad tags */}
      {userSquads.length > 0 && (
        <div className="mb-5">
          <label className="text-sm font-semibold text-charcoal mb-2 block">Tag a squad</label>
          <div className="flex flex-wrap gap-2">
            {userSquads.map(s => {
              const active = selectedSquads.has(s.id);
              return (
                <button key={s.id}
                  onClick={() => setSelectedSquads(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors"
                  style={active ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" } : { background: "var(--surface)", color: "var(--text-2)", borderColor: "#E5E2DC" }}>
                  <span>{s.emoji}</span><span>{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Invite friends */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-semibold text-charcoal">Invite friends</label>
          {friends.length > 5 && (
            <button onClick={() => setShowFriendsModal(true)} className="text-xs font-medium" style={{ color: "var(--purple)" }}>
              See all
            </button>
          )}
        </div>
        {friends.length === 0 ? (
          <p className="text-xs text-warm-gray">No friends yet — <a href="/profile" className="underline hover:text-charcoal transition-colors">add them on your profile</a></p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {friends.slice(0, 8).map(f => {
              const invited = invitedIds.has(f.id);
              const online = onlineUserIds.has((f as any).userId ?? "");
              return (
                <button key={f.id} onClick={() => toggleInvite(f.id)}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 transition-all"
                  style={{ borderColor: invited ? "var(--purple)" : "var(--border-2)", background: invited ? "var(--purple-bg-2)" : "var(--surface)" }}>
                  <div className="relative w-7 h-7 flex-shrink-0">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ background: f.color }}>
                      {f.initials}
                    </div>
                    {online && <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full border border-white" style={{ background: "#22C55E" }} />}
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

      {/* Friends modal */}
      {showFriendsModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowFriendsModal(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-charcoal">All friends</h2>
              <button onClick={() => setShowFriendsModal(false)} className="text-warm-gray hover:text-charcoal p-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <input type="text" value={friendSearch} onChange={e => setFriendSearch(e.target.value)} placeholder="Search…"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-cream text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage mb-3" />
            <div className="overflow-y-auto space-y-2 flex-1">
              {friends.filter(f => !friendSearch || f.name.toLowerCase().includes(friendSearch.toLowerCase())).map(f => {
                const invited = invitedIds.has(f.id);
                const online = onlineUserIds.has((f as any).userId ?? "");
                return (
                  <button key={f.id} onClick={() => toggleInvite(f.id)}
                    className="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all text-left"
                    style={{ borderColor: invited ? "var(--purple)" : "var(--border-2)", background: invited ? "var(--purple-bg-2)" : "var(--surface)" }}>
                    <div className="relative w-8 h-8 flex-shrink-0">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ background: f.color }}>{f.initials}</div>
                      {online && <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full border border-white" style={{ background: "#22C55E" }} />}
                    </div>
                    <span className="text-sm text-charcoal flex-1">{f.name}</span>
                    {invited && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setShowFriendsModal(false)} className="mt-4 w-full font-semibold text-sm py-3 rounded-xl text-white" style={{ background: "var(--text)" }}>Done</button>
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 pt-5 mb-4">
        <h2 className="text-sm font-semibold text-charcoal mb-1">What are you working on?</h2>
        <p className="text-xs text-warm-gray mb-3">Pick from your list or add tasks for this session.</p>
      </div>

      {/* Add extra task */}
      <div className="flex gap-2 mb-4">
        <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addExtra()}
          placeholder="Add a task just for this session…"
          className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-cream text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors" />
        <button onClick={addExtra} style={{ color: "var(--purple)" }} className="flex-shrink-0 hover:opacity-70 transition-opacity">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
          </svg>
        </button>
      </div>

      {extraTasks.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Added for this session</p>
          <div className="space-y-2">
            {extraTasks.map(t => (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex items-center gap-2">
                <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center" style={{ background: "var(--purple)", border: "2px solid var(--purple)" }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <span className="text-sm text-charcoal flex-1">{t.text}</span>
                <button onClick={() => setExtraTasks(prev => prev.filter(x => x.id !== t.id))} className="text-warm-gray hover:text-red-400 transition-colors p-1 text-xs">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {carryForward.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--purple)" }}>Tasks from previous homeroom</p>
          <div className="space-y-2">
            {carryForward.map(t => {
              const checked = selectedIds.has(t.id);
              return (
                <button key={t.id}
                  onClick={() => setSelectedIds(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                  className="w-full rounded-xl border px-3 py-2.5 flex items-center gap-2 hover:shadow-sm transition-all text-left"
                  style={{ borderColor: checked ? "var(--purple)" : "var(--border-2)", background: checked ? "var(--purple-bg-2)" : "var(--surface)" }}>
                  <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                    style={checked ? { background: "var(--purple)", border: "2px solid var(--purple)" } : { border: "2px solid var(--border-3)" }}>
                    {checked && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </div>
                  <span className="text-sm text-charcoal flex-1">{t.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {allSelectableTasks.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">From your list</p>
          <div className="space-y-2">
            {(showAllTasks ? allSelectableTasks : allSelectableTasks.slice(0, TASK_LIMIT)).map(t => {
              const checked = selectedIds.has(t.id);
              return (
                <button key={t.id}
                  onClick={() => setSelectedIds(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}
                  className="w-full bg-white rounded-xl border px-3 py-2.5 flex items-start gap-2 hover:shadow-sm transition-all text-left"
                  style={{ borderColor: checked ? "var(--purple)" : "var(--border-2)" }}>
                  <div className="w-4 h-4 rounded flex-shrink-0 mt-0.5 flex items-center justify-center"
                    style={checked ? { background: "var(--purple)", border: "2px solid var(--purple)" } : { border: "2px solid var(--border-3)" }}>
                    {checked && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-charcoal leading-snug">{t.text}</span>
                    {(t.homeroomStatus === "active" && t.homeroomTitle) || (t.scheduledForDate && t.homeroomTitle) ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.homeroomStatus === "active" && t.homeroomTitle && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: "var(--green-bg)", color: "var(--green-text)" }}>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0 inline-block" />
                            {t.homeroomTitle.length > 25 ? t.homeroomTitle.slice(0, 25) + "…" : t.homeroomTitle}
                          </span>
                        )}
                        {t.scheduledForDate && t.homeroomTitle && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>
                            {t.homeroomTitle.length > 25 ? t.homeroomTitle.slice(0, 25) + "…" : t.homeroomTitle} · {new Date(t.scheduledForDate).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
          {allSelectableTasks.length > TASK_LIMIT && (
            <button onClick={() => setShowAllTasks(v => !v)} className="mt-2 text-xs font-medium underline" style={{ color: "var(--purple)" }}>
              {showAllTasks ? "Show less" : `Show all ${allSelectableTasks.length} tasks`}
            </button>
          )}
        </div>
      )}

      {allSelectableTasks.length === 0 && extraTasks.length === 0 && (
        <p className="text-sm text-warm-gray mb-6">No tasks on your list yet — add some above.</p>
      )}

      <button onClick={launch} disabled={launching}
        className="w-full font-bold text-base py-4 rounded-2xl text-white shadow-md transition-colors disabled:opacity-50"
        style={{ background: "var(--text)" }}>
        {launching ? "Creating…" : scheduleMode === "now" ? "Start Homeroom" : "Schedule Homeroom"}
      </button>
    </div>
  );
}

export default function StartPage() {
  return (
    <Suspense>
      <StartPageInner />
    </Suspense>
  );
}
