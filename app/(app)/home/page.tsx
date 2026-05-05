"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROOMS } from "@/lib/data";

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

function maxDateInput(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return isoToDateInput(d.toISOString());
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

  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-charcoal truncate">{session.title || "Homeroom"}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs font-medium" style={{ color: active ? "#059669" : "#7C3AED" }}>
            {showTime ? isoTimeLabel(session.scheduledFor) : formatScheduledFor(session.scheduledFor)}
          </span>
          {session.duration > 0 && <span className="text-xs text-warm-gray">· {formatDuration(session.duration)}</span>}
          <span className="text-xs text-warm-gray">· {session.isPublic ? "Public" : "Friends only"}</span>
          {session.tasks.length > 0 && (
            <span className="text-xs text-warm-gray">· {session.tasks.length} task{session.tasks.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        {session.invitedFriends.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
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
              <span className="text-xs text-warm-gray">+{session.invitedFriends.length - 4}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Tasks pre-plan */}
        <button
          onClick={() => onPrepop(session)}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border transition-colors hover:border-sage hover:text-sage"
          style={{ borderColor: "#E5E7EB", color: "#78716C" }}
          title="Pre-plan tasks"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          Tasks
        </button>
        {/* Edit — only for sessions I own */}
        {owned && (
          <button
            onClick={() => onEdit(session)}
            className="text-xs px-2.5 py-1.5 rounded-xl border transition-colors hover:border-sage hover:text-sage"
            style={{ borderColor: "#E5E7EB", color: "#78716C" }}
            title="Edit time"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
        {/* Start / Join — only enabled when start time is near */}
        <button
          onClick={() => active && onLaunch(session)}
          disabled={!active}
          className="text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors"
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
          onClick={() => onRemove(session.id)}
          className="text-xs text-warm-gray hover:text-red-400 transition-colors"
        >
          {owned ? "Cancel" : "Leave"}
        </button>
      </div>
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

export default function HomePage() {
  const router = useRouter();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledSession[]>([]);
  const [schedView, setSchedView] = useState<"list" | "calendar">("list");
  const invites: Invite[] = [];
  const [declinedInvites, setDeclinedInvites] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Time change notifications
  const [timeChanges] = useState<TimeChangeNotif[]>([]);
  const [declinedTimeChanges, setDeclinedTimeChanges] = useState<Set<string>>(new Set());

  // All list tasks — loaded once, kept in sync when prepop saves
  const [allListTasks, setAllListTasks] = useState<ListTask[]>([]);

  // Pre-populate tasks modal
  const [prepopSession, setPrepopSession] = useState<ScheduledSession | null>(null);
  const [prepopSelected, setPrepopSelected] = useState<Set<string>>(new Set());
  const [prepopSearch, setPrepopSearch] = useState("");

  // Edit session modal
  const [editingSession, setEditingSession] = useState<ScheduledSession | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

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
  }, []);

  // Tick every 30s so Start/Join button enables at the right time
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function acceptInvite(invite: Invite) {
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
      setDeclinedInvites((prev) => new Set([...prev, invite.id]));
      showToast("Added to your scheduled homerooms");
      return;
    }
    localStorage.setItem("homeroom-session", JSON.stringify({
      title: `${invite.from.name} is ${invite.title}`,
      duration: invite.duration,
      isPublic: false,
      tasks: [],
      invitedFriends: [invite.from],
      scheduledFor: null,
    }));
    router.push("/room");
  }

  function declineInvite(id: string) {
    setDeclinedInvites((prev) => new Set([...prev, id]));
  }

  function launchScheduled(session: ScheduledSession) {
    localStorage.setItem("homeroom-session", JSON.stringify({
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
    setEditingSession(session);
  }

  function saveEdit() {
    if (!editingSession || !editDate || !editTime) return;
    const newIso = new Date(`${editDate}T${editTime}`).toISOString();
    const updated = scheduled.map((s) =>
      s.id === editingSession.id ? { ...s, scheduledFor: newIso } : s
    );
    setScheduled(updated);
    localStorage.setItem("homeroom-scheduled", JSON.stringify(updated));

    // Simulate sending time change to invited friends
    if (editingSession.invitedFriends.length > 0) {
      const names = editingSession.invitedFriends.map((f) => f.name.split(" ")[0]).join(", ");
      showToast(`Time change sent to ${names}`);
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

      {/* Active rooms */}
      <div className="mb-3" id="active-rooms">
        <h2 className="text-sm font-semibold text-charcoal mb-3">Active rooms</h2>
        <div className="space-y-3">
          {ROOMS.length === 0 ? (
            <div className="text-center py-10 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">
              No active rooms right now.
            </div>
          ) : ROOMS.map((room) => (
            <Link
              key={room.id}
              href="/room"
              className="block bg-white rounded-2xl p-4 border border-gray-100 hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{room.emoji}</span>
                  <div>
                    <div className="font-semibold text-charcoal text-sm">{room.name}</div>
                    <div className="text-xs text-warm-gray mt-0.5">{room.desc}</div>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right ml-3">
                  <div className="flex items-center gap-1 justify-end">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-clay" />
                    <span className="text-xs font-semibold text-charcoal">{room.count}</span>
                  </div>
                  <div className="text-xs text-warm-gray">people</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

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
                  max={maxDateInput()}
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
              {editingSession.invitedFriends.length > 0 && (
                <p className="text-xs text-warm-gray bg-amber-50 rounded-xl px-3 py-2">
                  Saving will notify {editingSession.invitedFriends.map((f) => f.name).join(", ")} of the time change.
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
