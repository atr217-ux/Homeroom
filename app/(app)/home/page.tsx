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
  inviteId?: string;
};

type Invite = {
  id: string;
  homeroomId: string;
  from: Friend;
  title: string;
  duration: number;
  isLive: boolean;
  scheduledFor: string | null;
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
  homeroom_id?: string | null;
};

type ActiveSession = {
  id: string;
  title: string;
  duration: number;
  startedAt: string;
  isPublic: boolean;
};

type ActiveRoom = {
  id: string;
  title: string;
  duration: number;
  started_at: string;
  squad_tags: string[];
  // Supabase may return this as array or object depending on FK cardinality
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profiles?: any;
};

type PublicScheduledSession = {
  id: string;
  created_by: string;
  title: string;
  duration: number;
  scheduled_for: string;
  squad_tags: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profiles?: any;
};

function getProfileUsername(profiles: unknown): string {
  if (!profiles) return "Unknown";
  if (Array.isArray(profiles)) return profiles[0]?.username ?? "Unknown";
  return (profiles as { username: string }).username ?? "Unknown";
}

type UserSquad = { id: string; name: string; emoji: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Session card ──────────────────────────────────────────────────────────────

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
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-charcoal leading-snug">{session.title || "Homeroom"}</p>
        {active && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 flex-shrink-0">
            Ready
          </span>
        )}
      </div>

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

// ── Calendar view ─────────────────────────────────────────────────────────────

type CalendarViewProps = {
  scheduled: ScheduledSession[];
  now: number;
  onLaunch: (s: ScheduledSession) => void;
  onRemove: (id: string) => void;
  onPrepop: (s: ScheduledSession) => void;
  onEdit: (s: ScheduledSession) => void;
};

function CalendarView({ scheduled, now, onLaunch, onRemove, onPrepop, onEdit }: CalendarViewProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dateKey(today);

  // monthOffset: 0 = current month, 1 = next month, etc.
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const sessionsByDate: Record<string, ScheduledSession[]> = {};
  scheduled.forEach((s) => {
    const key = sessionDateKey(s.scheduledFor);
    if (!sessionsByDate[key]) sessionsByDate[key] = [];
    sessionsByDate[key].push(s);
  });

  // Build days for the displayed month
  const displayMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = displayMonth.getFullYear();
  const month = displayMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();

  const monthDays: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++) monthDays.push(new Date(year, month, d));

  const monthLabel = `${MONTH_NAMES[month]} ${year}`;

  function isDisabled(d: Date) { return d < today; }
  function isToday(d: Date) { return dateKey(d) === todayKey; }

  const upcomingSorted = scheduled
    .slice()
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
    .filter(s => sessionDateKey(s.scheduledFor) >= todayKey);

  const displaySessions = selectedKey
    ? (sessionsByDate[selectedKey] ?? []).slice().sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
    : upcomingSorted.slice(0, 5);

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => { setMonthOffset(o => o - 1); setSelectedKey(null); }}
          disabled={monthOffset === 0}
          className="p-1 rounded-lg transition-colors hover:bg-gray-100 disabled:opacity-20"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-charcoal">{monthLabel}</p>
        <button
          onClick={() => { setMonthOffset(o => o + 1); setSelectedKey(null); }}
          disabled={monthOffset >= 11}
          className="p-1 rounded-lg transition-colors hover:bg-gray-100 disabled:opacity-20"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((l) => (
          <div key={l} className="text-center text-xs text-warm-gray font-medium py-1">{l}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-1">
        {Array(firstDow).fill(null).map((_, i) => <div key={`pad-${i}`} />)}
        {monthDays.map((d) => {
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

      {/* Sessions list */}
      <div className="mt-4 space-y-2">
        {displaySessions.length === 0 ? (
          <p className="text-xs text-warm-gray text-center py-3">
            {selectedKey ? "No homerooms on this day." : "No upcoming homerooms."}
          </p>
        ) : (
          displaySessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              now={now}
              onLaunch={onLaunch}
              onRemove={onRemove}
              onPrepop={onPrepop}
              onEdit={onEdit}
              showTime={!!selectedKey}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledSession[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [declinedInvites, setDeclinedInvites] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [, setTick] = useState(0);
  const [publicRooms, setPublicRooms] = useState<ActiveRoom[]>([]);
  const [publicScheduled, setPublicScheduled] = useState<PublicScheduledSession[]>([]);
  const [userSquads, setUserSquads] = useState<UserSquad[]>([]);
  const [squadFilter, setSquadFilter] = useState<string | null>(null);
  const [friendsFilter, setFriendsFilter] = useState(false);
  const [pubSchedDateFilter, setPubSchedDateFilter] = useState<string | null>(null);
  const [savedSessionIds, setSavedSessionIds] = useState<Set<string>>(new Set());

  const [timeChanges] = useState<TimeChangeNotif[]>([]);
  const [declinedTimeChanges, setDeclinedTimeChanges] = useState<Set<string>>(new Set());
  const [pendingJoin, setPendingJoin] = useState<{ title: string; action: () => void } | null>(null);
  const [backgroundSessions, setBackgroundSessions] = useState<ActiveSession[]>([]);

  type BgSessionSummary = { session: ActiveSession; tasksDone: { id: string; text: string }[]; tasksRemaining: { id: string; text: string }[]; elapsedMin: number };
  const [endingBgSession, setEndingBgSession] = useState<BgSessionSummary | null>(null);

  const [allListTasks, setAllListTasks] = useState<ListTask[]>([]);
  const [prepopSession, setPrepopSession] = useState<ScheduledSession | null>(null);
  const [prepopSelected, setPrepopSelected] = useState<Set<string>>(new Set());
  const [prepopSearch, setPrepopSearch] = useState("");
  const [prepopNewTask, setPrepopNewTask] = useState("");

  const [friends, setFriends] = useState<Friend[]>([]);
  const [roomParticipants, setRoomParticipants] = useState<Record<string, string[]>>({});
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

  const [editingSession, setEditingSession] = useState<ScheduledSession | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editInvitedIds, setEditInvitedIds] = useState<Set<string>>(new Set());

  async function loadRoomParticipants(homeroomIds: string[]) {
    if (!homeroomIds.length) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("homeroom_participants")
      .select("homeroom_id, user_id")
      .in("homeroom_id", homeroomIds);
    if (!data || data.length === 0) return;
    const userIds = [...new Set(data.map(p => p.user_id as string))];
    const { data: profiles } = await supabase
      .from("profiles").select("id, username").in("id", userIds);
    const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]));
    const map: Record<string, string[]> = {};
    data.forEach(p => {
      const username = profileMap[p.user_id];
      if (!username) return;
      if (!map[p.homeroom_id]) map[p.homeroom_id] = [];
      map[p.homeroom_id].push(username);
    });
    setRoomParticipants(map);
  }

  useEffect(() => {
    const a = localStorage.getItem("homeroom-avatar");
    if (a) setAvatar(a);

    async function loadData() {
      const myUsername = localStorage.getItem("homeroom-username") ?? "";
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMyUserId(user.id);

      // Friends (still username-based)
      if (myUsername) {
        const { data: frData } = await supabase
          .from("friend_requests")
          .select("*")
          .eq("status", "accepted")
          .or(`from_username.eq.${myUsername},to_username.eq.${myUsername}`);
        if (frData) {
          setFriends(frData.map(r => {
            const uname = r.from_username === myUsername ? r.to_username : r.from_username;
            return { id: uname.toLowerCase(), name: uname, initials: uname.slice(0, 2).toUpperCase(), color: colorFromUsername(uname) };
          }));
        }

        const { data: sqData } = await supabase
          .from("squad_members")
          .select("squad_id, squads(id, name, emoji)")
          .eq("username", myUsername);
        if (sqData) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setUserSquads((sqData as any[]).flatMap(row => {
            const s = Array.isArray(row.squads) ? row.squads[0] : row.squads;
            return s ? [{ id: s.id, name: s.name, emoji: s.emoji }] : [];
          }));
        }
      }

      // Own scheduled homerooms
      const { data: ownSched } = await supabase
        .from("homerooms")
        .select("*")
        .eq("created_by", user.id)
        .eq("status", "scheduled")
        .order("scheduled_for", { ascending: true });

      // Pending invites with homeroom data
      const { data: pendingInvites } = await supabase
        .from("homeroom_invites")
        .select("*, homerooms(*)")
        .eq("to_user", user.id)
        .eq("status", "pending");

      // Accepted invites (scheduled sessions I've RSVP'd to)
      const { data: acceptedInvites } = await supabase
        .from("homeroom_invites")
        .select("*, homerooms(*)")
        .eq("to_user", user.id)
        .eq("status", "accepted");

      setSavedSessionIds(new Set(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (acceptedInvites ?? []).map((i: any) => i.homeroom_id as string)
      ));

      // Tasks linked to scheduled homerooms (for counts)
      const schedIds = [
        ...(ownSched?.map(h => h.id) ?? []),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((acceptedInvites ?? []) as any[]).filter(i => i.homerooms?.status === "scheduled").map((i: any) => i.homeroom_id as string),
      ];
      const tasksByHomeroom: Record<string, { id: string; text: string }[]> = {};
      if (schedIds.length > 0) {
        const { data: tasksData } = await supabase
          .from("tasks")
          .select("id, text, homeroom_id")
          .eq("user_id", user.id)
          .in("homeroom_id", schedIds)
          .eq("done", false);
        if (tasksData) {
          tasksData.forEach(t => {
            const hid = t.homeroom_id as string;
            if (!tasksByHomeroom[hid]) tasksByHomeroom[hid] = [];
            tasksByHomeroom[hid].push({ id: t.id, text: t.text });
          });
        }
      }

      // Invited friends for own scheduled sessions
      const ownSchedIds = ownSched?.map(h => h.id) ?? [];
      const invitesByHomeroom: Record<string, Friend[]> = {};
      if (ownSchedIds.length > 0) {
        const { data: sentInvites } = await supabase
          .from("homeroom_invites")
          .select("homeroom_id, to_user")
          .in("homeroom_id", ownSchedIds)
          .eq("from_user", user.id)
          .in("status", ["pending", "accepted"]);
        if (sentInvites && sentInvites.length > 0) {
          const toUserIds = [...new Set(sentInvites.map(i => i.to_user as string))];
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, username")
            .in("id", toUserIds);
          if (profiles) {
            sentInvites.forEach(inv => {
              const profile = profiles.find(p => p.id === inv.to_user);
              if (!profile) return;
              const uname = profile.username;
              if (!invitesByHomeroom[inv.homeroom_id]) invitesByHomeroom[inv.homeroom_id] = [];
              invitesByHomeroom[inv.homeroom_id].push({
                id: uname.toLowerCase(), name: uname,
                initials: uname.slice(0, 2).toUpperCase(),
                color: colorFromUsername(uname),
              });
            });
          }
        }
      }

      // Build scheduled sessions list
      const myScheduled: ScheduledSession[] = [
        ...(ownSched ?? []).map(h => ({
          id: h.id,
          title: h.title,
          duration: h.duration,
          isPublic: !h.is_private,
          scheduledFor: h.scheduled_for!,
          invitedFriends: invitesByHomeroom[h.id] ?? [],
          tasks: tasksByHomeroom[h.id] ?? [],
          ownedByMe: true,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((acceptedInvites ?? []) as any[]).filter(i => i.homerooms?.status === "scheduled").map((i: any) => ({
          id: i.homeroom_id,
          title: i.homerooms.title,
          duration: i.homerooms.duration,
          isPublic: !i.homerooms.is_private,
          scheduledFor: i.homerooms.scheduled_for!,
          invitedFriends: [],
          tasks: tasksByHomeroom[i.homeroom_id] ?? [],
          ownedByMe: false,
          inviteId: i.id,
        })),
      ];
      setScheduled(myScheduled);

      // Build pending invites — resolve from_user profiles
      if (pendingInvites && pendingInvites.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fromUserIds = [...new Set((pendingInvites as any[]).map((i: any) => i.from_user as string))];
        const { data: fromProfiles } = await supabase
          .from("profiles")
          .select("id, username, avatar")
          .in("id", fromUserIds);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inv: Invite[] = (pendingInvites as any[]).flatMap((row: any) => {
          const h = Array.isArray(row.homerooms) ? row.homerooms[0] : row.homerooms;
          const profile = fromProfiles?.find(p => p.id === row.from_user);
          if (!h || !profile || h.status === "completed") return [];
          const uname = profile.username;
          return [{
            id: row.id,
            homeroomId: row.homeroom_id,
            from: { id: uname.toLowerCase(), name: uname, initials: uname.slice(0, 2).toUpperCase(), color: colorFromUsername(uname) },
            title: h.title,
            duration: h.duration,
            isLive: h.status === "active",
            scheduledFor: h.scheduled_for,
          }];
        });
        setInvites(inv);
      }

      // Active public rooms
      const { data: activeRooms } = await supabase
        .from("homerooms")
        .select("id, created_by, title, duration, started_at, squad_tags")
        .eq("is_private", false)
        .eq("status", "active");
      if (activeRooms) {
        const creatorIds = [...new Set(activeRooms.map(r => r.created_by as string))];
        const { data: roomProfiles } = creatorIds.length
          ? await supabase.from("profiles").select("id, username, avatar").in("id", creatorIds)
          : { data: [] };
        const profileMap = Object.fromEntries((roomProfiles ?? []).map(p => [p.id, p]));
        const roomsWithProfiles = activeRooms.map(r => ({ ...r, profiles: profileMap[r.created_by] ?? null }));
        setPublicRooms(roomsWithProfiles as unknown as ActiveRoom[]);
        await loadRoomParticipants(activeRooms.map(r => r.id));
      }

      // Public scheduled sessions (exclude own)
      const { data: pubSched } = await supabase
        .from("homerooms")
        .select("id, created_by, title, duration, scheduled_for, squad_tags")
        .eq("is_private", false)
        .eq("status", "scheduled")
        .gt("scheduled_for", new Date().toISOString())
        .neq("created_by", user.id)
        .order("scheduled_for", { ascending: true });
      if (pubSched) {
        const schedCreatorIds = [...new Set(pubSched.map(r => r.created_by as string))];
        const { data: schedProfiles } = schedCreatorIds.length
          ? await supabase.from("profiles").select("id, username, avatar").in("id", schedCreatorIds)
          : { data: [] };
        const schedProfileMap = Object.fromEntries((schedProfiles ?? []).map(p => [p.id, p]));
        setPublicScheduled(pubSched.map(r => ({ ...r, profiles: schedProfileMap[r.created_by] ?? null })) as unknown as PublicScheduledSession[]);
      }

      // Own active session — check localStorage first, fall back to DB for cross-device support
      let activeId = localStorage.getItem("homeroom-active-id");
      if (activeId) {
        const { data: activeHomeroom } = await supabase
          .from("homerooms")
          .select("*")
          .eq("id", activeId)
          .eq("status", "active")
          .single();
        if (activeHomeroom) {
          setActiveSession({
            id: activeHomeroom.id,
            title: activeHomeroom.title,
            duration: activeHomeroom.duration,
            startedAt: activeHomeroom.started_at!,
            isPublic: !activeHomeroom.is_private,
          });
        } else {
          localStorage.removeItem("homeroom-active-id");
          activeId = null;
        }
      }
      if (!activeId) {
        // No localStorage entry — check DB for an active room this user is participating in
        const { data: participantRow } = await supabase
          .from("homeroom_participants")
          .select("homeroom_id, homerooms!inner(id, title, duration, started_at, is_private, status)")
          .eq("user_id", user.id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .eq("homerooms.status" as any, "active")
          .limit(1)
          .maybeSingle();
        if (participantRow) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const h = (participantRow as any).homerooms;
          if (h) {
            localStorage.setItem("homeroom-active-id", h.id);
            setActiveSession({ id: h.id, title: h.title, duration: h.duration, startedAt: h.started_at!, isPublic: !h.is_private });
          }
        }
      }

      // Background sessions (private rooms displaced when joining another)
      try {
        const bgIds: string[] = JSON.parse(localStorage.getItem("homeroom-bg-sessions") || "[]");
        const filteredBgIds = bgIds.filter(id => id !== activeId);
        if (filteredBgIds.length > 0) {
          const { data: bgRooms } = await supabase
            .from("homerooms")
            .select("id, title, duration, started_at, is_private, status")
            .in("id", filteredBgIds)
            .eq("status", "active");
          const stillActive = bgRooms ?? [];
          setBackgroundSessions(stillActive.map(r => ({
            id: r.id, title: r.title, duration: r.duration,
            startedAt: r.started_at!, isPublic: !r.is_private,
          })));
          const activeSet = new Set(stillActive.map(r => r.id));
          localStorage.setItem("homeroom-bg-sessions", JSON.stringify(filteredBgIds.filter(id => activeSet.has(id))));
        }
      } catch { /* ignore */ }
    }

    loadData();

    function onVisibility() {
      if (document.visibilityState === "visible") loadData();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: homerooms and participants
  useEffect(() => {
    const supabase = createClient();

    async function refreshActiveRooms() {
      const { data } = await supabase
        .from("homerooms")
        .select("id, created_by, title, duration, started_at, squad_tags")
        .eq("is_private", false)
        .eq("status", "active");
      if (data) {
        const creatorIds = [...new Set(data.map(r => r.created_by as string))];
        const { data: roomProfiles } = creatorIds.length
          ? await supabase.from("profiles").select("id, username, avatar").in("id", creatorIds)
          : { data: [] };
        const profileMap = Object.fromEntries((roomProfiles ?? []).map(p => [p.id, p]));
        setPublicRooms(data.map(r => ({ ...r, profiles: profileMap[r.created_by] ?? null })) as unknown as ActiveRoom[]);
        await loadRoomParticipants(data.map(r => r.id));
      }
    }

    async function refreshParticipants() {
      const { data: rooms } = await supabase
        .from("homerooms")
        .select("id")
        .eq("is_private", false)
        .eq("status", "active");
      if (rooms) await loadRoomParticipants(rooms.map(r => r.id));
    }

    const activeCh = supabase
      .channel("homerooms_active_ch")
      .on("postgres_changes", { event: "*", schema: "public", table: "homerooms" }, refreshActiveRooms)
      .subscribe();
    const participantsCh = supabase
      .channel("homeroom_participants_ch")
      .on("postgres_changes", { event: "*", schema: "public", table: "homeroom_participants" }, refreshParticipants)
      .subscribe();

    return () => {
      supabase.removeChannel(activeCh);
      supabase.removeChannel(participantsCh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function savePublicScheduled(session: PublicScheduledSession) {
    if (savedSessionIds.has(session.id) || !myUserId) return;
    const supabase = createClient();
    const { error } = await supabase.from("homeroom_invites").upsert({
      homeroom_id: session.id,
      from_user: session.created_by,
      to_user: myUserId,
      status: "accepted",
    }, { onConflict: "homeroom_id,to_user" });
    if (!error) {
      setSavedSessionIds(prev => new Set([...prev, session.id]));
      setScheduled(prev => [...prev, {
        id: session.id,
        title: session.title,
        duration: session.duration,
        isPublic: true,
        scheduledFor: session.scheduled_for,
        invitedFriends: [],
        tasks: [],
        ownedByMe: false,
      }]);
      showToast("Added to your scheduled homerooms");
    }
  }

  function saveSessionAsBackground(session: ActiveSession) {
    if (session.isPublic) return;
    try {
      const prev: string[] = JSON.parse(localStorage.getItem("homeroom-bg-sessions") || "[]");
      if (!prev.includes(session.id)) {
        localStorage.setItem("homeroom-bg-sessions", JSON.stringify([...prev, session.id]));
        setBackgroundSessions(p => [...p, session]);
      }
    } catch { /* ignore */ }
  }

  async function handleEndActiveSession() {
    if (!activeSession) return;
    const session = activeSession;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("homerooms").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", session.id);
    let tasksDone: { id: string; text: string }[] = [];
    let tasksRemaining: { id: string; text: string }[] = [];
    if (user) {
      const { data: tasks } = await supabase.from("tasks").select("id, text, done").eq("homeroom_id", session.id).eq("user_id", user.id);
      if (tasks) {
        tasksDone = tasks.filter(t => t.done).map(t => ({ id: t.id, text: t.text }));
        tasksRemaining = tasks.filter(t => !t.done).map(t => ({ id: t.id, text: t.text }));
        if (tasksRemaining.length > 0) {
          await supabase.from("tasks").update({ homeroom_id: null }).in("id", tasksRemaining.map(t => t.id));
        }
      }
    }
    localStorage.removeItem("homeroom-active-id");
    localStorage.removeItem(`homeroom-chat-${session.id}`);
    setActiveSession(null);
    const elapsedMin = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000);
    setEndingBgSession({ session, tasksDone, tasksRemaining, elapsedMin });
  }

  async function handleEndBgSession(session: ActiveSession) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("homerooms").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", session.id);
    let tasksDone: { id: string; text: string }[] = [];
    let tasksRemaining: { id: string; text: string }[] = [];
    if (user) {
      const { data: tasks } = await supabase.from("tasks").select("id, text, done").eq("homeroom_id", session.id).eq("user_id", user.id);
      if (tasks) {
        tasksDone = tasks.filter(t => t.done).map(t => ({ id: t.id, text: t.text }));
        tasksRemaining = tasks.filter(t => !t.done).map(t => ({ id: t.id, text: t.text }));
        if (tasksRemaining.length > 0) {
          await supabase.from("tasks").update({ homeroom_id: null }).in("id", tasksRemaining.map(t => t.id));
        }
      }
    }
    try {
      const prev: string[] = JSON.parse(localStorage.getItem("homeroom-bg-sessions") || "[]");
      localStorage.setItem("homeroom-bg-sessions", JSON.stringify(prev.filter(x => x !== session.id)));
    } catch { /* ignore */ }
    setBackgroundSessions(p => p.filter(s => s.id !== session.id));
    const elapsedMin = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000);
    setEndingBgSession({ session, tasksDone, tasksRemaining, elapsedMin });
  }

  function withJoinConfirm(action: () => void) {
    if (activeSession) {
      const captured = activeSession;
      setPendingJoin({
        title: captured.title,
        action: () => { saveSessionAsBackground(captured); action(); },
      });
    } else {
      action();
    }
  }

  function joinPublicRoom(room: ActiveRoom) {
    withJoinConfirm(() => {
      localStorage.setItem("homeroom-active-id", room.id);
      router.push(`/room?id=${room.id}`);
    });
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function acceptInvite(invite: Invite) {
    if (invite.isLive && activeSession) {
      const doAccept = async () => {
        const supabase = createClient();
        await supabase.from("homeroom_invites").update({ status: "accepted" }).eq("id", invite.id);
        setInvites(prev => prev.filter(i => i.id !== invite.id));
        localStorage.setItem("homeroom-active-id", invite.homeroomId);
        router.push(`/room?id=${invite.homeroomId}`);
      };
      withJoinConfirm(() => { doAccept(); });
      return;
    }

    const supabase = createClient();
    await supabase.from("homeroom_invites").update({ status: "accepted" }).eq("id", invite.id);
    setInvites(prev => prev.filter(i => i.id !== invite.id));

    if (invite.isLive) {
      localStorage.setItem("homeroom-active-id", invite.homeroomId);
      router.push(`/room?id=${invite.homeroomId}`);
      return;
    }

    setScheduled(prev => [...prev, {
      id: invite.homeroomId,
      title: invite.title,
      duration: invite.duration,
      isPublic: false,
      scheduledFor: invite.scheduledFor!,
      invitedFriends: [invite.from],
      tasks: [],
      ownedByMe: false,
      inviteId: invite.id,
    }]);
    showToast("Added to your scheduled homerooms");
  }

  async function declineInvite(id: string) {
    const supabase = createClient();
    await supabase.from("homeroom_invites").update({ status: "declined" }).eq("id", id);
    setInvites(prev => prev.filter(i => i.id !== id));
    setDeclinedInvites(prev => new Set([...prev, id]));
  }

  async function launchScheduled(session: ScheduledSession) {
    const doLaunch = async () => {
      const supabase = createClient();
      if (session.ownedByMe) {
        await supabase
          .from("homerooms")
          .update({ status: "active", started_at: new Date().toISOString() })
          .eq("id", session.id);
      }
      localStorage.setItem("homeroom-active-id", session.id);
      setScheduled(prev => prev.filter(s => s.id !== session.id));
      router.push(`/room?id=${session.id}`);
    };
    withJoinConfirm(() => { doLaunch(); });
  }

  async function removeScheduled(id: string) {
    const session = scheduled.find(s => s.id === id);
    if (!session) return;
    const supabase = createClient();
    if (session.ownedByMe) {
      await supabase.from("homerooms").delete().eq("id", id);
    } else if (session.inviteId) {
      await supabase.from("homeroom_invites").update({ status: "declined" }).eq("id", session.inviteId);
    }
    setScheduled(prev => prev.filter(s => s.id !== id));
  }

  function openEdit(session: ScheduledSession) {
    setEditTitle(session.title || "");
    setEditDate(isoToDateInput(session.scheduledFor));
    setEditTime(isoToTimeInput(session.scheduledFor));
    setEditInvitedIds(new Set(session.invitedFriends.map(f => f.id)));
    setEditingSession(session);
  }

  async function saveEdit() {
    if (!editingSession || !editDate || !editTime || !myUserId) return;
    const newIso = new Date(`${editDate}T${editTime}`).toISOString();
    const supabase = createClient();

    await supabase.from("homerooms").update({ scheduled_for: newIso, title: editTitle.trim() || editingSession.title }).eq("id", editingSession.id);

    const newInvited = friends.filter(f => editInvitedIds.has(f.id));
    const prevIds = new Set(editingSession.invitedFriends.map(f => f.id));
    const newlyAdded = newInvited.filter(f => !prevIds.has(f.id));

    const dateChanged = newIso !== editingSession.scheduledFor;

    // Re-notify existing invitees if the date changed
    if (dateChanged) {
      await supabase
        .from("homeroom_invites")
        .update({ status: "pending" })
        .eq("homeroom_id", editingSession.id)
        .neq("to_user", myUserId)
        .in("status", ["accepted", "declined"]);
    }

    // Send invites to newly added friends
    if (newlyAdded.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username")
        .in("username", newlyAdded.map(f => f.name));
      if (profiles) {
        await Promise.all(profiles.map(p =>
          supabase.from("homeroom_invites").upsert({
            homeroom_id: editingSession.id,
            from_user: myUserId,
            to_user: p.id,
            status: "pending",
          }, { onConflict: "homeroom_id,to_user", ignoreDuplicates: true })
        ));
      }
    }

    setScheduled(prev => prev.map(s =>
      s.id === editingSession.id ? { ...s, title: editTitle.trim() || s.title, scheduledFor: newIso, invitedFriends: newInvited } : s
    ));

    if (dateChanged) {
      showToast("Date updated · invitees re-notified");
    } else if (newInvited.length > 0) {
      showToast(`Saved · notified ${newInvited.map(f => f.name).join(", ")}`);
    } else {
      showToast("Saved");
    }
    setEditingSession(null);
  }

  function acceptTimeChange(notif: TimeChangeNotif) {
    const existingIdx = scheduled.findIndex(s => s.title === notif.sessionPayload.title && !s.ownedByMe);
    let updated: ScheduledSession[];
    if (existingIdx >= 0) {
      updated = scheduled.map((s, i) => i === existingIdx ? { ...s, scheduledFor: notif.newTime } : s);
    } else {
      updated = [...scheduled, { ...notif.sessionPayload, id: crypto.randomUUID(), scheduledFor: notif.newTime, ownedByMe: false }];
    }
    setScheduled(updated);
    setDeclinedTimeChanges(prev => new Set([...prev, notif.id]));
    showToast("Time change accepted");
  }

  function declineTimeChange(id: string) {
    setDeclinedTimeChanges(prev => new Set([...prev, id]));
  }

  async function openPrepop(session: ScheduledSession) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, text, homeroom_id")
      .eq("user_id", user.id)
      .eq("done", false)
      .order("sort_order", { ascending: true });
    if (tasks) {
      // Clear stale homeroom associations (completed or missing homerooms)
      const linkedIds = [...new Set(tasks.filter(t => t.homeroom_id).map(t => t.homeroom_id as string))];
      if (linkedIds.length > 0) {
        const { data: homerooms } = await supabase
          .from("homerooms").select("id, status").in("id", linkedIds);
        const validIds = new Set((homerooms ?? []).filter(h => h.status === "active" || h.status === "scheduled").map(h => h.id));
        const staleTaskIds = tasks.filter(t => t.homeroom_id && !validIds.has(t.homeroom_id)).map(t => t.id);
        if (staleTaskIds.length > 0) {
          await supabase.from("tasks").update({ homeroom_id: null }).in("id", staleTaskIds);
          staleTaskIds.forEach(id => {
            const t = tasks.find(x => x.id === id);
            if (t) t.homeroom_id = null;
          });
        }
      }
      setAllListTasks(tasks.map(t => ({ id: t.id, text: t.text, done: false, homeroom_id: t.homeroom_id })));
      setPrepopSelected(new Set(tasks.filter(t => t.homeroom_id === session.id).map(t => t.id)));
    }
    setPrepopSearch("");
    setPrepopSession(session);
  }

  async function savePrepop() {
    if (!prepopSession) return;
    const supabase = createClient();
    const selectedIds = [...prepopSelected];

    if (selectedIds.length > 0) {
      await supabase.from("tasks").update({ homeroom_id: prepopSession.id }).in("id", selectedIds);
    }

    const deselected = allListTasks
      .filter(t => !prepopSelected.has(t.id) && t.homeroom_id === prepopSession.id)
      .map(t => t.id);
    if (deselected.length > 0) {
      await supabase.from("tasks").update({ homeroom_id: null }).in("id", deselected);
    }

    setScheduled(prev => prev.map(s =>
      s.id === prepopSession.id
        ? { ...s, tasks: allListTasks.filter(t => selectedIds.includes(t.id)).map(t => ({ id: t.id, text: t.text })) }
        : s
    ));

    setPrepopSession(null);
  }

  async function addPrepopTask() {
    const text = prepopNewTask.trim();
    if (!text || !myUserId || !prepopSession) return;
    setPrepopNewTask("");
    const supabase = createClient();
    const { data } = await supabase.from("tasks").insert({
      user_id: myUserId,
      text,
      done: false,
      homeroom_id: prepopSession.id,
      sort_order: allListTasks.length,
    }).select("id").single();
    if (data) {
      const newTask: ListTask = { id: data.id, text, done: false, homeroom_id: prepopSession.id };
      setAllListTasks(prev => [...prev, newTask]);
      setPrepopSelected(prev => new Set([...prev, data.id]));
    }
  }

  const activePrepopTasks = allListTasks.filter(t => !t.done);
  const visibleInvites = invites.filter(i => !declinedInvites.has(i.id));
  const visibleTimeChanges = timeChanges.filter(tc => !declinedTimeChanges.has(tc.id));
  const filteredPrepopTasks = prepopSearch
    ? activePrepopTasks.filter(t => t.text.toLowerCase().includes(prepopSearch.toLowerCase()))
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
        <p className="text-sm text-warm-gray mt-1">Better focus. Better company.</p>
        <button
          onClick={() => withJoinConfirm(() => router.push("/start"))}
          className="mt-4 flex items-center gap-2 text-sm font-semibold transition-colors"
          style={{ color: "#7C3AED" }}
        >
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "#EDE9FE" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
          Start a Homeroom
        </button>
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
        const elapsedSec = Math.floor((Date.now() - new Date(activeSession.startedAt).getTime()) / 1000);
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
                {remainingSec === 0 ? (
                  <button onClick={handleEndActiveSession} className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80" style={{ background: "#DC2626" }}>
                    End Session
                  </button>
                ) : (
                  <Link href={`/room?id=${activeSession.id}`} className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80" style={{ background: "#7C3AED" }}>
                    Rejoin
                  </Link>
                )}
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

      {/* Background (displaced private) sessions */}
      {backgroundSessions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-charcoal mb-3">In progress</h2>
          <div className="space-y-2">
            {backgroundSessions.map((session) => {
              const elapsedSec = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
              const remainingSec = session.duration > 0 ? Math.max(0, session.duration * 60 - elapsedSec) : null;
              const remMin = remainingSec !== null ? Math.floor(remainingSec / 60) : null;
              const remSec = remainingSec !== null ? remainingSec % 60 : null;
              function dismissBg(id: string) {
                try {
                  const prev: string[] = JSON.parse(localStorage.getItem("homeroom-bg-sessions") || "[]");
                  localStorage.setItem("homeroom-bg-sessions", JSON.stringify(prev.filter(x => x !== id)));
                } catch { /* ignore */ }
                setBackgroundSessions(p => p.filter(s => s.id !== id));
              }
              return (
                <div key={session.id} className="bg-white rounded-2xl border border-amber-100 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-charcoal">{session.title || "Homeroom"}</p>
                      <p className="text-xs text-warm-gray mt-0.5">
                        {remainingSec !== null && remainingSec > 0
                          ? `${remMin}:${String(remSec).padStart(2, "0")} remaining`
                          : remainingSec === 0 ? "Time's up"
                          : "No time limit"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {remainingSec === 0 ? (
                        <button
                          onClick={() => handleEndBgSession(session)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80"
                          style={{ background: "#DC2626" }}
                        >
                          End Session
                        </button>
                      ) : (
                        <button
                          onClick={() => withJoinConfirm(() => {
                            localStorage.setItem("homeroom-active-id", session.id);
                            dismissBg(session.id);
                            router.push(`/room?id=${session.id}`);
                          })}
                          className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-opacity hover:opacity-80"
                          style={{ background: "#D97706" }}
                        >
                          Rejoin
                        </button>
                      )}
                      <button onClick={() => dismissBg(session.id)} className="text-warm-gray hover:text-charcoal p-1 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter chips */}
      {(userSquads.length > 0 || friends.length > 0) && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => { setSquadFilter(null); setFriendsFilter(false); }}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
            style={squadFilter === null && !friendsFilter ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" } : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}
          >
            All
          </button>
          {friends.length > 0 && (
            <button
              onClick={() => setFriendsFilter(f => !f)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
              style={friendsFilter ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" } : { background: "white", color: "#78716C", borderColor: "#E5E2DC" }}
            >
              <span>👥</span>
              <span>Friends</span>
            </button>
          )}
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
            const ownRoomId = activeSession?.isPublic ? activeSession.id : undefined;
            const othersCount = publicRooms.filter(r => {
              if (r.id === ownRoomId) return false;
              if (squadFilter && !r.squad_tags.includes(squadFilter)) return false;
              if (r.duration > 0 && (Date.now() - new Date(r.started_at).getTime()) / 1000 >= r.duration * 60) return false;
              return true;
            }).length;
            const total = othersCount + (activeSession?.isPublic ? 1 : 0);
            return <span className="ml-1.5 text-warm-gray font-normal">· {total}</span>;
          })()}
        </h2>
        <div className="space-y-3">
          {/* Own active session card */}
          {activeSession?.isPublic && (() => {
            const myUsername = localStorage.getItem("homeroom-username") ?? "You";
            const ownDisplayTitle = cleanTitle(activeSession.title || "Homeroom", myUsername);
            const elapsedSec = Math.floor((Date.now() - new Date(activeSession.startedAt).getTime()) / 1000);
            const remainingSec = activeSession.duration > 0 ? Math.max(0, activeSession.duration * 60 - elapsedSec) : null;
            const remMin = remainingSec !== null ? Math.floor(remainingSec / 60) : null;
            const remSec = remainingSec !== null ? remainingSec % 60 : null;
            const progressPct = activeSession.duration > 0 ? Math.min(100, (elapsedSec / (activeSession.duration * 60)) * 100) : 0;
            const ownRoomId = activeSession.id;
            const participants = roomParticipants[ownRoomId] ?? [];
            const friendSet = new Set(friends.map(f => f.name));
            const friendsInRoom = participants.filter(u => friendSet.has(u) && u !== myUsername);
            const expanded = expandedRooms.has(ownRoomId);
            return (
              <div className="bg-white rounded-2xl border border-purple-100 overflow-hidden">
                <div
                  className="px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedRooms(prev => { const n = new Set(prev); n.has(ownRoomId) ? n.delete(ownRoomId) : n.add(ownRoomId); return n; })}
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
                        href={`/room?id=${activeSession.id}`}
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

          {/* Other active rooms */}
          {(() => {
            const ownRoomId = activeSession?.isPublic ? activeSession.id : undefined;
            const friendUsernames = new Set(friends.map(f => f.name));
            const filtered = publicRooms.filter(r => {
              if (r.id === ownRoomId) return false;
              if (squadFilter && !r.squad_tags.includes(squadFilter)) return false;
              if (friendsFilter) {
                const participants = roomParticipants[r.id] ?? [];
                if (!participants.some(u => friendUsernames.has(u))) return false;
              }
              // Hide rooms whose timer has expired — mark them completed in the background
              if (r.duration > 0) {
                const elapsed = (Date.now() - new Date(r.started_at).getTime()) / 1000;
                if (elapsed >= r.duration * 60) {
                  const supabase = createClient();
                  supabase.from("homerooms").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", r.id).then(() => {});
                  return false;
                }
              }
              return true;
            });
            if (filtered.length === 0 && !activeSession?.isPublic) return (
              <div className="text-center py-10 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">
                No active rooms right now.
              </div>
            );
            if (filtered.length === 0) return null;
            return filtered.map((room) => {
              const hostUsername = getProfileUsername(room.profiles);
              const elapsedSec = Math.floor((Date.now() - new Date(room.started_at).getTime()) / 1000);
              const remainingSec = room.duration > 0 ? Math.max(0, room.duration * 60 - elapsedSec) : null;
              const remMin = remainingSec !== null ? Math.floor(remainingSec / 60) : null;
              const remSec = remainingSec !== null ? remainingSec % 60 : null;
              const progressPct = room.duration > 0 ? Math.min(100, (elapsedSec / (room.duration * 60)) * 100) : 0;
              const participants = roomParticipants[room.id] ?? [];
              const friendSet = new Set(friends.map(f => f.name));
              const friendsInRoom = participants.filter(u => friendSet.has(u));
              const expanded = expandedRooms.has(room.id);
              return (
                <div key={room.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div
                    className="px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedRooms(prev => { const n = new Set(prev); n.has(room.id) ? n.delete(room.id) : n.add(room.id); return n; })}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                          <p className="text-sm font-semibold text-charcoal truncate">{room.title || "Homeroom"}</p>
                        </div>
                        <p className="text-xs text-warm-gray mt-0.5">@{hostUsername}</p>
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
        const friendIds = new Set(friends.map(f => f.id));
        const filtered = publicScheduled.filter(s => {
          if (squadFilter && !s.squad_tags.includes(squadFilter)) return false;
          if (friendsFilter && !friendIds.has(s.created_by)) return false;
          return true;
        });
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
                const saved = savedSessionIds.has(session.id);
                const hostUsername = getProfileUsername(session.profiles);
                return (
                  <div key={session.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal truncate">{hostUsername} is {session.title || "hosting a homeroom"}</p>
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

      {/* Scheduled homerooms */}
      {scheduled.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-charcoal mb-3">
            Scheduled
            <span className="ml-1.5 text-warm-gray font-normal">· {scheduled.length}</span>
          </h2>
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
        </div>
      )}


      {/* Edit session modal */}
      {editingSession && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditingSession(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-charcoal">Edit homeroom</h2>
              <button onClick={() => setEditingSession(null)} className="text-warm-gray hover:text-charcoal p-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-warm-gray block mb-1">Name</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Homeroom name…"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 text-charcoal focus:outline-none focus:border-sage bg-white"
                />
              </div>
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
                const otherSession = task.homeroom_id && task.homeroom_id !== prepopSession?.id;
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
                        Scheduled
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="px-5 pt-3 pb-2 flex-shrink-0 border-t border-gray-100">
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                <input
                  type="text"
                  value={prepopNewTask}
                  onChange={(e) => setPrepopNewTask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addPrepopTask(); }}
                  placeholder="Add a task…"
                  className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
                />
                <button
                  onClick={addPrepopTask}
                  disabled={!prepopNewTask.trim()}
                  className="flex-shrink-0 transition-opacity"
                  style={{ opacity: prepopNewTask.trim() ? 1 : 0.3 }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="px-5 pb-5 pt-2 flex-shrink-0">
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

      {/* Join confirmation modal */}
      {pendingJoin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full shadow-xl">
            <p className="text-sm font-semibold text-charcoal mb-1">Leave active session?</p>
            <p className="text-sm text-warm-gray mb-4">
              Are you sure you want to leave <span className="font-medium text-charcoal">&ldquo;{pendingJoin.title}&rdquo;</span>?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { pendingJoin.action(); setPendingJoin(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
                style={{ background: "#7C3AED" }}
              >
                Yes, leave
              </button>
              <button
                onClick={() => setPendingJoin(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-charcoal hover:bg-gray-50 transition-colors"
              >
                No, stay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End session summary modal */}
      {endingBgSession && (() => {
        const { session, tasksDone, tasksRemaining, elapsedMin } = endingBgSession;
        const elapsedH = Math.floor(elapsedMin / 60);
        const elapsedM = elapsedMin % 60;
        const elapsedLabel = elapsedH > 0 ? `${elapsedH}h ${elapsedM}m` : `${elapsedM}m`;
        return (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setEndingBgSession(null)} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-0 flex sm:items-center sm:justify-center sm:p-4 pointer-events-none">
              <div
                className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-xl flex flex-col pointer-events-auto"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
              >
                <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-charcoal text-base">{session.title || "Homeroom"}</h2>
                      <p className="text-xs text-warm-gray mt-0.5">{elapsedLabel} · session ended</p>
                    </div>
                    <button onClick={() => setEndingBgSession(null)} className="text-warm-gray hover:text-charcoal p-1">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex-1 bg-emerald-50 rounded-xl px-3 py-2 text-center">
                      <p className="text-lg font-bold text-emerald-600">{tasksDone.length}</p>
                      <p className="text-xs text-emerald-600 font-medium">done</p>
                    </div>
                    <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2 text-center">
                      <p className="text-lg font-bold text-charcoal">{tasksRemaining.length}</p>
                      <p className="text-xs text-warm-gray font-medium">remaining</p>
                    </div>
                  </div>
                </div>

                {(tasksDone.length > 0 || tasksRemaining.length > 0) && (
                  <div className="px-5 py-3 max-h-48 overflow-y-auto space-y-1">
                    {tasksDone.map(t => (
                      <div key={t.id} className="flex items-center gap-2.5 py-1">
                        <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0" style={{ background: "#059669" }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                        <span className="text-sm text-warm-gray line-through">{t.text}</span>
                      </div>
                    ))}
                    {tasksRemaining.map(t => (
                      <div key={t.id} className="flex items-center gap-2.5 py-1">
                        <span className="w-4 h-4 rounded border border-gray-300 flex-shrink-0" />
                        <span className="text-sm text-charcoal">{t.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="px-5 pt-2 pb-5 space-y-2">
                  {tasksRemaining.length > 0 && (
                    <button
                      onClick={() => {
                        setEndingBgSession(null);
                        router.push("/start");
                      }}
                      className="w-full font-semibold text-sm py-3 rounded-xl text-white transition-opacity hover:opacity-80"
                      style={{ background: "#7C3AED" }}
                    >
                      Schedule a homeroom for remaining tasks
                    </button>
                  )}
                  <button
                    onClick={() => setEndingBgSession(null)}
                    className="w-full font-semibold text-sm py-3 rounded-xl border border-gray-200 text-charcoal hover:bg-gray-50 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-charcoal text-white text-xs font-medium px-4 py-2.5 rounded-full shadow-lg pointer-events-none z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
