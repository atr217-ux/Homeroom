"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

export default function StartPage() {
  const router = useRouter();
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
  const [durationHours, setDurationHours] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
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
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  const todayStr = new Date().toISOString().slice(0, 10);

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

  const finalDuration = (parseInt(durationHours) || 0) * 60 + (parseInt(durationMinutes) || 0);

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
      scheduledFor = `${scheduleDate}T${String(h24).padStart(2,"0")}:${scheduleMinute.padStart(2,"0") || "00"}:00`;
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
      localStorage.setItem("homeroom-active-id", homeroomId);
      router.push(`/room?id=${homeroomId}`);
    } else {
      router.push("/home");
    }
  }

  const allSelectableTasks = myListTasks.filter(t => !t.done);

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
          placeholder="Short description of what you're trying to accomplish"
          className="w-full text-sm border border-gray-200 rounded-xl px-3 py-3 bg-cream text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
        />
        <p className="text-xs text-warm-gray mt-1.5">Will be shared as the title of your homeroom</p>
      </div>

      {/* When */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-charcoal mb-2">When?</label>
        <div className="flex gap-2">
          {([{ label: "Start now", value: "now" }, { label: "Schedule", value: "later" }] as const).map(opt => (
            <button key={opt.value} onClick={() => setScheduleMode(opt.value)}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors"
              style={scheduleMode === opt.value ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" } : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}>
              {opt.label}
            </button>
          ))}
        </div>
        {scheduleMode === "later" && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-xs text-warm-gray mb-1 block">Date</label>
              <input type="date" min={todayStr} value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-cream text-charcoal focus:outline-none focus:border-sage transition-colors" />
            </div>
            <div>
              <label className="text-xs text-warm-gray mb-1 block">Time</label>
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="12" value={scheduleHour} onChange={e => setScheduleHour(e.target.value)} placeholder="12"
                  className="w-16 text-center text-base font-semibold border-2 rounded-xl px-1 py-2.5 focus:outline-none"
                  style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }} />
                <span className="text-base font-semibold text-charcoal">:</span>
                <input type="number" min="0" max="55" step="5" value={scheduleMinute} onChange={e => setScheduleMinute(e.target.value)} placeholder="00"
                  className="w-16 text-center text-base font-semibold border-2 rounded-xl px-1 py-2.5 focus:outline-none"
                  style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }} />
                <button onClick={() => setSchedulePeriod(p => p === "AM" ? "PM" : "AM")}
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl border-2 transition-colors"
                  style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }}>
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
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center gap-1">
            <input type="number" min="0" max="23" value={durationHours} onChange={e => setDurationHours(e.target.value)} placeholder="0"
              className="w-20 text-center text-xl font-semibold border-2 rounded-xl px-2 py-2.5 focus:outline-none"
              style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }} />
            <span className="text-xs text-warm-gray">hours</span>
          </div>
          <span className="text-xl font-semibold text-charcoal pb-5">:</span>
          <div className="flex flex-col items-center gap-1">
            <input type="number" min="0" max="59" value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)} placeholder="0"
              className="w-20 text-center text-xl font-semibold border-2 rounded-xl px-2 py-2.5 focus:outline-none"
              style={{ borderColor: "#7C3AED", color: "#7C3AED", background: "#EDE9FE" }} />
            <span className="text-xs text-warm-gray">minutes</span>
          </div>
          {finalDuration > 0 && <span className="text-sm text-warm-gray pb-5">{finalDuration} min</span>}
        </div>
      </div>

      {/* Visibility */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-charcoal mb-2">Who can join?</label>
        <div className="flex gap-2">
          {[{ label: "Public", value: false }, { label: "Friends only", value: true }].map(opt => (
            <button key={opt.label} onClick={() => setIsPrivate(opt.value)}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors"
              style={isPrivate === opt.value ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" } : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}>
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
                  style={active ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" } : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}>
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
            <button onClick={() => setShowFriendsModal(true)} className="text-xs font-medium" style={{ color: "#7C3AED" }}>
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
              return (
                <button key={f.id} onClick={() => toggleInvite(f.id)}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 transition-all"
                  style={{ borderColor: invited ? "#7C3AED" : "#E5E7EB", background: invited ? "#F5F3FF" : "white" }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: f.color }}>
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
                return (
                  <button key={f.id} onClick={() => toggleInvite(f.id)}
                    className="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all text-left"
                    style={{ borderColor: invited ? "#7C3AED" : "#E5E7EB", background: invited ? "#F5F3FF" : "white" }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: f.color }}>{f.initials}</div>
                    <span className="text-sm text-charcoal flex-1">{f.name}</span>
                    {invited && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setShowFriendsModal(false)} className="mt-4 w-full font-semibold text-sm py-3 rounded-xl text-white" style={{ background: "#1C1917" }}>Done</button>
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
        <button onClick={addExtra} style={{ color: "#7C3AED" }} className="flex-shrink-0 hover:opacity-70 transition-opacity">
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
                <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center" style={{ background: "#7C3AED", border: "2px solid #7C3AED" }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <span className="text-sm text-charcoal flex-1">{t.text}</span>
                <button onClick={() => setExtraTasks(prev => prev.filter(x => x.id !== t.id))} className="text-warm-gray hover:text-red-400 transition-colors p-1 text-xs">✕</button>
              </div>
            ))}
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
                  className="w-full bg-white rounded-xl border px-3 py-2.5 flex items-center gap-2 hover:shadow-sm transition-all text-left"
                  style={{ borderColor: checked ? "#7C3AED" : "#E5E7EB" }}>
                  <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                    style={checked ? { background: "#7C3AED", border: "2px solid #7C3AED" } : { border: "2px solid #D1D5DB" }}>
                    {checked && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </div>
                  <span className="text-sm text-charcoal flex-1">{t.text}</span>
                  {t.homeroomStatus === "active" && t.homeroomTitle && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1" style={{ background: "#ECFDF5", color: "#065F46" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      {t.homeroomTitle}
                    </span>
                  )}
                  {t.scheduledForDate && t.homeroomTitle && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: "#FEF9C3", color: "#92400E" }}>
                      {t.homeroomTitle} · {new Date(t.scheduledForDate).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {allSelectableTasks.length > TASK_LIMIT && (
            <button onClick={() => setShowAllTasks(v => !v)} className="mt-2 text-xs font-medium underline" style={{ color: "#7C3AED" }}>
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
        style={{ background: "#1C1917" }}>
        {launching ? "Creating…" : scheduleMode === "now" ? "Start Homeroom" : "Schedule Homeroom"}
      </button>
    </div>
  );
}
