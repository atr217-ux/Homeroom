"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const USER_COLORS = ["#7C3AED","#0891B2","#059669","#D97706","#DC2626","#DB2777","#65A30D","#0284C7","#BE185D"];
function colorFromUsername(u: string): string {
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) & 0xffffffff;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

type Friend = { id: string; name: string; initials: string; color: string };
type ScheduledSession = {
  id: string;
  title: string;
  duration: number;
  isPublic: boolean;
  scheduledFor: string;
  invitedFriends: Friend[];
  tasks: { id: string; text: string }[];
  ownedByMe?: boolean;
};

type Invite = {
  id: string;
  from: Friend;
  title: string;
  duration: number;
  isLive: boolean;
  scheduledFor: string | null;
  sessionId: string;
};

type TimeChangeNotif = {
  id: string;
  from: Friend;
  sessionTitle: string;
  originalTime: string;
  newTime: string;
  duration: number;
  sessionPayload: Omit<ScheduledSession, "id" | "scheduledFor" | "ownedByMe">;
};

type ListTask = {
  id: string;
  text: string;
  done: boolean;
  scheduledForSessionId?: string;
  scheduledForDate?: string;
  scheduledForTitle?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function cleanTitle(title: string, hostUsername: string): string {
  const prefix = `${hostUsername} is `;
  if (title.startsWith(prefix)) return title.slice(prefix.length);
  return title;
}

function formatScheduledFor(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 0) return "overdue";
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h ${diffMin % 60}m`;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatFullDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatDuration(min: number): string {
  if (min === 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sessionDateKey(iso: string): string {
  return dateKey(new Date(iso));
}

function isoTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoToTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function minDateInput(): string {
  return isoToDateInput(new Date().toISOString());
}

function canStart(session: ScheduledSession, now: number): boolean {
  return now >= new Date(session.scheduledFor).getTime() - 5 * 60 * 1000;
}

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Session card ─────────────────────────────────────────────────────────────

type SessionCardProps = {
  session: ScheduledSession;
  now: number;
  onLaunch: (s: ScheduledSession) => void;
  onRemove: (id: string) => void;
  onPrepop: (s: ScheduledSession) => void;
  onEdit: (s: ScheduledSession) => void;
  showTime?: boolean;
};

function SessionCard({ session, now, onLaunch, onRemove, onPrepop, onEdit, showTime }: SessionCardProps) {
  const owned = session.ownedByMe === true;
  const active = canStart(session, now);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 space-y-2.5">
      {/* Row 1: title + status badge */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-charcoal leading-snug">{session.title || "Homeroom"}</p>
        {active && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 flex-shrink-0">
            Ready
          </span>
        )}
      </div>

      {/* Row 2: date/time + metadata chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium" style={{ color: active ? "#059669" : "#7C3AED" }}>
          {showTime ? isoTimeLabel(session.scheduledFor) : formatScheduledFor(session.scheduledFor)}
        </span>
        {session.duration > 0 && (
          <span className="text-xs text-warm-gray bg-gray-50 px-2 py-0.5 rounded-full">
            {formatDuration(session.duration)}
          </span>
        )}
        <span className="text-xs text-warm-gray bg-gray-50 px-2 py-0.5 rounded-full">
          {session.isPublic ? "Public" : "Friends only"}
        </span>
        {session.tasks.length > 0 && (
          <span className="text-xs text-warm-gray bg-gray-50 px-2 py-0.5 rounded-full">
            {session.tasks.length} task{session.tasks.length !== 1 ? "s" : ""}
          </span>
        )}
        {session.invitedFriends.length > 0 && (
          <div className="flex items-center gap-0.5">
            {session.invitedFriends.slice(0, 4).map((f) => (
              <div
                key={f.id}
                className="w-5 h-5 rounded-full flex items-center justify-center text-white flex-shrink-0"
                style={{ background: f.color, fontSize: "9px" }}
                title={f.name}
              >
                {f.initials}
              </div>
            ))}
            {session.invitedFriends.length > 4 && (
              <span className="text-xs text-warm-gray ml-0.5">+{session.invitedFriends.length - 4}</span>
            )}
          </div>
        )}
      </div>

      {/* Row 3: action buttons */}
      {confirming ? (
        <div className="flex items-center gap-3 pt-0.5">
          <span className="text-xs text-warm-gray">{owned ? "Cancel homeroom?" : "Leave homeroom?"}</span>
          <button onClick={() => onRemove(session.id)} className="text-xs font-semibold text-red-500 hover:text-red-600 transition-colors">Yes</button>
          <button onClick={() => setConfirming(false)} className="text-xs text-warm-gray hover:text-charcoal transition-colors">No</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={() => onPrepop(session)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors hover:border-sage hover:text-sage flex-1 justify-center"
            style={{ borderColor: "#E5E7EB", color: "#78716C" }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            Tasks
          </button>
          {owned && (
            <button
              onClick={() => onEdit(session)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors hover:border-sage hover:text-sage flex-1 justify-center"
              style={{ borderColor: "#E5E7EB", color: "#78716C" }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
          <button
            onClick={() => active && onLaunch(session)}
            disabled={!active}
            className="text-xs font-semibold px-4 py-1.5 rounded-xl border transition-colors flex-1 justify-center flex items-center"
            style={
              active
                ? { borderColor: "#7C3AED", color: "#7C3AED" }
                : { borderColor: "#E5E7EB", color: "#D1D5DB", cursor: "default" }
            }
            title={active ? undefined : `Available ${formatScheduledFor(session.scheduledFor)}`}
          >
            {owned ? "Start" : "Join"}
          </button>
          <button
            onClick={() => setConfirming(true)}
            className="text-xs text-warm-gray hover:text-red-400 transition-colors px-1"
          >
            {owned ? "Cancel" : "Leave"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Calendar view ────────────────────────────────────────────────────────────

type CalendarViewProps = {
  scheduled: ScheduledSession[];
  now: number;
  onLaunch: (s: ScheduledSession) => void;
  onRemove: (id: string) => void;
  onPrepop: (s: ScheduledSession) => void;
  onEdit: (s: ScheduledSession) => void;
};

function CalendarView({ scheduled, now, onLaunch, onRemove, onPrepop, onEdit }: CalendarViewProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 14);

  const gridStart = new Date(today);
  gridStart.setDate(today.getDate() - today.getDay());

  const gridEnd = new Date(maxDate);
  gridEnd.setDate(maxDate.getDate() + (6 - maxDate.getDay()));

  const days: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const monthHeaders: { label: string }[] = [];
  let lastMonth = -1;
  days.forEach((d) => {
    if (d.getMonth() !== lastMonth) {
      monthHeaders.push({ label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` });
      lastMonth = d.getMonth();
    }
  });

  const sessionsByDate: Record<string, ScheduledSession[]> = {};
  scheduled.forEach((s) => {
    const key = sessionDateKey(s.scheduledFor);
    if (!sessionsByDate[key]) sessionsByDate[key] = [];
    sessionsByDate[key].push(s);
  });

  function isDisabled(d: Date) { return d < today || d > maxDate; }
  function isToday(d: Date) { return dateKey(d) === dateKey(today); }

  const selectedSessions = selectedKey ? (sessionsByDate[selectedKey] ?? []) : [];

  return (
    <div>
      {monthHeaders.length > 1 ? (
        <div className="flex justify-between px-0.5 mb-1">
          {monthHeaders.map((mh) => (
            <span key={mh.label} className="text-xs font-semibold text-charcoal">{mh.label}</span>
          ))}
        </div>
      ) : (
        <p className="text-xs font-semibold text-charcoal mb-2">{monthHeaders[0]?.label}</p>
      )}

      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((l) => (
          <div key={l} className="text-center text-xs text-warm-gray font-medium py-1">{l}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {days.map((d) => {
          const key = dateKey(d);
          const disabled = isDisabled(d);
          const todayDay = isToday(d);
          const hasSessions = !disabled && (sessionsByDate[key]?.length ?? 0) > 0;
          const selected = selectedKey === key;

          return (
            <button
              key={key}
              disabled={disabled}
              onClick={() => setSelectedKey(selected ? null : key)}
              className="flex flex-col items-center justify-center py-1.5 rounded-xl transition-colors"
              style={selected ? { background: "#7C3AED" } : todayDay ? { background: "#EDE9FE" } : {}}
            >
              <span
                className="text-sm font-medium leading-none"
                style={
                  disabled ? { color: "#D1D5DB" }
                  : selected ? { color: "white" }
                  : todayDay ? { color: "#7C3AED", fontWeight: 700 }
                  : { color: "#1C1917" }
                }
              >
                {d.getDate()}
              </span>
              <span
                className="mt-1 w-1.5 h-1.5 rounded-full"
                style={{ background: hasSessions ? (selected ? "rgba(255,255,255,0.7)" : "#7C3AED") : "transparent" }}
              />
            </button>
          );
        })}
      </div>

      {selectedKey && (
        <div className="mt-3 space-y-2">
          {selectedSessions.length === 0 ? (
            <p className="text-xs text-warm-gray text-center py-3">No homerooms on this day.</p>
          ) : (
            selectedSessions
              .slice()
              .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
              .map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  now={now}
                  onLaunch={onLaunch}
                  onRemove={onRemove}
                  onPrepop={onPrepop}
                  onEdit={onEdit}
                  showTime
                />
              ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type ActiveSession = {
  title: string;
  duration: number;
  sessionStartTime: number;
  sessionId?: string;
  isPublic?: boolean;
};

type PublicActiveRoom = {
  id: string;
  session_id: string;
  host_username: string;
  title: string;
  duration: number;
  started_at: string;
  squad_tags: string[];
};

type PublicScheduledSession = {
  id: string;
  session_id: string;
  host_username: string;
  title: string;
  duration: number;
  scheduled_for: string;
  squad_tags: string[];
};

type UserSquad = { id: string; name: string; emoji: string };

export default function HomePage() {
  const router = useRouter();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledSession[]>([]);
  const [schedView, setSchedView] = useState<"list" | "calendar">("list");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [declinedInvites, setDeclinedInvites] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [, setTick] = useState(0);
  const [publicRooms, setPublicRooms] = useState<PublicActiveRoom[]>([]);
  const [publicScheduled, setPublicScheduled] = useState<PublicScheduledSession[]>([]);
  const [userSquads, setUserSquads] = useState<UserSquad[]>([]);
  const [squadFilter, setSquadFilter] = useState<string | null>(null);
  const [pubSchedDateFilter, setPubSchedDateFilter] = useState<string | null>(null);
  const [savedSessionIds, setSavedSessionIds] = useState<Set<string>>(new Set());

  // Time change notifications
  const [timeChanges] = useState<TimeChangeNotif[]>([]);
  const [declinedTimeChanges, setDeclinedTimeChanges] = useState<Set<string>>(new Set());

  // All list tasks — loaded once, kept in sync when prepop saves
  const [allListTasks, setAllListTasks] = useState<ListTask[]>([]);

  // Pre-populate tasks modal
  const [prepopSession, setPrepopSession] = useState<ScheduledSession | null>(null);
  const [prepopSelected, setPrepopSelected] = useState<Set<string>>(new Set());
  const [prepopSearch, setPrepopSearch] = useState("");

  const [friends, setFriends] = useState<Friend[]>([]);
  const [roomParticipants, setRoomParticipants] = useState<Record<string, string[]>>({});
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

  // Edit session modal
  const [editingSession, setEditingSession] = useState<ScheduledSession | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editInvitedIds, setEditInvitedIds] = useState<Set<string>>(new Set());

  async function loadRoomParticipants(sessionIds: string[]) {
    if (!sessionIds.length) return;
    const supabase = createClient();
    const { data } = await supabase.from("room_participants").select("session_id, username").in("session_id", sessionIds);
    if (!data) return;
    const map: Record<string, string[]> = {};
    data.forEach((p) => { if (!map[p.session_id]) map[p.session_id] = []; map[p.session_id].push(p.username); });
    setRoomParticipants(map);
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem("homeroom-scheduled");
      if (raw) setScheduled(JSON.parse(raw));
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem("homeroom-tasks");
      if (raw) setAllListTasks(JSON.parse(raw));
    } catch { /* ignore */ }
    const a = localStorage.getItem("homeroom-avatar");
    if (a) setAvatar(a);
    try {
      const sessionRaw = localStorage.getItem("homeroom-session");
      if (sessionRaw) {
        const s = JSON.parse(sessionRaw);
        if (s.sessionStartTime && s.duration > 0) {
          const elapsed = Math.floor((Date.now() - s.sessionStartTime) / 1000);
          if (elapsed < s.duration * 60) {
            setActiveSession({ title: s.title, duration: s.duration, sessionStartTime: s.sessionStartTime, sessionId: s.sessionId, isPublic: s.isPublic });
          }
        } else if (s.sessionStartTime) {
          setActiveSession({ title: s.title, duration: s.duration, sessionStartTime: s.sessionStartTime, sessionId: s.sessionId, isPublic: s.isPublic });
        }
      }
    } catch { /* ignore */ }

    // Load active public rooms for everyone — no username required
    {
      const supabase = createClient();
      supabase.from("active_sessions").select("*").then(({ data }) => {
        if (data) {
          setPublicRooms(data as PublicActiveRoom[]);
          loadRoomParticipants(data.map(r => r.session_id));
        }
      });
    }

    const currentUsername = localStorage.getItem("homeroom-username");
    if (currentUsername) {
      const supabase = createClient();
      supabase
        .from("friend_requests")
        .select("*")
        .eq("status", "accepted")
        .or(`from_username.eq.${currentUsername},to_username.eq.${currentUsername}`)
        .then(({ data }) => {
          if (data) {
            setFriends(data.map((r) => {
              const uname = r.from_username === currentUsername ? r.to_username : r.from_username;
              return { id: uname.toLowerCase(), name: uname, initials: uname.slice(0, 2).toUpperCase(), color: colorFromUsername(uname) };
            }));
          }
        });
      supabase
        .from("room_invites")
        .select("*")
        .eq("to_username", currentUsername)
        .then(({ data }) => {
          if (data) {
            setInvites(data.map((row) => ({
              id: row.id,
              from: {
                id: row.from_username,
                name: row.from_username,
                initials: (row.from_username as string).slice(0, 2).toUpperCase(),
                color: colorFromUsername(row.from_username),
              },
              title: row.title,
              duration: row.duration,
              isLive: !row.scheduled_for,
              scheduledFor: row.scheduled_for,
              sessionId: row.session_id,
            })));
          }
        });

      // Load public scheduled sessions (future only)
      supabase.from("public_scheduled_sessions").select("*")
        .gt("scheduled_for", new Date().toISOString())
        .order("scheduled_for", { ascending: true })
        .then(({ data }) => {
          if (data) setPublicScheduled(data as PublicScheduledSession[]);
        });

      // Load user's squads for filtering
      supabase.from("squad_members")
        .select("squad_id, squads(id, name, emoji)")
        .eq("username", currentUsername)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(({ data }) => {
          if (data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setUserSquads((data as any[]).flatMap((row) => {
              const s = Array.isArray(row.squads) ? row.squads[0] : row.squads;
              return s ? [{ id: s.id, name: s.name, emoji: s.emoji }] : [];
            }));
          }
        });
    }
  }, []);

  // Realtime: update active public rooms and participants as they change
  useEffect(() => {
    const supabase = createClient();
    async function refreshRooms() {
      const { data } = await supabase.from("active_sessions").select("*");
      if (data) {
        setPublicRooms(data as PublicActiveRoom[]);
        loadRoomParticipants(data.map(r => r.session_id));
      }
    }
    async function refreshParticipants() {
      const { data: rooms } = await supabase.from("active_sessions").select("session_id");
      if (rooms) loadRoomParticipants(rooms.map(r => r.session_id));
    }
    const activeCh = supabase
      .channel("active_sessions_ch")
      .on("postgres_changes", { event: "*", schema: "public", table: "active_sessions" }, refreshRooms)
      .subscribe();
    const participantsCh = supabase
      .channel("room_participants_ch")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_participants" }, refreshParticipants)
      .subscribe();
    return () => {
      supabase.removeChannel(activeCh);
      supabase.removeChannel(participantsCh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick every 30s so Start/Join button enables at the right time
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Tick every second for the active session countdown and public room elapsed times
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  function savePublicScheduled(session: PublicScheduledSession) {
    if (savedSessionIds.has(session.session_id)) return;
    const newEntry: ScheduledSession = {
      id: crypto.randomUUID(),
      title: `${session.host_username}'s ${session.title}`,
      duration: session.duration,
      isPublic: true,
      scheduledFor: session.scheduled_for,
      invitedFriends: [],
      tasks: [],
      ownedByMe: false,
    };
    const updated = [...scheduled, newEntry];
    setScheduled(updated);
    localStorage.setItem("homeroom-scheduled", JSON.stringify(updated));
    setSavedSessionIds((prev) => new Set([...prev, session.session_id]));
    showToast("Added to your scheduled homerooms");
  }

  function joinPublicRoom(room: PublicActiveRoom) {
    localStorage.setItem("homeroom-session", JSON.stringify({
      sessionId: room.session_id,
      title: room.title,
      duration: room.duration,
      isPublic: true,
      tasks: [],
      invitedFriends: [],
      scheduledFor: null,
    }));
    router.push("/room");
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function acceptInvite(invite: Invite) {
    const supabase = createClient();
    const { error } = await supabase.from("room_invites").delete().eq("id", invite.id);
    if (error) console.error("acceptInvite delete failed:", error.message);
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));

    if (!invite.isLive && invite.scheduledFor) {
      const newSession: ScheduledSession = {
        id: crypto.randomUUID(),
        title: `${invite.from.name}'s ${invite.title}`,
        duration: invite.duration,
        isPublic: false,
        scheduledFor: invite.scheduledFor,
        invitedFriends: [invite.from],
        tasks: [],
        ownedByMe: false,
      };
      const updated = [...scheduled, newSession];
      setScheduled(updated);
      localStorage.setItem("homeroom-scheduled", JSON.stringify(updated));
      showToast("Added to your scheduled homerooms");
      return;
    }
    localStorage.setItem("homeroom-session", JSON.stringify({
      sessionId: invite.sessionId,
      title: `${invite.from.name} is ${invite.title}`,
      duration: invite.duration,
      isPublic: false,
      tasks: [],
      invitedFriends: [invite.from],
      scheduledFor: null,
    }));
    router.push("/room");
  }

  async function declineInvite(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("room_invites").delete().eq("id", id);
    if (error) console.error("declineInvite delete failed:", error.message);
    setInvites((prev) => prev.filter((i) => i.id !== id));
    setDeclinedInvites((prev) => new Set([...prev, id]));
  }

  function launchScheduled(session: ScheduledSession) {
    const liveSessionId = session.id ?? crypto.randomUUID();
    localStorage.setItem("homeroom-session", JSON.stringify({
      sessionId: liveSessionId,
      title: session.title,
      duration: session.duration,
      isPublic: session.isPublic,
      tasks: session.tasks,
      invitedFriends: session.invitedFriends,
      scheduledFor: null,
    }));
    const updated = scheduled.filter((s) => s.id !== session.id);
    setScheduled(updated);
    localStorage.setItem("homeroom-scheduled", JSON.stringify(updated));
    router.push("/room");
  }

  function removeScheduled(id: string) {
    const updated = scheduled.filter((s) => s.id !== id);
    setScheduled(updated);
    localStorage.setItem("homeroom-scheduled", JSON.stringify(updated));
    try {
      const raw = localStorage.getItem("homeroom-tasks");
      if (raw) {
        const tasks = JSON.parse(raw);
        localStorage.setItem("homeroom-tasks", JSON.stringify(
          tasks.map((t: ListTask & { scheduledForSessionId?: string; scheduledForDate?: string; scheduledForTitle?: string }) => {
            if (t.scheduledForSessionId === id) {
              const { scheduledForSessionId, scheduledForDate, scheduledForTitle, ...rest } = t;
              return rest;
            }
            return t;
          })
        ));
      }
    } catch { /* ignore */ }
  }

  function openEdit(session: ScheduledSession) {
    setEditDate(isoToDateInput(session.scheduledFor));
    setEditTime(isoToTimeInput(session.scheduledFor));
    setEditInvitedIds(new Set(session.invitedFriends.map((f) => f.id)));
    setEditingSession(session);
  }

  async function saveEdit() {
    if (!editingSession || !editDate || !editTime) return;
    const newIso = new Date(`${editDate}T${editTime}`).toISOString();
    const newInvited = friends.filter((f) => editInvitedIds.has(f.id));
    const updated = scheduled.map((s) =>
      s.id === editingSession.id ? { ...s, scheduledFor: newIso, invitedFriends: newInvited } : s
    );
    setScheduled(updated);
    localStorage.setItem("homeroom-scheduled", JSON.stringify(updated));

    const myUsername = localStorage.getItem("homeroom-username") ?? "";
    if (myUsername && newInvited.length > 0) {
      const prevIds = new Set(editingSession.invitedFriends.map((f) => f.id));
      const newlyAdded = newInvited.filter((f) => !prevIds.has(f.id));
      if (newlyAdded.length > 0) {
        const supabase = createClient();
        await Promise.all(newlyAdded.map((f) =>
          supabase.from("room_invites").upsert({
            from_username: myUsername,
            to_username: f.name,
            session_id: editingSession.id,
            title: editingSession.title || "Homeroom",
            duration: editingSession.duration,
            is_public: editingSession.isPublic,
            scheduled_for: newIso,
          }, { onConflict: "session_id,to_username", ignoreDuplicates: true })
        ));
      }
    }

    if (newInvited.length > 0) {
      const names = newInvited.map((f) => f.name).join(", ");
      showToast(`Saved · notified ${names}`);
    } else {
      showToast("Time updated");
    }
    setEditingSession(null);
  }

  function acceptTimeChange(notif: TimeChangeNotif) {
    // Find existing session for this notif or create a new one
    const existingIdx = scheduled.findIndex(
      (s) => s.title === notif.sessionPayload.title && !s.ownedByMe
    );
    let updated: ScheduledSession[];
    if (existingIdx >= 0) {
      updated = scheduled.map((s, i) =>
        i === existingIdx ? { ...s, scheduledFor: notif.newTime } : s
      );
    } else {
      const newSession: ScheduledSession = {
        ...notif.sessionPayload,
        id: crypto.randomUUID(),
        scheduledFor: notif.newTime,
        ownedByMe: false,
      };
      updated = [...scheduled, newSession];
    }
    setScheduled(updated);
    localStorage.setItem("homeroom-scheduled", JSON.stringify(updated));
    setDeclinedTimeChanges((prev) => new Set([...prev, notif.id]));
    showToast("Time change accepted");
  }

  function declineTimeChange(id: string) {
    setDeclinedTimeChanges((prev) => new Set([...prev, id]));
  }

  function openPrepop(session: ScheduledSession) {
    // Always read fresh so tags from previous saves are visible
    try {
      const raw = localStorage.getItem("homeroom-tasks");
      if (raw) setAllListTasks(JSON.parse(raw));
    } catch { /* ignore */ }
    setPrepopSelected(new Set(session.tasks.map((t) => t.id)));
    setPrepopSearch("");
    setPrepopSession(session);
  }

  function savePrepop() {
    if (!prepopSession) return;
    const session = prepopSession;
    const selectedIds = [...prepopSelected];
    const activeTasks = allListTasks.filter((t) => !t.done);

    const newTasks = activeTasks
      .filter((t) => selectedIds.includes(t.id))
      .map((t) => ({ id: t.id, text: t.text }));
    const updatedSessions = scheduled.map((s) =>
      s.id === session.id ? { ...s, tasks: newTasks } : s
    );
    setScheduled(updatedSessions);
    localStorage.setItem("homeroom-scheduled", JSON.stringify(updatedSessions));

    const updatedListTasks = allListTasks.map((t) => {
      if (selectedIds.includes(t.id)) {
        return { ...t, scheduledForSessionId: session.id, scheduledForDate: session.scheduledFor, scheduledForTitle: session.title || "Homeroom" };
      }
      if (t.scheduledForSessionId === session.id) {
        const { scheduledForSessionId, scheduledForDate, scheduledForTitle, ...rest } = t;
        return rest;
      }
      return t;
    });
    setAllListTasks(updatedListTasks);
    try {
      localStorage.setItem("homeroom-tasks", JSON.stringify(updatedListTasks));
    } catch { /* ignore */ }

    setPrepopSession(null);
  }

  const activePrepopTasks = allListTasks.filter((t) => !t.done);
  const visibleInvites = invites.filter((i) => !declinedInvites.has(i.id));
  const visibleTimeChanges = timeChanges.filter((tc) => !declinedTimeChanges.has(tc.id));
  const filteredPrepopTasks = prepopSearch
    ? activePrepopTasks.filter((t) => t.text.toLowerCase().includes(prepopSearch.toLowerCase()))
    : activePrepopTasks;

  return (
    <div className="max-w-2xl mx-auto px-4 pb-24">
      {/* Header */}
      <div className="pt-8 pb-6">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
          <Link href="/profile" className="w-8 h-8 rounded-full flex items-center justify-center text-lg overflow-hidden" style={{ background: avatar ? "#F3F4F6" : "#7C9E87" }}>
            {avatar ?? <span className="text-white text-xs font-semibold">?</span>}
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-charcoal leading-snug">Find your Homeroom.</h1>
        <p className="text-sm text-warm-gray mt-1">Adulting is hard. Don&apos;t do it alone.</p>
        <div className="flex gap-2 mt-4">
          <a href="#active-rooms" className="flex-1 bg-charcoal text-white font-semibold text-sm py-2.5 rounded-xl flex items-center justify-center hover:bg-black transition-colors">
            Join a Homeroom
          </a>
          <Link href="/start" className="flex-1 bg-charcoal text-white font-semibold text-sm py-2.5 rounded-xl flex items-center justify-center hover:bg-black transition-colors">
            Start a Homeroom
          </Link>
        </div>
      </div>

      {/* Invites */}
      {visibleInvites.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-charcoal mb-3">
            Invites
            <span className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-xs font-bold" style={{ background: "#7C3AED", fontSize: "10px" }}>
              {visibleInvites.length}
            </span>
          </h2>
          <div className="space-y-2">
            {visibleInvites.map((invite) => (
              <div key={invite.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold"
                  style={{ background: invite.from.color }}
                >
                  {invite.from.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-charcoal leading-snug">
                    <span className="font-semibold">{invite.from.name}</span>
                    {" "}is{" "}
                    <span className="italic">{invite.title}</span>
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {invite.isLive ? (
                      <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#DC2626" }}>
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        Live now
                      </span>
                    ) : (
                      <span className="text-xs text-warm-gray">{formatScheduledFor(invite.scheduledFor!)}</span>
                    )}
                    {invite.duration > 0 && (
                      <span className="text-xs text-warm-gray">· {formatDuration(invite.duration)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => acceptInvite(invite)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80"
                    style={{ background: "#7C3AED" }}
                  >
                    {invite.isLive ? "Join" : "Accept"}
                  </button>
                  <button
                    onClick={() => declineInvite(invite.id)}
                    className="text-xs text-warm-gray hover:text-charcoal transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time change notifications */}
      {visibleTimeChanges.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-charcoal mb-3">
            Time changes
            <span className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-xs font-bold" style={{ background: "#D97706", fontSize: "10px" }}>
              {visibleTimeChanges.length}
            </span>
          </h2>
          <div className="space-y-2">
            {visibleTimeChanges.map((tc) => (
              <div key={tc.id} className="bg-white rounded-2xl border border-amber-100 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold mt-0.5"
                    style={{ background: tc.from.color }}
                  >
                    {tc.from.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-charcoal leading-snug">
                      <span className="font-semibold">{tc.from.name}</span>
                      {" "}changed the time for{" "}
                      <span className="italic">{tc.sessionTitle}</span>
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className="text-xs text-warm-gray line-through">{formatFullDateTime(tc.originalTime)}</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                      <span className="text-xs font-semibold text-charcoal">{formatFullDateTime(tc.newTime)}</span>
                    </div>
                    {tc.duration > 0 && (
                      <p className="text-xs text-warm-gray mt-0.5">{formatDuration(tc.duration)}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 pl-12">
                  <button
                    onClick={() => acceptTimeChange(tc)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80"
                    style={{ background: "#7C3AED" }}
                  >
                    Accept time change
                  </button>
                  <button
                    onClick={() => declineTimeChange(tc.id)}
                    className="text-xs text-warm-gray hover:text-charcoal transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active session */}
      {activeSession && (() => {
        const myUsername = localStorage.getItem("homeroom-username") ?? "";
        const displayTitle = cleanTitle(activeSession.title || "Homeroom", myUsername);
        const elapsedSec = Math.floor((Date.now() - activeSession.sessionStartTime) / 1000);
        const remainingSec = activeSession.duration > 0 ? Math.max(0, activeSession.duration * 60 - elapsedSec) : null;
        const remMin = remainingSec !== null ? Math.floor(remainingSec / 60) : null;
        const remSec = remainingSec !== null ? remainingSec % 60 : null;
        const progressPct = activeSession.duration > 0 ? Math.min(100, (elapsedSec / (activeSession.duration * 60)) * 100) : 0;
        return (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-charcoal mb-3">Active session</h2>
            <div className="bg-white rounded-2xl border border-purple-100 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-charcoal">{displayTitle}</p>
                  {remainingSec !== null && remainingSec > 0 ? (
                    <p className="text-xs text-warm-gray mt-0.5">{remMin}:{String(remSec).padStart(2, "0")} remaining</p>
                  ) : remainingSec === 0 ? (
                    <p className="text-xs font-semibold mt-0.5" style={{ color: "#DC2626" }}>Time&apos;s up</p>
                  ) : (
                    <p className="text-xs text-warm-gray mt-0.5">No time limit</p>
                  )}
                </div>
                <Link href="/room" className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80" style={{ background: "#7C3AED" }}>
                  Rejoin
                </Link>
              </div>
              {activeSession.duration > 0 && (
                <div className="bg-gray-100 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-sage transition-all duration-1000" style={{ width: `${progressPct}%` }} />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Scheduled homerooms */}
      {scheduled.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-charcoal">
              Scheduled
              <span className="ml-1.5 text-warm-gray font-normal">· {scheduled.length}</span>
            </h2>
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setSchedView("list")}
                className="px-2.5 py-1 rounded-md transition-colors"
                style={schedView === "list" ? { background: "white", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" } : {}}
                title="List view"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={schedView === "list" ? "#1C1917" : "#78716C"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              </button>
              <button
                onClick={() => setSchedView("calendar")}
                className="px-2.5 py-1 rounded-md transition-colors"
                style={schedView === "calendar" ? { background: "white", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" } : {}}
                title="Calendar view"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={schedView === "calendar" ? "#1C1917" : "#78716C"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </button>
            </div>
          </div>

          {schedView === "list" ? (
            <div className="space-y-2">
              {scheduled
                .slice()
                .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
                .map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    now={now}
                    onLaunch={launchScheduled}
                    onRemove={removeScheduled}
                    onPrepop={openPrepop}
                    onEdit={openEdit}
                  />
                ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 px-4 py-4">
              <CalendarView
                scheduled={scheduled}
                now={now}
                onLaunch={launchScheduled}
                onRemove={removeScheduled}
                onPrepop={openPrepop}
                onEdit={openEdit}
              />
            </div>
          )}
        </div>
      )}

      {/* Squad filter chips */}
      {userSquads.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setSquadFilter(null)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
            style={squadFilter === null ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" } : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}
          >
            All
          </button>
          {userSquads.map((sq) => (
            <button
              key={sq.id}
              onClick={() => setSquadFilter(squadFilter === sq.id ? null : sq.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
              style={squadFilter === sq.id ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" } : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}
            >
              <span>{sq.emoji}</span>
              <span>{sq.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Active public rooms */}
      <div className="mb-6" id="active-rooms">
        <h2 className="text-sm font-semibold text-charcoal mb-3">
          Active rooms
          {(publicRooms.length > 0 || activeSession?.isPublic) && (() => {
            const ownSessionId = activeSession?.isPublic ? activeSession.sessionId : undefined;
            const othersCount = publicRooms.filter(r => r.session_id !== ownSessionId && (!squadFilter || r.squad_tags.includes(squadFilter))).length;
            const total = othersCount + (activeSession?.isPublic ? 1 : 0);
            return <span className="ml-1.5 text-warm-gray font-normal">· {total}</span>;
          })()}
        </h2>
        <div className="space-y-3">
          {/* Own active session card */}
          {activeSession?.isPublic && (() => {
            const myUsername = localStorage.getItem("homeroom-username") ?? "You";
            const ownDisplayTitle = cleanTitle(activeSession.title || "Homeroom", myUsername);
            const elapsedSec = Math.floor((Date.now() - activeSession.sessionStartTime) / 1000);
            const remainingSec = activeSession.duration > 0 ? Math.max(0, activeSession.duration * 60 - elapsedSec) : null;
            const remMin = remainingSec !== null ? Math.floor(remainingSec / 60) : null;
            const remSec = remainingSec !== null ? remainingSec % 60 : null;
            const progressPct = activeSession.duration > 0 ? Math.min(100, (elapsedSec / (activeSession.duration * 60)) * 100) : 0;
            const ownSessionId = activeSession.sessionId ?? "";
            const participants = roomParticipants[ownSessionId] ?? [];
            const friendSet = new Set(friends.map(f => f.name));
            const friendsInRoom = participants.filter(u => friendSet.has(u) && u !== myUsername);
            const expanded = expandedRooms.has(ownSessionId);
            return (
              <div className="bg-white rounded-2xl border border-purple-100 overflow-hidden">
                <div
                  className="px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedRooms(prev => { const n = new Set(prev); n.has(ownSessionId) ? n.delete(ownSessionId) : n.add(ownSessionId); return n; })}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                        <p className="text-sm font-semibold text-charcoal truncate">{ownDisplayTitle}</p>
                      </div>
                      <p className="text-xs text-warm-gray mt-0.5">@{myUsername} · your room</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {remainingSec !== null && remainingSec > 0
                          ? <span className="text-xs text-warm-gray">{remMin}:{String(remSec).padStart(2,"0")} left</span>
                          : activeSession.duration > 0 ? <span className="text-xs font-semibold text-red-500">Time&apos;s up</span>
                          : <span className="text-xs text-warm-gray">No time limit</span>}
                        {participants.length > 0 && (
                          <span className="text-xs text-warm-gray">{participants.length} in room</span>
                        )}
                        {friendsInRoom.length > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#EDE9FE", color: "#7C3AED" }}>
                            {friendsInRoom.length} friend{friendsInRoom.length !== 1 ? "s" : ""}
                          </span>
                        )}

                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                      <Link
                        href="/room"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80"
                        style={{ background: "#7C3AED" }}
                      >
                        Rejoin
                      </Link>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                  {activeSession.duration > 0 && (
                    <div className="bg-gray-100 rounded-full h-1 mt-2.5">
                      <div className="h-1 rounded-full bg-sage transition-all duration-1000" style={{ width: `${progressPct}%` }} />
                    </div>
                  )}
                </div>
                {expanded && (
                  <div className="border-t border-gray-50 px-4 py-3">
                    {participants.length === 0 ? (
                      <p className="text-xs text-warm-gray italic">No other participants yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {participants.map(uname => (
                          <div key={uname} className="flex items-center gap-1.5">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white flex-shrink-0"
                              style={{ background: colorFromUsername(uname), fontSize: "10px", fontWeight: 600 }}
                            >
                              {uname.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="text-xs text-charcoal font-medium">{uname}</span>
                            {friendSet.has(uname) && uname !== myUsername && (
                              <span className="text-xs text-sage font-semibold">friend</span>
                            )}
                            {uname === myUsername && (
                              <span className="text-xs text-warm-gray">you</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {(() => {
            const ownSessionId = activeSession?.isPublic ? activeSession.sessionId : undefined;
            const filtered = publicRooms.filter(r =>
              r.session_id !== ownSessionId &&
              (!squadFilter || r.squad_tags.includes(squadFilter))
            );
            if (filtered.length === 0 && !activeSession?.isPublic) return (
              <div className="text-center py-10 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">
                No active rooms right now.
              </div>
            );
            if (filtered.length === 0) return null;
            return filtered.map((room) => {
              const elapsedSec = Math.floor((Date.now() - new Date(room.started_at).getTime()) / 1000);
              const remainingSec = room.duration > 0 ? Math.max(0, room.duration * 60 - elapsedSec) : null;
              const remMin = remainingSec !== null ? Math.floor(remainingSec / 60) : null;
              const remSec = remainingSec !== null ? remainingSec % 60 : null;
              const progressPct = room.duration > 0 ? Math.min(100, (elapsedSec / (room.duration * 60)) * 100) : 0;
              const participants = roomParticipants[room.session_id] ?? [];
              const friendSet = new Set(friends.map(f => f.name));
              const friendsInRoom = participants.filter(u => friendSet.has(u));
              const expanded = expandedRooms.has(room.session_id);
              return (
                <div key={room.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div
                    className="px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedRooms(prev => { const n = new Set(prev); n.has(room.session_id) ? n.delete(room.session_id) : n.add(room.session_id); return n; })}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                          <p className="text-sm font-semibold text-charcoal truncate">{room.title || "Homeroom"}</p>
                        </div>
                        <p className="text-xs text-warm-gray mt-0.5">@{room.host_username}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {remainingSec !== null && remainingSec > 0
                            ? <span className="text-xs text-warm-gray">{remMin}:{String(remSec).padStart(2,"0")} left</span>
                            : room.duration > 0 ? <span className="text-xs font-semibold text-red-500">Time&apos;s up</span>
                            : <span className="text-xs text-warm-gray">No time limit</span>}
                          {participants.length > 0 && (
                            <span className="text-xs text-warm-gray">{participants.length} in room</span>
                          )}
                          {friendsInRoom.length > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#EDE9FE", color: "#7C3AED" }}>
                              {friendsInRoom.length} friend{friendsInRoom.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {room.squad_tags.length > 0 && userSquads.filter(s => room.squad_tags.includes(s.id)).map(s => (
                            <span key={s.id} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#EDE9FE", color: "#7C3AED" }}>{s.emoji} {s.name}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); joinPublicRoom(room); }}
                          className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80"
                          style={{ background: "#7C3AED" }}
                        >
                          Join
                        </button>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </div>
                    </div>
                    {room.duration > 0 && (
                      <div className="bg-gray-100 rounded-full h-1 mt-2.5">
                        <div className="h-1 rounded-full bg-sage transition-all duration-1000" style={{ width: `${progressPct}%` }} />
                      </div>
                    )}
                  </div>
                  {expanded && (
                    <div className="border-t border-gray-50 px-4 py-3">
                      {participants.length === 0 ? (
                        <p className="text-xs text-warm-gray italic">No participants yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {participants.map(uname => (
                            <div key={uname} className="flex items-center gap-1.5">
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center text-white flex-shrink-0"
                                style={{ background: colorFromUsername(uname), fontSize: "10px", fontWeight: 600 }}
                              >
                                {uname.slice(0, 2).toUpperCase()}
                              </div>
                              <span className="text-xs text-charcoal font-medium">{uname}</span>
                              {friendSet.has(uname) && <span className="text-xs text-sage font-semibold">friend</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Public scheduled sessions */}
      {(() => {
        const filtered = publicScheduled.filter(s => !squadFilter || s.squad_tags.includes(squadFilter));
        const dateFiltered = pubSchedDateFilter
          ? filtered.filter(s => s.scheduled_for.startsWith(pubSchedDateFilter))
          : filtered;
        if (filtered.length === 0) return null;
        return (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-charcoal">
                Scheduled sessions
                <span className="ml-1.5 text-warm-gray font-normal">· {filtered.length}</span>
              </h2>
              <input
                type="date"
                value={pubSchedDateFilter ?? ""}
                onChange={(e) => setPubSchedDateFilter(e.target.value || null)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-charcoal focus:outline-none focus:border-sage bg-white"
              />
            </div>
            <div className="space-y-2">
              {dateFiltered.map((session) => {
                const saved = savedSessionIds.has(session.session_id);
                return (
                  <div key={session.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">{session.host_username} is {session.title || "hosting a homeroom"}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs font-medium" style={{ color: "#7C3AED" }}>{formatScheduledFor(session.scheduled_for)}</span>
                        {session.duration > 0 && <span className="text-xs text-warm-gray">· {formatDuration(session.duration)}</span>}
                        {session.squad_tags.length > 0 && userSquads.filter(s => session.squad_tags.includes(s.id)).map(s => (
                          <span key={s.id} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#EDE9FE", color: "#7C3AED" }}>{s.emoji} {s.name}</span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => savePublicScheduled(session)}
                      disabled={saved}
                      className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors"
                      style={saved ? { borderColor: "#D1D5DB", color: "#78716C" } : { borderColor: "#7C3AED", color: "#7C3AED" }}
                    >
                      {saved ? "Saved" : "Save"}
                    </button>
                  </div>
                );
              })}
              {dateFiltered.length === 0 && (
                <p className="text-sm text-warm-gray text-center py-4">No sessions on that date.</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Edit session modal */}
      {editingSession && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditingSession(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-charcoal">Edit time</h2>
                <p className="text-xs text-warm-gray mt-0.5">{editingSession.title || "Homeroom"}</p>
              </div>
              <button onClick={() => setEditingSession(null)} className="text-warm-gray hover:text-charcoal p-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-warm-gray block mb-1">Date</label>
                <input
                  type="date"
                  value={editDate}
                  min={minDateInput()}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 text-charcoal focus:outline-none focus:border-sage bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-warm-gray block mb-1">Time</label>
                <input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 text-charcoal focus:outline-none focus:border-sage bg-white"
                />
              </div>
              {friends.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-warm-gray block mb-2">Invite friends</label>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {friends.map((f) => {
                      const invited = editInvitedIds.has(f.id);
                      return (
                        <button
                          key={f.id}
                          onClick={() => setEditInvitedIds((prev) => {
                            const next = new Set(prev);
                            invited ? next.delete(f.id) : next.add(f.id);
                            return next;
                          })}
                          className="w-full flex items-center gap-3 rounded-xl px-3 py-2 border transition-all text-left"
                          style={{ borderColor: invited ? "#7C3AED" : "#E5E7EB", background: invited ? "#F5F3FF" : "white" }}
                        >
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: f.color }}>
                            {f.initials}
                          </div>
                          <span className="text-sm text-charcoal flex-1">{f.name}</span>
                          {invited && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {editInvitedIds.size > 0 && (
                <p className="text-xs text-warm-gray bg-amber-50 rounded-xl px-3 py-2">
                  Saving will notify {friends.filter((f) => editInvitedIds.has(f.id)).map((f) => f.name).join(", ")} of the time.
                </p>
              )}
            </div>

            <button
              onClick={saveEdit}
              disabled={!editDate || !editTime}
              className="mt-4 w-full font-semibold text-sm py-3 rounded-xl text-white transition-opacity"
              style={{ background: "#7C3AED", opacity: editDate && editTime ? 1 : 0.4 }}
            >
              Save changes
            </button>
          </div>
        </div>
      )}

      {/* Pre-populate tasks modal */}
      {prepopSession && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPrepopSession(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div>
                <h2 className="font-semibold text-charcoal text-base">Pre-plan tasks</h2>
                <p className="text-xs text-warm-gray mt-0.5">
                  {prepopSession.title || "Homeroom"} · {shortDate(prepopSession.scheduledFor)}
                </p>
              </div>
              <button onClick={() => setPrepopSession(null)} className="text-warm-gray hover:text-charcoal p-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={prepopSearch}
                  onChange={(e) => setPrepopSearch(e.target.value)}
                  placeholder="Search tasks…"
                  className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-1">
              {filteredPrepopTasks.length === 0 ? (
                <p className="text-sm text-warm-gray text-center py-8">
                  {prepopSearch ? "No tasks match." : "Your list is empty."}
                </p>
              ) : filteredPrepopTasks.map((task: ListTask) => {
                const checked = prepopSelected.has(task.id);
                const otherSession = task.scheduledForSessionId && task.scheduledForSessionId !== prepopSession?.id;
                return (
                  <button
                    key={task.id}
                    onClick={() => setPrepopSelected((prev) => {
                      const next = new Set(prev);
                      checked ? next.delete(task.id) : next.add(task.id);
                      return next;
                    })}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors text-left"
                    style={{ background: checked ? "#F5F3FF" : "transparent" }}
                  >
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors"
                      style={checked ? { background: "#7C3AED", borderColor: "#7C3AED" } : { borderColor: "#D1D5DB" }}
                    >
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    <span className="text-sm text-charcoal flex-1">{task.text}</span>
                    {otherSession && (
                      <span className="text-xs flex-shrink-0 px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: "#FEF9C3", color: "#92400E" }}>
                        {task.scheduledForTitle} {new Date(task.scheduledForDate!).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="px-5 pb-5 pt-2 flex-shrink-0 border-t border-gray-100">
              <button
                onClick={savePrepop}
                className="w-full font-semibold text-sm py-3 rounded-xl text-white transition-opacity"
                style={{ background: "#7C3AED", opacity: prepopSelected.size > 0 ? 1 : 0.5 }}
              >
                {prepopSelected.size === 0
                  ? "Save (no tasks)"
                  : `Save ${prepopSelected.size} task${prepopSelected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-charcoal text-white text-xs font-medium px-4 py-2.5 rounded-full shadow-lg pointer-events-none z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
