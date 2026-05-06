"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const USER_COLORS = ["#7C3AED","#0891B2","#059669","#D97706","#DC2626","#DB2777","#65A30D","#0284C7","#BE185D"];
function colorFromUsername(u: string): string {
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) & 0xffffffff;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

type Task = {
  id: string;
  text: string;
  done: boolean;
  timeSpent: number;
  startedAt: number | null;
};
type Friend = { id: string; name: string; initials: string; color: string };
type Session = {
  sessionId?: string;
  title: string;
  duration: number;
  isPublic: boolean;
  tasks: { id: string; text: string; done?: boolean; timeSpent?: number; startedAt?: number | null }[];
  invitedFriends: Friend[];
  scheduledFor: string | null;
  sessionStartTime?: number;
  squadTags?: string[];
};
type FeedItem = { id: string; text: string; time: Date };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function RoomPage() {
  const [myUsername, setMyUsername] = useState("You");
  const myUsernameRef = useRef<string>("");
  const [myAvatar, setMyAvatar] = useState<string>("");
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskInput, setTaskInput] = useState("");
  const [tick, setTick] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [chatMessages, setChatMessages] = useState<{ id: string; type: "chat" | "activity"; text: string; sender: string; time: Date; reactions: string[] }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [draggingId, setDraggingId]     = useState<string | null>(null);
  const [dragOverId, setDragOverId]     = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId]   = useState<string | null>(null);
  const [editingTaskText, setEditingTaskText] = useState("");
  const [showListPicker, setShowListPicker]       = useState(false);
  const [listPickerSearch, setListPickerSearch]   = useState("");
  const [tasksCollapsed, setTasksCollapsed]       = useState(false);
  const [tasksExpanded, setTasksExpanded]         = useState(false);
  const [feedExpanded, setFeedExpanded]           = useState(false);
  const [presentUsers, setPresentUsers]           = useState<{ username: string; avatar: string }[]>([]);
  const [participantData, setParticipantData]     = useState<Record<string, { tasks: { id: string; text: string; done: boolean }[]; sharing: boolean }>>({});
  const [expandedCards, setExpandedCards]         = useState<Set<string>>(new Set());
  const [myFriendUsernames, setMyFriendUsernames] = useState<Set<string>>(new Set());
  const [mySquads, setMySquads]                   = useState<{ id: string; name: string; emoji: string }[]>([]);
  const [squadMemberMap, setSquadMemberMap]       = useState<Record<string, Set<string>>>({});
  const [activeFilters, setActiveFilters]         = useState<Set<string>>(new Set());
  const [participantsExpanded, setParticipantsExpanded] = useState(false);
  const PARTICIPANTS_VISIBLE = 6;
  const TASK_VISIBLE_LIMIT = 6;
  const [myListTasks, setMyListTasks]             = useState<{ id: string; text: string; done: boolean; scheduledForSessionId?: string; scheduledForDate?: string; scheduledForTitle?: string }[]>([]);
  const [selectedListIds, setSelectedListIds]     = useState<string[]>([]);

  const REACTION_EMOJIS = ["🎉", "🙌", "🔥", "💪", "👏", "✨", "🚀", "🎯"];

  function toggleReaction(msgId: string, emoji: string) {
    setChatMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m;
      const has = m.reactions.includes(emoji);
      const added = !has;
      realtimeChannelRef.current?.send({
        type: "broadcast", event: "reaction",
        payload: { msgId, emoji, reactor: myUsernameRef.current || myUsername, added, msgSender: m.sender, msgText: m.text },
      });
      return { ...m, reactions: has ? m.reactions.filter((e) => e !== emoji) : [...m.reactions, emoji] };
    }));
  }

  function pushFeed(text: string) {
    setFeed((prev) => [{ id: crypto.randomUUID(), text, time: new Date() }, ...prev]);
  }

  // Global tick every second so running timers re-render
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Populate immediately from localStorage
    const local = localStorage.getItem("homeroom-username");
    if (local) { myUsernameRef.current = local; setMyUsername(local); }
    const localAvatar = localStorage.getItem("homeroom-avatar");
    if (localAvatar) setMyAvatar(localAvatar);
    // Always verify against Supabase — overrides stale or missing localStorage
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("profiles").select("username, avatar").eq("id", user.id).single().then(({ data }) => {
        if (!data) return;
        myUsernameRef.current = data.username;
        setMyUsername(data.username);
        localStorage.setItem("homeroom-username", data.username);
        if (data.avatar) { setMyAvatar(data.avatar); localStorage.setItem("homeroom-avatar", data.avatar); }
      });
    });
    try {
      const stored = localStorage.getItem("homeroom-session");
      if (stored) {
        const s: Session = JSON.parse(stored);
        if (!s.sessionStartTime) {
          s.sessionStartTime = Date.now();
          localStorage.setItem("homeroom-session", JSON.stringify(s));
        }
        setSession(s);
        setTasks(s.tasks.map((t) => ({ id: t.id, text: t.text, done: t.done ?? false, timeSpent: t.timeSpent ?? 0, startedAt: t.startedAt ?? null })));
        tasksInitializedRef.current = true;
        // Restore persisted feed and chat for this session
        const sid = s.sessionId;
        if (sid) {
          try {
            const savedFeed = localStorage.getItem(`homeroom-feed-${sid}`);
            if (savedFeed) setFeed(JSON.parse(savedFeed).map((i: { id: string; text: string; time: string }) => ({ ...i, time: new Date(i.time) })));
            const savedChat = localStorage.getItem(`homeroom-chat-${sid}`);
            if (savedChat) setChatMessages(JSON.parse(savedChat).map((m: { id: string; type: "chat" | "activity"; text: string; sender: string; time: string; reactions: string[] }) => ({ ...m, time: new Date(m.time) })));
          } catch { /* ignore */ }
        }
      }
      const listStored = localStorage.getItem("homeroom-tasks");
      if (listStored) setMyListTasks(JSON.parse(listStored));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!session?.sessionId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`room:${session.sessionId}`)
      .on("broadcast", { event: "message" }, ({ payload }) => {
        if (payload.sender !== myUsername) {
          setChatMessages((prev) => [...prev, { ...payload, time: new Date(payload.time) }]);
        }
      })
      .on("broadcast", { event: "request-session-info" }, () => {
        // Someone just joined — send them our start time and current task data
        const raw = localStorage.getItem("homeroom-session");
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.sessionStartTime) {
          channel.send({ type: "broadcast", event: "session-info", payload: { sessionStartTime: s.sessionStartTime } });
        }
        channel.send({
          type: "broadcast", event: "task-share",
          payload: {
            username: myUsernameRef.current,
            tasks: tasksRef.current.map((t) => ({ id: t.id, text: t.text, done: t.done })),
            sharing: showTodosRef.current,
          },
        });
      })
      .on("broadcast", { event: "session-info" }, ({ payload }) => {
        // Adopt the earliest start time so all users share the same clock
        if (!payload.sessionStartTime) return;
        setSession((prev) => {
          if (!prev) return prev;
          if (prev.sessionStartTime && prev.sessionStartTime <= payload.sessionStartTime) return prev;
          const updated = { ...prev, sessionStartTime: payload.sessionStartTime };
          localStorage.setItem("homeroom-session", JSON.stringify(updated));
          return updated;
        });
      })
      .on("broadcast", { event: "task-share" }, ({ payload }) => {
        if (!payload.username) return;
        setParticipantData((prev) => ({
          ...prev,
          [payload.username]: { tasks: payload.tasks ?? [], sharing: payload.sharing ?? false },
        }));
      })
      .on("broadcast", { event: "reaction" }, ({ payload }) => {
        const me = myUsernameRef.current || myUsername;
        if (payload.reactor === me) return; // we already updated our own state
        // Update the message reactions for everyone else
        setChatMessages((prev) => prev.map((m) => {
          if (m.id !== payload.msgId) return m;
          const has = m.reactions.includes(payload.emoji);
          if (payload.added && !has) return { ...m, reactions: [...m.reactions, payload.emoji] };
          if (!payload.added && has) return { ...m, reactions: m.reactions.filter((e) => e !== payload.emoji) };
          return m;
        }));
        // Notify the task author in their personal feed
        if (payload.added && payload.msgSender === me) {
          pushFeed(`${payload.reactor} reacted ${payload.emoji} to "${payload.msgText}"`);
        }
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const users = Object.values(state).flatMap((arr: any) => arr.map((p: any) => ({ username: p.username as string, avatar: (p.avatar as string) || "" })));
        setPresentUsers(users);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ username: myUsernameRef.current || myUsername, avatar: myAvatar || "" });
          // Share our tasks with anyone already in the room
          channel.send({
            type: "broadcast", event: "task-share",
            payload: {
              username: myUsernameRef.current || myUsername,
              tasks: tasksRef.current.map((t) => ({ id: t.id, text: t.text, done: t.done })),
              sharing: showTodosRef.current,
            },
          });
        }
        // Ask existing members for the authoritative start time (and they'll respond with task-share too)
        channel.send({ type: "broadcast", event: "request-session-info", payload: {} });
      });
    realtimeChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [session?.sessionId, myUsername]);

  // Register / deregister this session in active_sessions for public rooms
  useEffect(() => {
    if (!session?.sessionId || !session.isPublic || !myUsername || myUsername === "You") return;
    const supabase = createClient();
    console.log("[active_sessions] upserting for", session.sessionId, "isPublic:", session.isPublic, "user:", myUsername);
    supabase.from("active_sessions").upsert({
      session_id: session.sessionId,
      host_username: myUsername,
      title: session.title || "",
      duration: session.duration,
      started_at: session.sessionStartTime ? new Date(session.sessionStartTime).toISOString() : new Date().toISOString(),
      squad_tags: session.squadTags ?? [],
    }, { onConflict: "session_id", ignoreDuplicates: false }).then(({ error }) => {
      if (error) console.error("[active_sessions] upsert error:", error.message, error.code);
      else console.log("[active_sessions] upsert success");
    });
    return () => {
      supabase.from("active_sessions").delete().eq("session_id", session.sessionId!).then(({ error }) => {
        if (error) console.error("[active_sessions] delete error:", error.message);
      });
    };
  }, [session?.sessionId, session?.isPublic, myUsername]);

  function getElapsed(t: Task): number {
    if (t.startedAt === null) return t.timeSpent;
    return t.timeSpent + Math.floor((Date.now() - t.startedAt) / 1000);
  }

  function startTimer(id: string) {
    const target = tasks.find((t) => t.id === id);
    if (target) pushFeed(`▶ Started ${target.text}`);
    setTasks((prev) => prev.map((t) => {
      if (t.id === id) return { ...t, startedAt: Date.now() };
      if (t.startedAt !== null) return { ...t, timeSpent: getElapsed(t), startedAt: null };
      return t;
    }));
  }

  function stopTimer(id: string) {
    const target = tasks.find((t) => t.id === id);
    if (target) pushFeed(`⏸ Paused ${target.text} · ${formatTime(getElapsed(target))}`);
    setTasks((prev) => prev.map((t) =>
      t.id === id ? { ...t, timeSpent: getElapsed(t), startedAt: null } : t
    ));
  }

  function toggleTask(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const timeSpent = getElapsed(task);
    if (!task.done) {
      const feedText = timeSpent > 0 ? `Finished ${task.text} · ${formatTime(timeSpent)}` : `Finished ${task.text}`;
      pushFeed(feedText);
      const activityMsg = { id: crypto.randomUUID(), type: "activity" as const, text: task.text, sender: myUsernameRef.current || myUsername, time: new Date(), reactions: [] };
      setChatMessages((prev) => [...prev, activityMsg]);
      realtimeChannelRef.current?.send({ type: "broadcast", event: "message", payload: { ...activityMsg, time: activityMsg.time.toISOString() } });
      if (timeSpent > 0) {
        try {
          // Save to task history for autocomplete
          const histRaw = localStorage.getItem("homeroom-task-history");
          const hist: { text: string; lastSessionTime: number }[] = histRaw ? JSON.parse(histRaw) : [];
          const idx = hist.findIndex((h) => h.text.toLowerCase() === task.text.toLowerCase());
          if (idx >= 0) hist[idx].lastSessionTime = timeSpent;
          else hist.push({ text: task.text, lastSessionTime: timeSpent });
          localStorage.setItem("homeroom-task-history", JSON.stringify(hist));
          // Update lastSessionTime on the matching list task if it exists
          const listRaw = localStorage.getItem("homeroom-tasks");
          if (listRaw) {
            const listTasks = JSON.parse(listRaw);
            localStorage.setItem("homeroom-tasks", JSON.stringify(
              listTasks.map((lt: { text: string }) =>
                lt.text.toLowerCase() === task.text.toLowerCase() ? { ...lt, lastSessionTime: timeSpent } : lt
              )
            ));
          }
        } catch { /* ignore */ }
      }
      // If this task was pre-planned for a scheduled session, remove it from there
      try {
        const sessRaw = localStorage.getItem("homeroom-scheduled");
        if (sessRaw) {
          const sessions = JSON.parse(sessRaw);
          const updated = sessions.map((s: { tasks: { id: string }[] }) => ({
            ...s,
            tasks: s.tasks.filter((t: { id: string }) => t.id !== id),
          }));
          localStorage.setItem("homeroom-scheduled", JSON.stringify(updated));
        }
        const listRaw = localStorage.getItem("homeroom-tasks");
        if (listRaw) {
          const listTasks = JSON.parse(listRaw);
          localStorage.setItem("homeroom-tasks", JSON.stringify(
            listTasks.map((lt: { id: string; scheduledForSessionId?: string; scheduledForDate?: string; scheduledForTitle?: string }) => {
              if (lt.id === id && lt.scheduledForSessionId) {
                const { scheduledForSessionId, scheduledForDate, scheduledForTitle, ...rest } = lt;
                return rest;
              }
              return lt;
            })
          ));
        }
      } catch { /* ignore */ }

      // Mark done in My List (match by ID for list tasks, or text for ad-hoc tasks)
      try {
        const listRaw = localStorage.getItem("homeroom-tasks");
        if (listRaw) {
          const listTasks = JSON.parse(listRaw);
          localStorage.setItem("homeroom-tasks", JSON.stringify(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            listTasks.map((lt: any) =>
              (lt.id === id || lt.text?.toLowerCase() === task.text.toLowerCase())
                ? { ...lt, done: true }
                : lt
            )
          ));
        }
      } catch { /* ignore */ }
    } else {
      pushFeed(`↩ Reopened "${task.text}"`);
      // Un-complete in My List so it shows up again
      try {
        const listRaw = localStorage.getItem("homeroom-tasks");
        if (listRaw) {
          const listTasks = JSON.parse(listRaw);
          localStorage.setItem("homeroom-tasks", JSON.stringify(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            listTasks.map((lt: any) =>
              (lt.id === id || lt.text?.toLowerCase() === task.text.toLowerCase())
                ? { ...lt, done: false }
                : lt
            )
          ));
        }
      } catch { /* ignore */ }
    }
    setTasks((prev) => prev.map((t) =>
      t.id === id ? { ...t, done: !t.done, timeSpent, startedAt: null } : t
    ));
  }

  function toggleFilter(key: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleCard(username: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  function saveTaskEdit() {
    const text = editingTaskText.trim();
    if (text && editingTaskId) {
      setTasks((prev) => prev.map((t) => t.id === editingTaskId ? { ...t, text } : t));
    }
    setEditingTaskId(null);
    setEditingTaskText("");
  }

  function moveTask(fromId: string, toId: string) {
    if (fromId === toId) return;
    setTasks((prev) => {
      const arr = [...prev];
      const fromIdx = arr.findIndex((t) => t.id === fromId);
      const toIdx   = arr.findIndex((t) => t.id === toId);
      const [item]  = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
  }

  function addTask() {
    const text = taskInput.trim();
    if (!text) return;
    pushFeed(`＋ Added "${text}"`);
    setTasks((prev) => [...prev, { id: crypto.randomUUID(), text, done: false, timeSpent: 0, startedAt: null }]);
    setTaskInput("");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeChannelRef = useRef<any>(null);
  const tasksInitializedRef = useRef(false);
  const timerEndedRef = useRef(false);
  const tasksRef     = useRef<Task[]>([]);
  const showTodosRef = useRef(true);

  // Load friends and squads once username is known
  useEffect(() => {
    if (!myUsername || myUsername === "You") return;
    const supabase = createClient();
    supabase.from("friend_requests")
      .select("from_username, to_username")
      .eq("status", "accepted")
      .or(`from_username.eq.${myUsername},to_username.eq.${myUsername}`)
      .then(({ data }) => {
        if (!data) return;
        setMyFriendUsernames(new Set(
          (data as { from_username: string; to_username: string }[]).map((r) =>
            r.from_username === myUsername ? r.to_username : r.from_username
          )
        ));
      });
    supabase.from("squad_members")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("squad_id, squads(id, name, emoji)" as any)
      .eq("username", myUsername)
      .then(({ data }) => {
        if (!data) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const squads = (data as any[]).flatMap((row) => {
          const s = Array.isArray(row.squads) ? row.squads[0] : row.squads;
          if (!s) return [];
          return [{ id: s.id as string, name: s.name as string, emoji: (s.emoji as string) || "👥" }];
        });
        setMySquads(squads);
        if (squads.length === 0) return;
        supabase.from("squad_members")
          .select("squad_id, username")
          .in("squad_id", squads.map((s) => s.id))
          .then(({ data: members }) => {
            if (!members) return;
            const map: Record<string, Set<string>> = {};
            (members as { squad_id: string; username: string }[]).forEach((m) => {
              if (!map[m.squad_id]) map[m.squad_id] = new Set();
              map[m.squad_id].add(m.username);
            });
            setSquadMemberMap(map);
          });
      });
  }, [myUsername]);

  // Sync mutable ref so channel closures always see current task list
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // Persist task state (done, timeSpent) back to the session in localStorage
  useEffect(() => {
    if (!tasksInitializedRef.current) return;
    try {
      const raw = localStorage.getItem("homeroom-session");
      if (!raw) return;
      const s = JSON.parse(raw);
      localStorage.setItem("homeroom-session", JSON.stringify({ ...s, tasks }));
    } catch { /* ignore */ }
  }, [tasks]);

  // Persist feed and chat keyed by sessionId
  useEffect(() => {
    if (!session?.sessionId) return;
    try { localStorage.setItem(`homeroom-feed-${session.sessionId}`, JSON.stringify(feed)); } catch { /* ignore */ }
  }, [feed, session?.sessionId]);

  useEffect(() => {
    if (!session?.sessionId) return;
    try { localStorage.setItem(`homeroom-chat-${session.sessionId}`, JSON.stringify(chatMessages)); } catch { /* ignore */ }
  }, [chatMessages, session?.sessionId]);

  const [showTodos, setShowTodos] = useState(true);
  const [showSummary, setShowSummary] = useState(false);

  // Sync refs after showTodos is declared
  useEffect(() => { showTodosRef.current = showTodos; }, [showTodos]);

  // Broadcast own task data whenever tasks or sharing preference change
  useEffect(() => {
    if (!realtimeChannelRef.current) return;
    realtimeChannelRef.current.send({
      type: "broadcast", event: "task-share",
      payload: {
        username: myUsernameRef.current || myUsername,
        tasks: tasks.map((t) => ({ id: t.id, text: t.text, done: t.done })),
        sharing: showTodos,
      },
    });
  }, [showTodos, tasks, myUsername]);
  const doneTasks = tasks.filter((t) => t.done).length;
  const duration = session?.duration ?? 0;

  const elapsedSec = tick >= 0 && session?.sessionStartTime
    ? Math.floor((Date.now() - session.sessionStartTime) / 1000)
    : 0;
  const elapsedMin = Math.floor(elapsedSec / 60);
  const remainingSec = duration > 0 ? Math.max(0, duration * 60 - elapsedSec) : 0;
  const remainingMin = Math.floor(remainingSec / 60);
  const remainingSs  = remainingSec % 60;
  const progressPct  = duration > 0 ? Math.min(100, (elapsedSec / (duration * 60)) * 100) : 0;

  // Auto-end when session timer hits zero.
  // Include `duration` in deps so this also fires when the session first loads
  // and the timer is already expired (remainingSec stays 0 → 0, no change otherwise).
  useEffect(() => {
    if (duration > 0 && remainingSec === 0 && !timerEndedRef.current) {
      timerEndedRef.current = true;
      leaveRoom();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec, duration]);

  function leaveRoom() {
    setTasks((prev) => prev.map((t) =>
      t.startedAt !== null ? { ...t, timeSpent: getElapsed(t), startedAt: null } : t
    ));
    setShowSummary(true);
  }

  function scheduleRemaining(remaining: Task[]) {
    localStorage.setItem(
      "homeroom-carry-forward",
      JSON.stringify(remaining.map((t) => ({ id: crypto.randomUUID(), text: t.text })))
    );
    window.location.href = "/start";
  }

  function formatScheduled(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto px-4 pb-24 flex flex-col items-center justify-center min-h-[70vh] text-center">
        <div className="text-4xl mb-4">🏠</div>
        <h2 className="text-xl font-bold text-charcoal mb-2">You&apos;re not in a room</h2>
        <p className="text-sm text-warm-gray mb-8 max-w-xs">
          Start one of your own or jump into one people are already in!
        </p>
        <div className="flex gap-3 w-full max-w-xs">
          <a href="/home#active-rooms" className="flex-1 bg-charcoal text-white font-semibold text-sm py-3 rounded-xl flex items-center justify-center hover:bg-black transition-colors">
            Join a room
          </a>
          <Link href="/start" className="flex-1 bg-charcoal text-white font-semibold text-sm py-3 rounded-xl flex items-center justify-center hover:bg-black transition-colors">
            Start a room
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div id="screen-room" className="pb-20">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 border-b border-gray-100" style={{ background: "#FAFAF9" }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/home" className="text-warm-gray hover:text-charcoal mr-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="font-semibold text-charcoal text-base leading-tight">
                {session?.title || "Homeroom"}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                {session?.scheduledFor ? (
                  <span className="text-xs text-warm-gray">Scheduled for {formatScheduled(session.scheduledFor)}</span>
                ) : (
                  <>
                    <span className="inline-block w-2 h-2 rounded-full bg-clay animate-pulse" />
                    <span className="text-xs text-warm-gray">
                      {session?.isPublic ? "Public" : "Friends only"} · {duration > 0 ? `${duration} min` : "No time set"}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={leaveRoom}
            className="text-xs font-medium text-warm-gray border border-gray-200 rounded-lg px-3 py-1.5 hover:border-clay hover:text-clay transition-colors"
          >
            Leave
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* My card */}
        <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-sage flex items-center justify-center text-white font-semibold text-sm overflow-hidden">
                {myAvatar ? <span className="text-xl leading-none">{myAvatar}</span> : <span>?</span>}
              </div>
              <div>
                <span className="font-semibold text-sm text-charcoal">{myUsername}</span>
                <span className="ml-1.5 text-xs text-warm-gray">{elapsedMin} / {duration} min</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-warm-gray">{doneTasks}/{tasks.length} tasks</span>
              <button
                onClick={() => setTasksCollapsed(v => !v)}
                className="text-warm-gray p-1 transition-transform duration-200"
                style={{ transform: tasksCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                title={tasksCollapsed ? "Expand tasks" : "Collapse tasks"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>

          <div className="bg-gray-100 rounded-full h-1.5 mb-3" title={duration > 0 ? `${remainingMin}:${String(remainingSs).padStart(2,"0")} remaining` : undefined}>
            <div className="h-1.5 rounded-full bg-sage transition-all duration-1000" style={{ width: `${progressPct}%` }} />
          </div>

          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setShowTodos((v) => !v)}
              className="inline-flex items-center w-9 h-5 rounded-full p-0.5 transition-colors duration-200 flex-shrink-0"
              style={{ background: showTodos ? "#7C3AED" : "#D1D5DB" }}
            >
              <span
                className="w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"
                style={{ transform: showTodos ? "translateX(16px)" : "translateX(0px)" }}
              />
            </button>
            <span className="text-xs text-warm-gray">Share tasks with room</span>
          </div>

          <div className="">
            {/* Tasks */}
            <div className="">
              {tasks.length === 0 ? (
                <div className="text-sm text-warm-gray text-center py-4">No tasks added yet.</div>
              ) : (
                <div className="space-y-2 mb-3">
                  {(tasksCollapsed
                    ? [tasks.find(t => t.startedAt !== null) ?? tasks.find(t => !t.done) ?? tasks[0]]
                    : tasksExpanded ? tasks : tasks.slice(0, TASK_VISIBLE_LIMIT)
                  ).filter(Boolean).map((t) => {
                    const elapsed = getElapsed(t);
                    const running = t.startedAt !== null;
                    return (
                      <div
                        key={t.id}
                        draggable={!t.done}
                        onDragStart={() => setDraggingId(t.id)}
                        onDragOver={(e) => { e.preventDefault(); setDragOverId(t.id); }}
                        onDrop={() => { if (draggingId) moveTask(draggingId, t.id); setDraggingId(null); setDragOverId(null); }}
                        onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                        className="flex items-center gap-2 px-1 py-0.5 rounded-lg transition-colors"
                        style={{
                          opacity: draggingId === t.id ? 0.4 : 1,
                          background: dragOverId === t.id && draggingId !== t.id ? "#F5F3FF" : "transparent",
                          cursor: t.done ? "default" : "grab",
                        }}
                      >
                        {!t.done && (
                          <span className="flex-shrink-0 text-warm-gray opacity-40 hover:opacity-80 cursor-grab" style={{ lineHeight: 1 }}>
                            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                              <rect x="0" y="0" width="10" height="2" rx="1" />
                              <rect x="0" y="6" width="10" height="2" rx="1" />
                              <rect x="0" y="12" width="10" height="2" rx="1" />
                            </svg>
                          </span>
                        )}
                        {t.done && <span className="w-2.5 flex-shrink-0" />}
                        <button
                          onClick={() => toggleTask(t.id)}
                          className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                          style={t.done
                            ? { background: "#7C3AED", border: "2px solid #7C3AED" }
                            : { border: "2px solid #D1D5DB" }}
                        >
                          {t.done && (
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                        {editingTaskId === t.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingTaskText}
                            onChange={(e) => setEditingTaskText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveTaskEdit(); if (e.key === "Escape") { setEditingTaskId(null); setEditingTaskText(""); } }}
                            onBlur={saveTaskEdit}
                            className="flex-1 text-sm text-charcoal border border-sage rounded-lg px-2 py-0.5 focus:outline-none bg-white"
                          />
                        ) : (
                          <span
                            className={`text-sm flex-1 truncate ${t.done ? "line-through text-warm-gray" : "text-charcoal"}`}
                            onDoubleClick={() => { if (!t.done) { setEditingTaskId(t.id); setEditingTaskText(t.text); } }}
                          >
                            {t.text}
                          </span>
                        )}
                        {t.done ? (
                          <span className="text-xs text-warm-gray flex-shrink-0">{formatTime(elapsed)}</span>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-xs font-mono w-10 text-right" style={{ color: running ? "#7C3AED" : "#A8A29E" }}>
                              {elapsed > 0 || running ? formatTime(elapsed) : ""}
                            </span>
                            <button
                              onClick={() => running ? stopTimer(t.id) : startTimer(t.id)}
                              className="flex items-center justify-center w-6 h-6 rounded-full transition-colors flex-shrink-0"
                              style={running ? { background: "#7C3AED" } : { background: "#F3F4F6" }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={running ? "white" : "#78716C"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!tasksCollapsed && tasks.length > TASK_VISIBLE_LIMIT && (
                <button
                  onClick={() => setTasksExpanded(v => !v)}
                  className="text-xs font-medium mb-2"
                  style={{ color: "#7C3AED" }}
                >
                  {tasksExpanded ? "Show less" : `+ ${tasks.length - TASK_VISIBLE_LIMIT} more task${tasks.length - TASK_VISIBLE_LIMIT !== 1 ? "s" : ""}`}
                </button>
              )}

              {tasksCollapsed && tasks.filter(t => !t.done).length > 1 && (
                <button
                  onClick={() => setTasksCollapsed(false)}
                  className="text-xs text-warm-gray mt-1 mb-2"
                  style={{ color: "#7C3AED" }}
                >
                  + {tasks.filter(t => !t.done).length - 1} more task{tasks.filter(t => !t.done).length - 1 !== 1 ? "s" : ""}
                </button>
              )}

              {!tasksCollapsed && <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={taskInput}
                  onChange={(e) => setTaskInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTask()}
                  placeholder="Add a task…"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-cream text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage"
                />
                <button onClick={addTask} style={{ color: "#7C3AED" }} className="hover:opacity-70 transition-opacity">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
                  </svg>
                </button>
              </div>}

              {/* Add from list */}
              {!tasksCollapsed && (
                <button
                  onClick={() => { setShowListPicker(true); setListPickerSearch(""); setSelectedListIds([]); }}
                  className="mt-2 w-full text-xs text-warm-gray hover:text-sage flex items-center gap-1.5 transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                  Add task from list
                </button>
              )}
            </div>

            {/* Personal feed — stacked below tasks, max 3 items with expand */}
            {feed.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide">Your feed</p>
                  {feed.length > 3 && (
                    <button
                      onClick={() => setFeedExpanded(v => !v)}
                      className="text-xs font-medium"
                      style={{ color: "#7C3AED" }}
                    >
                      {feedExpanded ? "Show less" : `See all ${feed.length}`}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {(feedExpanded ? feed : feed.slice(0, 3)).map((item) => (
                    <div key={item.id}>
                      <p className="text-xs text-charcoal leading-snug">{item.text}</p>
                      <p className="text-xs text-warm-gray">
                        {item.time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>


        {/* Activity + Chat */}
        <div className="mt-4 mb-4">
          <h2 className="text-sm font-semibold text-charcoal mb-3">Activity</h2>

          {/* Chat — friends-only rooms only */}
          {session && !session.isPublic && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
              {/* Message list */}
              <div className="px-4 py-3 space-y-3 max-h-64 overflow-y-auto flex flex-col-reverse">
                {chatMessages.length === 0 ? (
                  <p className="text-sm text-warm-gray italic text-center py-4">No messages yet. Say hi!</p>
                ) : (
                  [...chatMessages].reverse().map((msg) => {
                    if (msg.type === "activity") {
                      const label = showTodos ? `${msg.sender} finished "${msg.text}"` : `${msg.sender} completed a task`;
                      return (
                        <div
                          key={msg.id}
                          className="flex flex-col items-center gap-1 py-0.5"
                          onMouseEnter={() => setHoveredMsgId(msg.id)}
                          onMouseLeave={() => setHoveredMsgId(null)}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <div className="h-px flex-1 bg-gray-100" />
                            <span className="text-xs text-warm-gray px-2 whitespace-nowrap">{label}</span>
                            <div className="h-px flex-1 bg-gray-100" />
                          </div>
                          {hoveredMsgId === msg.id && (
                            <div className="flex gap-1 bg-white border border-gray-100 rounded-full px-2 py-1 shadow-sm">
                              {REACTION_EMOJIS.map((emoji) => {
                                const reacted = msg.reactions.includes(emoji);
                                return (
                                  <button
                                    key={emoji}
                                    onClick={() => toggleReaction(msg.id, emoji)}
                                    className="text-base transition-transform hover:scale-125"
                                    style={{ opacity: reacted ? 1 : 0.5 }}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {msg.reactions.length > 0 && (
                            <div className="flex gap-1 flex-wrap justify-center">
                              {msg.reactions.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(msg.id, emoji)}
                                  className="text-sm bg-gray-50 border border-gray-100 rounded-full px-1.5 py-0.5 hover:bg-gray-100 transition-colors"
                                  style={{ opacity: 1 }}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${msg.sender === myUsername ? "items-end" : "items-start"}`}
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        onMouseLeave={() => setHoveredMsgId(null)}
                      >
                        <div
                          className="max-w-[75%] px-3 py-2 rounded-2xl text-sm"
                          style={msg.sender === myUsername
                            ? { background: "#7C3AED", color: "white" }
                            : { background: "#F3F4F6", color: "#1C1917" }}
                        >
                          {msg.text}
                        </div>
                        {hoveredMsgId === msg.id && (
                          <div className={`flex gap-1 bg-white border border-gray-100 rounded-full px-2 py-1 shadow-sm mt-1 ${msg.sender === myUsername ? "self-end" : "self-start"}`}>
                            {REACTION_EMOJIS.map((emoji) => {
                              const reacted = msg.reactions.includes(emoji);
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(msg.id, emoji)}
                                  className="text-base transition-transform hover:scale-125"
                                  style={{ opacity: reacted ? 1 : 0.5 }}
                                >
                                  {emoji}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {msg.reactions.length > 0 && (
                          <div className={`flex gap-1 flex-wrap mt-1 ${msg.sender === myUsername ? "justify-end" : "justify-start"}`}>
                            {msg.reactions.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(msg.id, emoji)}
                                className="text-sm bg-gray-50 border border-gray-100 rounded-full px-1.5 py-0.5 hover:bg-gray-100 transition-colors"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                        <span className="text-xs text-warm-gray mt-0.5 px-1">
                          {msg.sender !== myUsername && <span className="font-medium mr-1">{msg.sender}</span>}
                          {msg.time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Input */}
              <div className="border-t border-gray-100 px-3 py-2 flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const text = chatInput.trim();
                      if (!text) return;
                      const msg = { id: crypto.randomUUID(), type: "chat" as const, text, sender: myUsername, time: new Date(), reactions: [] };
                      setChatMessages((prev) => [...prev, msg]);
                      realtimeChannelRef.current?.send({ type: "broadcast", event: "message", payload: { ...msg, time: msg.time.toISOString() } });
                      setChatInput("");
                    }
                  }}
                  placeholder="Message the room…"
                  className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
                />
                <button
                  onClick={() => {
                    const text = chatInput.trim();
                    if (!text) return;
                    const msg = { id: crypto.randomUUID(), type: "chat" as const, text, sender: myUsername, time: new Date(), reactions: [] };
                    setChatMessages((prev) => [...prev, msg]);
                    realtimeChannelRef.current?.send({ type: "broadcast", event: "message", payload: { ...msg, time: msg.time.toISOString() } });
                    setChatInput("");
                  }}
                  style={{ color: "#7C3AED" }}
                  className="hover:opacity-70 transition-opacity flex-shrink-0"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {session?.isPublic && (
            <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 space-y-3 max-h-48 overflow-y-auto">
              {chatMessages.filter((m) => m.type === "activity").length === 0 ? (
                <p className="text-sm text-warm-gray italic text-center py-4">No activity yet. Complete a task to start the feed.</p>
              ) : [...chatMessages].filter((m) => m.type === "activity").reverse().map((msg) => {
                const label = showTodos ? `${msg.sender} finished "${msg.text}"` : `${msg.sender} completed a task`;
                return (
                  <div key={msg.id} className="flex items-center gap-2 w-full">
                    <div className="h-px flex-1 bg-gray-100" />
                    <span className="text-xs text-warm-gray px-2 whitespace-nowrap">{label}</span>
                    <div className="h-px flex-1 bg-gray-100" />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Participants */}
        {(() => {
          const others = presentUsers.filter(p => p.username !== (myUsernameRef.current || myUsername));
          const filteredOthers = activeFilters.size === 0 ? others : others.filter((p) => {
            for (const f of activeFilters) {
              if (f === "friends" && myFriendUsernames.has(p.username)) return true;
              if (f !== "friends" && squadMemberMap[f]?.has(p.username)) return true;
            }
            return false;
          });
          const visibleOthers = participantsExpanded ? filteredOthers : filteredOthers.slice(0, PARTICIPANTS_VISIBLE);
          const hiddenCount = filteredOthers.length - PARTICIPANTS_VISIBLE;
          return (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-charcoal">In this room</h2>
                <span className="text-xs text-warm-gray">{others.length} {others.length === 1 ? "other" : "others"}</span>
              </div>

              {/* Filter chips — only show when there are others present */}
              {others.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    onClick={() => toggleFilter("friends")}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                    style={activeFilters.has("friends")
                      ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" }
                      : { background: "white", color: "#78716C", borderColor: "#E7E5E4" }}
                  >
                    👤 Friends
                  </button>
                  {mySquads.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggleFilter(s.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                      style={activeFilters.has(s.id)
                        ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" }
                        : { background: "white", color: "#78716C", borderColor: "#E7E5E4" }}
                    >
                      {s.emoji} {s.name}
                    </button>
                  ))}
                </div>
              )}

              {others.length === 0 ? (
                <div className="text-center py-6 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">
                  No one else here yet.
                </div>
              ) : filteredOthers.length === 0 ? (
                <div className="text-center py-5 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">
                  No one here matches this filter.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {visibleOthers.map((p) => {
                      const pData = participantData[p.username];
                      const isExpanded = expandedCards.has(p.username);
                      const doneCount = pData?.tasks.filter((t) => t.done).length ?? 0;
                      const totalCount = pData?.tasks.length ?? 0;
                      return (
                        <div key={p.username} className="bg-white rounded-2xl border border-gray-100 p-2.5 flex flex-col">
                          <div className="flex items-start justify-between mb-1.5">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0"
                              style={{ background: p.avatar ? "#F3F4F6" : colorFromUsername(p.username) }}
                            >
                              {p.avatar || <span className="text-white text-xs font-bold">{p.username.slice(0, 2).toUpperCase()}</span>}
                            </div>
                            <button
                              onClick={() => toggleCard(p.username)}
                              className="text-warm-gray p-0.5 transition-transform duration-200 flex-shrink-0"
                              style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                          </div>
                          <p className="text-xs font-semibold text-charcoal truncate leading-tight">{p.username}</p>
                          <p className="text-xs text-warm-gray mt-0.5">
                            {pData ? `${doneCount}/${totalCount} tasks` : "joining…"}
                          </p>
                          {isExpanded && (
                            <div className="mt-2 pt-2 border-t border-gray-100">
                              {pData?.sharing ? (
                                pData.tasks.length === 0 ? (
                                  <p className="text-xs text-warm-gray italic">No tasks</p>
                                ) : (
                                  <div className="space-y-1">
                                    {pData.tasks.map((t) => (
                                      <div key={t.id} className="flex items-center gap-1">
                                        <div
                                          className="w-2.5 h-2.5 rounded flex-shrink-0 flex items-center justify-center"
                                          style={t.done
                                            ? { background: "#7C3AED", border: "2px solid #7C3AED" }
                                            : { border: "2px solid #D1D5DB" }}
                                        >
                                          {t.done && (
                                            <svg width="5" height="5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                              <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                          )}
                                        </div>
                                        <span className={`text-xs truncate ${t.done ? "line-through text-warm-gray" : "text-charcoal"}`}>{t.text}</span>
                                      </div>
                                    ))}
                                  </div>
                                )
                              ) : (
                                <p className="text-xs text-warm-gray italic">Private</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!participantsExpanded && hiddenCount > 0 && (
                    <button
                      onClick={() => setParticipantsExpanded(true)}
                      className="mt-2 text-xs font-medium"
                      style={{ color: "#7C3AED" }}
                    >
                      + {hiddenCount} more {hiddenCount === 1 ? "person" : "people"}
                    </button>
                  )}
                  {participantsExpanded && filteredOthers.length > PARTICIPANTS_VISIBLE && (
                    <button
                      onClick={() => setParticipantsExpanded(false)}
                      className="mt-2 text-xs font-medium"
                      style={{ color: "#7C3AED" }}
                    >
                      Show less
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* Invited but not yet joined */}
        {(() => {
          const presentSet = new Set(presentUsers.map(p => p.username));
          const pending = (session?.invitedFriends ?? []).filter(f => !presentSet.has(f.name));
          if (pending.length === 0) return null;
          return (
            <div className="mt-5">
              <h2 className="text-sm font-semibold text-charcoal mb-2">Invited · waiting to join</h2>
              <div className="flex flex-wrap gap-2">
                {pending.map((f) => (
                  <div key={f.id} className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-full px-2.5 py-1">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                      style={{ background: f.color }}
                    >
                      {f.initials}
                    </div>
                    <span className="text-xs text-warm-gray">{f.name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Add from list modal */}
      {showListPicker && (() => {
        const sessionTaskTexts = new Set(tasks.map((t) => t.text.toLowerCase()));
        const available = myListTasks.filter((t) =>
          !t.done &&
          !sessionTaskTexts.has(t.text.toLowerCase()) &&
          (!listPickerSearch || t.text.toLowerCase().includes(listPickerSearch.toLowerCase()))
        );
        const allVisibleSelected = available.length > 0 && available.every((t) => selectedListIds.includes(t.id));

        function toggleSelect(id: string) {
          setSelectedListIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
          );
        }

        function addSelected() {
          const toAdd = myListTasks.filter((t) => selectedListIds.includes(t.id));
          toAdd.forEach((t) => pushFeed(`＋ Added ${t.text} from list`));
          setTasks((prev) => [
            ...prev,
            ...toAdd.map((t) => ({ id: crypto.randomUUID(), text: t.text, done: false, timeSpent: 0, startedAt: null })),
          ]);
          setShowListPicker(false);
          setSelectedListIds([]);
        }

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
            <div className="bg-white rounded-3xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl">
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
                <h2 className="font-bold text-charcoal text-base">Add from your list</h2>
                <button onClick={() => { setShowListPicker(false); setSelectedListIds([]); }} className="text-warm-gray hover:text-charcoal p-1">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Search */}
              <div className="px-5 pb-2 flex-shrink-0">
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    autoFocus
                    type="text"
                    value={listPickerSearch}
                    onChange={(e) => setListPickerSearch(e.target.value)}
                    placeholder="Search tasks…"
                    className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
                  />
                </div>
              </div>

              {/* Select all row */}
              {available.length > 0 && (
                <div className="px-5 pb-2 flex-shrink-0">
                  <button
                    onClick={() => setSelectedListIds(allVisibleSelected ? [] : available.map((t) => t.id))}
                    className="text-xs font-semibold text-warm-gray hover:text-charcoal transition-colors"
                  >
                    {allVisibleSelected ? "Deselect all" : "Select all"}
                  </button>
                </div>
              )}

              {/* Task list */}
              <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-1">
                {myListTasks.filter((t) => !t.done).length === 0 ? (
                  <p className="text-sm text-warm-gray text-center py-6">Your list is empty.</p>
                ) : available.length === 0 ? (
                  <p className="text-sm text-warm-gray text-center py-6">
                    {listPickerSearch ? "No matches." : "All tasks are already in this session."}
                  </p>
                ) : available.map((t) => {
                  const checked = selectedListIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleSelect(t.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-gray-50"
                      style={checked ? { background: "#F5F3FF" } : {}}
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
                      <span className="text-sm text-charcoal flex-1 truncate">{t.text}</span>
                      {t.scheduledForDate && (
                        <span className="text-xs flex-shrink-0 px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: "#FEF9C3", color: "#92400E" }}>
                          {t.scheduledForTitle || "Homeroom"} {new Date(t.scheduledForDate).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={addSelected}
                  disabled={selectedListIds.length === 0}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity"
                  style={{ background: "#7C3AED", color: "white", opacity: selectedListIds.length > 0 ? 1 : 0.4 }}
                >
                  {selectedListIds.length === 0 ? "Select tasks to add" : `Add ${selectedListIds.length} task${selectedListIds.length !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Leave summary modal */}
      {showSummary && (() => {
        const done = tasks.filter((t) => t.done);
        const remaining = tasks.filter((t) => !t.done);
        const timedDone = done.filter((t) => t.timeSpent > 0);
        const elapsedDisplay = elapsedMin < 1
          ? "less than a minute"
          : elapsedMin === 1 ? "1 minute" : `${elapsedMin} minutes`;

        async function goHome() {
          if (session?.sessionId && session.isPublic) {
            const supabase = createClient();
            await supabase.from("active_sessions").delete().eq("session_id", session.sessionId);
          }
          const sid = session?.sessionId;
          localStorage.removeItem("homeroom-session");
          if (sid) {
            localStorage.removeItem(`homeroom-feed-${sid}`);
            localStorage.removeItem(`homeroom-chat-${sid}`);
          }
          window.location.href = "/home";
        }

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
            <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl p-6 flex flex-col gap-5">

              {/* Header */}
              <div className="text-center">
                <div className="text-4xl mb-3">{done.length === tasks.length && tasks.length > 0 ? "🎉" : "🏠"}</div>
                <h2 className="text-xl font-bold text-charcoal">Session wrapped</h2>
                <p className="text-sm text-warm-gray mt-1">You were in here for {elapsedDisplay}</p>
              </div>

              {/* Stats */}
              <div className="bg-gray-50 rounded-2xl px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-warm-gray">Tasks completed</span>
                  <span className="text-sm font-semibold text-charcoal">{done.length} of {tasks.length}</span>
                </div>
                {remaining.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-warm-gray">Still unfinished</span>
                    <span className="text-sm font-semibold text-charcoal">{remaining.length}</span>
                  </div>
                )}
              </div>

              {/* Beat the time */}
              {timedDone.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Tasks you beat the time on</p>
                  <div className="space-y-1.5">
                    {timedDone.map((t) => (
                      <div key={t.id} className="flex items-center justify-between rounded-xl bg-purple-50 px-3 py-2">
                        <span className="text-sm text-charcoal truncate flex-1 mr-3">{t.text}</span>
                        <span className="text-xs font-semibold flex-shrink-0" style={{ color: "#7C3AED" }}>{formatTime(t.timeSpent)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2">
                {remaining.length > 0 && (
                  <button
                    onClick={() => scheduleRemaining(remaining)}
                    className="w-full font-semibold text-sm py-3 rounded-xl text-white"
                    style={{ background: "#7C3AED" }}
                  >
                    Schedule a homeroom to finish ({remaining.length} task{remaining.length !== 1 ? "s" : ""})
                  </button>
                )}
                <button
                  onClick={goHome}
                  className="w-full font-semibold text-sm py-3 rounded-xl border border-gray-200 text-charcoal hover:bg-gray-50 transition-colors"
                >
                  Back to home
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
