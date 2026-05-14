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
  completedAt: number | null;
};
type Friend = { id: string; name: string; initials: string; color: string };
type Session = {
  homeroomId: string;
  title: string;
  duration: number;
  isPublic: boolean;
  startedAt: string;
  squadTags: string[];
  invitedFriends: Friend[];
};

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatRelativeTime(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export default function RoomPage() {
  const [loading, setLoading] = useState(true);
  const [myUsername, setMyUsername] = useState("You");
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const myUsernameRef = useRef<string>("");
  const [myAvatar, setMyAvatar] = useState<string>("");
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskInput, setTaskInput] = useState("");
  const [tick, setTick] = useState(0);
  const [chatMessages, setChatMessages] = useState<{ id: string; type: "chat" | "activity" | "highfive"; text: string; sender: string; time: Date; reactions: string[] }[]>([]);
  const [highfivedUsers, setHighfivedUsers] = useState<Set<string>>(new Set());
  const [receivedHighfivesFrom, setReceivedHighfivesFrom] = useState<Set<string>>(new Set());
  const [chatInput, setChatInput] = useState("");
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [draggingId, setDraggingId]     = useState<string | null>(null);
  const [dragOverId, setDragOverId]     = useState<string | null>(null);
  const touchDragRef = useRef<{ taskId: string; startY: number; active: boolean; timer: ReturnType<typeof setTimeout> | null }>({ taskId: "", startY: 0, active: false, timer: null });
  const touchDragOverRef = useRef<string | null>(null);
  const [editingTaskId, setEditingTaskId]   = useState<string | null>(null);
  const [editingTaskText, setEditingTaskText] = useState("");
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
  const [showListPicker, setShowListPicker]       = useState(false);
  const [listPickerSearch, setListPickerSearch]   = useState("");
  const [tasksCollapsed, setTasksCollapsed]       = useState(false);
  const [tasksExpanded, setTasksExpanded]         = useState(false);
  const [doneCollapsed, setDoneCollapsed]         = useState(() => { try { return localStorage.getItem("homeroom-done-collapsed") === "true"; } catch { return false; } });
  const [activityCollapsed, setActivityCollapsed]       = useState(() => { try { return localStorage.getItem("homeroom-activity-collapsed") === "true"; } catch { return false; } });
  const [participantsCollapsed, setParticipantsCollapsed] = useState(() => { try { return localStorage.getItem("homeroom-participants-collapsed") === "true"; } catch { return false; } });
  const [invitedCollapsed, setInvitedCollapsed]           = useState(() => { try { return localStorage.getItem("homeroom-invited-collapsed") === "true"; } catch { return false; } });

  function toggleDoneCollapsed() {
    const next = !doneCollapsed;
    setDoneCollapsed(next);
    try { localStorage.setItem("homeroom-done-collapsed", String(next)); } catch { /* ignore */ }
  }
  function toggleActivityCollapsed() {
    const next = !activityCollapsed;
    setActivityCollapsed(next);
    try { localStorage.setItem("homeroom-activity-collapsed", String(next)); } catch { /* ignore */ }
  }
  function toggleParticipantsCollapsed() {
    const next = !participantsCollapsed;
    setParticipantsCollapsed(next);
    try { localStorage.setItem("homeroom-participants-collapsed", String(next)); } catch { /* ignore */ }
  }
  function toggleInvitedCollapsed() {
    const next = !invitedCollapsed;
    setInvitedCollapsed(next);
    try { localStorage.setItem("homeroom-invited-collapsed", String(next)); } catch { /* ignore */ }
  }
  const [presentUsers, setPresentUsers]           = useState<{ username: string; avatar: string }[]>([]);
  const [dbParticipants, setDbParticipants]       = useState<{ userId: string; username: string; avatar: string }[]>([]);
  const [participantData, setParticipantData]     = useState<Record<string, { tasks: { id: string; text: string; done: boolean }[]; sharing: boolean }>>({});
  const [expandedCards, setExpandedCards]         = useState<Set<string>>(new Set());
  const [myFriendUsernames, setMyFriendUsernames] = useState<Set<string>>(new Set());
  const [friendsWithIds, setFriendsWithIds] = useState<{ username: string; userId: string; color: string; initials: string }[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [invitedInSession, setInvitedInSession] = useState<Set<string>>(new Set());
  const [resentIds, setResentIds] = useState<Set<string>>(new Set());
  const [mySquads, setMySquads]                   = useState<{ id: string; name: string; emoji: string }[]>([]);
  const [squadMemberMap, setSquadMemberMap]       = useState<Record<string, Set<string>>>({});
  const [activeFilters, setActiveFilters]         = useState<Set<string>>(new Set());
  const [participantsExpanded, setParticipantsExpanded] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const showChatRef = useRef(false);
  const swipeChatRef = useRef({ startX: 0, startY: 0, active: false });
  const PARTICIPANTS_VISIBLE = 6;
  const TASK_VISIBLE_LIMIT = 6;
  const [myListTasks, setMyListTasks] = useState<{ id: string; text: string; done: boolean }[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);

  const REACTION_EMOJIS = ["🎉", "🙌", "🔥", "💪", "👏", "🚀", "🎯"];

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

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeChannelRef = useRef<any>(null);
  const tasksInitializedRef = useRef(false);
  const timerEndedRef = useRef(false);
  const tasksRef        = useRef<Task[]>([]);
  const chatMessagesRef = useRef<typeof chatMessages>([]);
  const showTodosRef = useRef(true);
  const homeroomIdRef = useRef<string | null>(null);

  useEffect(() => {
    const homeroomId = new URLSearchParams(window.location.search).get("id");
    if (!homeroomId) { setLoading(false); return; }
    homeroomIdRef.current = homeroomId;

    // Restore cached messages immediately so activity feed isn't blank on re-entry
    try {
      const cached = sessionStorage.getItem(`homeroom-msgs-${homeroomId}`);
      if (cached) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msgs = (JSON.parse(cached) as any[]).map(m => ({ ...m, time: new Date(m.time) }));
        setChatMessages(msgs);
      }
    } catch { /* ignore */ }

    // Restore high-fived users so the button stays disabled on re-entry
    try {
      const cachedHf = sessionStorage.getItem(`homeroom-highfived-${homeroomId}`);
      if (cachedHf) setHighfivedUsers(new Set(JSON.parse(cachedHf)));
    } catch { /* ignore */ }

    // Restore who has high-fived me
    try {
      const cachedRhf = sessionStorage.getItem(`homeroom-receivedhf-${homeroomId}`);
      if (cachedRhf) setReceivedHighfivesFrom(new Set(JSON.parse(cachedRhf)));
    } catch { /* ignore */ }

    // Restore participant cards immediately so "In this room" isn't blank on re-entry
    try {
      const cachedP = sessionStorage.getItem(`homeroom-participants-${homeroomId}`);
      if (cachedP) setDbParticipants(JSON.parse(cachedP));
    } catch { /* ignore */ }

    // Restore participant task data so cards don't flash "joining…"
    try {
      const cachedPD = sessionStorage.getItem(`homeroom-participantdata-${homeroomId}`);
      if (cachedPD) setParticipantData(JSON.parse(cachedPD));
    } catch { /* ignore */ }

    // Restore share-tasks toggle preference per room
    try {
      const cachedST = sessionStorage.getItem(`homeroom-show-todos-${homeroomId}`);
      if (cachedST !== null) { const val = cachedST === "true"; showTodosRef.current = val; setShowTodos(val); }
    } catch { /* ignore */ }

    const local = localStorage.getItem("homeroom-username");
    if (local) { myUsernameRef.current = local; setMyUsername(local); }
    const localAvatar = localStorage.getItem("homeroom-avatar");
    if (localAvatar) setMyAvatar(localAvatar);

    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setMyUserId(user.id);
      supabase.from("profiles").select("username, avatar").eq("id", user.id).single().then(({ data }) => {
        if (!data) return;
        myUsernameRef.current = data.username;
        setMyUsername(data.username);
        localStorage.setItem("homeroom-username", data.username);
        if (data.avatar) { setMyAvatar(data.avatar); localStorage.setItem("homeroom-avatar", data.avatar); }
      });
    });

    (async () => {
      const { data: homeroom } = await supabase.from("homerooms").select("*").eq("id", homeroomId).single();
      if (!homeroom) { setLoading(false); return; }

      // If room already ended, load tasks then show end popup immediately
      if (homeroom.status === "completed") {
        const { data: taskData } = await supabase
          .from("tasks").select("id, text, done, time_spent, completed_at, timer_started_at")
          .eq("homeroom_id", homeroomId).order("sort_order", { ascending: true });
        setSession({
          homeroomId: homeroom.id, title: homeroom.title, duration: homeroom.duration,
          isPublic: !homeroom.is_private, startedAt: homeroom.started_at ?? new Date().toISOString(),
          squadTags: homeroom.squad_tags ?? [], invitedFriends: [],
        });
        if (taskData) setTasks(taskData.map(t => ({ id: t.id, text: t.text, done: t.done, timeSpent: t.time_spent ?? 0, startedAt: t.timer_started_at ? new Date(t.timer_started_at).getTime() : null, completedAt: t.completed_at ? new Date(t.completed_at).getTime() : null })));
        timerEndedRef.current = true;
        setShowSummary(true);
        setLoading(false);
        return;
      }

      // Load invited friends from homeroom_invites
      const { data: inviteData } = await supabase
        .from("homeroom_invites")
        .select("to_user")
        .eq("homeroom_id", homeroomId)
        .in("status", ["pending", "accepted"]);
      let invitedFriends: Friend[] = [];
      if (inviteData && inviteData.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("username")
          .in("id", inviteData.map(i => i.to_user));
        if (profiles) {
          invitedFriends = profiles.map(p => ({
            id: p.username.toLowerCase(),
            name: p.username,
            initials: p.username.slice(0, 2).toUpperCase(),
            color: colorFromUsername(p.username),
          }));
        }
      }

      setSession({
        homeroomId: homeroom.id,
        title: homeroom.title,
        duration: homeroom.duration,
        isPublic: !homeroom.is_private,
        startedAt: homeroom.started_at ?? new Date().toISOString(),
        squadTags: homeroom.squad_tags ?? [],
        invitedFriends,
      });

      // Load all participants who have joined this session
      const { data: participantRows } = await supabase
        .from("homeroom_participants")
        .select("user_id")
        .eq("homeroom_id", homeroomId);
      if (participantRows && participantRows.length > 0) {
        const myId = (await supabase.auth.getUser()).data.user?.id;
        const otherIds = participantRows.map(r => r.user_id as string).filter(id => id !== myId);
        if (otherIds.length > 0) {
          const { data: profileRows } = await supabase
            .from("profiles")
            .select("id, username, avatar")
            .in("id", otherIds);
          if (profileRows) {
            setDbParticipants(profileRows.map(p => ({
              userId: p.id as string,
              username: p.username as string ?? "",
              avatar: p.avatar as string ?? "",
            })).filter(p => p.username));
          }
        }
      }

      // Load tasks
      const { data: taskData } = await supabase
        .from("tasks")
        .select("id, text, done, time_spent, completed_at, timer_started_at")
        .eq("homeroom_id", homeroomId)
        .order("sort_order", { ascending: true });
      if (taskData) {
        setTasks(taskData.map(t => ({
          id: t.id,
          text: t.text,
          done: t.done,
          timeSpent: t.time_spent ?? 0,
          startedAt: t.timer_started_at ? new Date(t.timer_started_at).getTime() : null,
          completedAt: t.completed_at ? new Date(t.completed_at).getTime() : null,
        })));
        tasksInitializedRef.current = true;
      }

      // Load chat from DB
      const { data: msgData } = await supabase
        .from("homeroom_messages")
        .select("id, sender, text, type, created_at")
        .eq("homeroom_id", homeroomId)
        .order("created_at", { ascending: true });
      if (msgData) {
        const me = myUsernameRef.current || (await supabase.from("profiles").select("username").eq("id", (await supabase.auth.getUser()).data.user?.id ?? "").single()).data?.username;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loaded = (msgData as any[]).map(m => ({
          id: m.id,
          type: m.type as "chat" | "activity" | "highfive",
          text: m.text,
          sender: m.sender,
          time: new Date(m.created_at),
          reactions: [] as string[],
        }));
        // Merge with cached messages — preserve reactions from cache, add new DB messages
        setChatMessages(prev => {
          const cachedById = new Map(prev.map(m => [m.id, m]));
          return loaded.map(m => cachedById.has(m.id) ? { ...m, reactions: cachedById.get(m.id)!.reactions } : m);
        });
        try {
          sessionStorage.setItem(`homeroom-msgs-${homeroomId}`, JSON.stringify(loaded.map(m => ({ ...m, time: m.time.toISOString() }))));
        } catch { /* ignore */ }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const alreadyHighfived = new Set((msgData as any[]).filter(m => m.type === "highfive" && m.sender === me).map(m => m.text as string));
        if (alreadyHighfived.size > 0) setHighfivedUsers(alreadyHighfived);
        const hfFromOthers = new Set((msgData as any[]).filter(m => m.type === "highfive" && m.text === me).map(m => m.sender as string));
        if (hfFromOthers.size > 0) setReceivedHighfivesFrom(hfFromOthers);
      }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime channel — uses homeroomId from session
  useEffect(() => {
    if (!session?.homeroomId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`room:${session.homeroomId}`)
      .on("broadcast", { event: "message" }, ({ payload }) => {
        if (payload.sender !== myUsername) {
          setChatMessages((prev) => [...prev, { ...payload, time: new Date(payload.time) }]);
          if (payload.type === "chat" && !showChatRef.current) setChatUnread((prev) => prev + 1);
          if (payload.type === "highfive" && payload.text === myUsername) {
            setReceivedHighfivesFrom((prev) => new Set([...prev, payload.sender]));
          }
        }
      })
      .on("broadcast", { event: "task-share" }, ({ payload }) => {
        if (!payload.username) return;
        setParticipantData((prev) => ({
          ...prev,
          [payload.username]: { tasks: payload.tasks ?? [], sharing: payload.sharing ?? false },
        }));
        // Build participant list directly from broadcast — no DB fetch needed
        setDbParticipants((prev) => {
          if (prev.some(p => p.username === payload.username)) return prev;
          return [...prev, { userId: "", username: payload.username, avatar: payload.avatar ?? "" }];
        });
      })
      .on("broadcast", { event: "user-left" }, ({ payload }) => {
        if (!payload.username) return;
        // Keep the card — presence handles the green dot. Only clear task-share data.
        setParticipantData((prev) => { const n = { ...prev }; delete n[payload.username]; return n; });
      })
      .on("broadcast", { event: "request-session-info" }, () => {
        const me = myUsernameRef.current || myUsername;
        if (!me) return;
        channel.send({
          type: "broadcast", event: "task-share",
          payload: {
            username: me,
            avatar: myAvatar || "",
            tasks: tasksRef.current.map((t) => ({ id: t.id, text: t.text, done: t.done })),
            sharing: showTodosRef.current,
          },
        });
      })
      .on("broadcast", { event: "session-ended" }, () => {
        if (!timerEndedRef.current) {
          timerEndedRef.current = true;
          leaveRoom();
        }
      })
      .on("broadcast", { event: "reaction" }, ({ payload }) => {
        const me = myUsernameRef.current || myUsername;
        if (payload.reactor === me) return;
        setChatMessages((prev) => prev.map((m) => {
          if (m.id !== payload.msgId) return m;
          const has = m.reactions.includes(payload.emoji);
          if (payload.added && !has) return { ...m, reactions: [...m.reactions, payload.emoji] };
          if (!payload.added && has) return { ...m, reactions: m.reactions.filter((e) => e !== payload.emoji) };
          return m;
        }));
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
          channel.send({
            type: "broadcast", event: "task-share",
            payload: {
              username: myUsernameRef.current || myUsername,
              avatar: myAvatar || "",
              tasks: tasksRef.current.map((t) => ({ id: t.id, text: t.text, done: t.done })),
              sharing: showTodosRef.current,
            },
          });
        }
        channel.send({ type: "broadcast", event: "request-session-info", payload: {} });
      });
    realtimeChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [session?.homeroomId, myUsername]);

  // Register in homeroom_participants when session + userId are known
  useEffect(() => {
    if (!session?.homeroomId || !myUserId) return;
    const supabase = createClient();
    supabase.from("homeroom_participants").upsert(
      { homeroom_id: session.homeroomId, user_id: myUserId, joined_at: new Date().toISOString() },
      { onConflict: "homeroom_id,user_id", ignoreDuplicates: true }
    );
  }, [session?.homeroomId, myUserId]);

  function getElapsed(t: Task): number {
    if (t.startedAt === null) return t.timeSpent;
    return t.timeSpent + Math.floor((Date.now() - t.startedAt) / 1000);
  }

  function startTimer(id: string) {
    const now = Date.now();
    const supabase = createClient();
    // Stop any previously running timer
    const prev = tasks.find(t => t.startedAt !== null && t.id !== id);
    if (prev) {
      supabase.from("tasks").update({ timer_started_at: null, time_spent: getElapsed(prev) }).eq("id", prev.id).then(() => {});
    }
    supabase.from("tasks").update({ timer_started_at: new Date(now).toISOString() }).eq("id", id).then(() => {});
    setTasks((prevTasks) => prevTasks.map((t) => {
      if (t.id === id) return { ...t, startedAt: now };
      if (t.startedAt !== null) return { ...t, timeSpent: getElapsed(t), startedAt: null };
      return t;
    }));
  }

  function stopTimer(id: string) {
    const task = tasks.find(t => t.id === id);
    const timeSpent = task ? getElapsed(task) : 0;
    const supabase = createClient();
    supabase.from("tasks").update({ timer_started_at: null, time_spent: timeSpent }).eq("id", id).then(() => {});
    setTasks((prev) => prev.map((t) =>
      t.id === id ? { ...t, timeSpent: getElapsed(t), startedAt: null } : t
    ));
  }

  async function toggleTask(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const timeSpent = getElapsed(task);
    const nowDone = !task.done;
    if (task.startedAt !== null) {
      // Timer was running — will be cleared via timer_started_at: null in the DB update below
    }
    const supabase = createClient();

    if (nowDone) {
      const activityMsg = { id: crypto.randomUUID(), type: "activity" as const, text: task.text, sender: myUsernameRef.current || myUsername, time: new Date(), reactions: [] };
      setChatMessages((prev) => [...prev, activityMsg]);
      realtimeChannelRef.current?.send({ type: "broadcast", event: "message", payload: { ...activityMsg, time: activityMsg.time.toISOString() } });
      if (session?.homeroomId) {
        supabase.from("homeroom_messages").insert({
          id: activityMsg.id, homeroom_id: session.homeroomId, sender: activityMsg.sender,
          text: activityMsg.text, type: "activity", created_at: activityMsg.time.toISOString(),
        }).then(({ error }) => { if (error) console.error("homeroom_messages insert failed:", error.message); });
      }

      // Save to task history for autocomplete
      try {
        const histRaw = localStorage.getItem("homeroom-task-history");
        const hist: { text: string; lastSessionTime: number }[] = histRaw ? JSON.parse(histRaw) : [];
        const idx = hist.findIndex((h) => h.text.toLowerCase() === task.text.toLowerCase());
        if (idx >= 0) hist[idx].lastSessionTime = timeSpent;
        else hist.push({ text: task.text, lastSessionTime: timeSpent });
        localStorage.setItem("homeroom-task-history", JSON.stringify(hist));
      } catch { /* ignore */ }
    }

    // Write to DB
    await supabase.from("tasks").update({
      done: nowDone,
      time_spent: timeSpent,
      timer_started_at: null,
      completed_at: nowDone ? new Date().toISOString() : null,
    }).eq("id", id);

    const completedAt = nowDone ? Date.now() : null;
    setTasks((prev) => prev.map((t) =>
      t.id === id ? { ...t, done: nowDone, timeSpent, startedAt: null, completedAt } : t
    ));
  }

  function sendChatMessage() {
    const text = chatInput.trim();
    if (!text) return;
    const msg = { id: crypto.randomUUID(), type: "chat" as const, text, sender: myUsername, time: new Date(), reactions: [] };
    setChatMessages((prev) => [...prev, msg]);
    realtimeChannelRef.current?.send({ type: "broadcast", event: "message", payload: { ...msg, time: msg.time.toISOString() } });
    if (session?.homeroomId) {
      const supabase = createClient();
      supabase.from("homeroom_messages").insert({ id: msg.id, homeroom_id: session.homeroomId, sender: msg.sender, text: msg.text, type: "chat", created_at: msg.time.toISOString() }).then(() => {});
    }
    setChatInput("");
  }

  function sendHighFive(targetUsername: string) {
    setHighfivedUsers((prev) => new Set([...prev, targetUsername]));
    const msg = { id: crypto.randomUUID(), type: "highfive" as const, text: targetUsername, sender: myUsernameRef.current || myUsername, time: new Date(), reactions: [] };
    setChatMessages((prev) => [...prev, msg]);
    realtimeChannelRef.current?.send({ type: "broadcast", event: "message", payload: { ...msg, time: msg.time.toISOString() } });
    if (session?.homeroomId) {
      const supabase = createClient();
      supabase.from("homeroom_messages").insert({ id: msg.id, homeroom_id: session.homeroomId, sender: msg.sender, text: msg.text, type: "highfive", created_at: msg.time.toISOString() }).then(() => {});
    }
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

  async function removeTaskFromRoom(id: string) {
    const supabase = createClient();
    await supabase.from("tasks").update({ homeroom_id: null }).eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function deleteTask(id: string) {
    const supabase = createClient();
    await supabase.from("tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function saveTaskEdit() {
    const text = editingTaskText.trim();
    if (text && editingTaskId) {
      setTasks((prev) => prev.map((t) => t.id === editingTaskId ? { ...t, text } : t));
      const supabase = createClient();
      supabase.from("tasks").update({ text }).eq("id", editingTaskId);
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
      // Persist new order to DB
      const supabase = createClient();
      arr.forEach((t, i) => {
        supabase.from("tasks").update({ sort_order: i }).eq("id", t.id).then(() => {});
      });
      return arr;
    });
  }

  // Touch drag — prevent scroll while dragging (mounted once, checks ref)
  useEffect(() => {
    const prevent = (e: TouchEvent) => { if (touchDragRef.current.active) e.preventDefault(); };
    document.addEventListener("touchmove", prevent, { passive: false });
    return () => document.removeEventListener("touchmove", prevent);
  }, []);

  function onHandleTouchStart(e: React.TouchEvent, taskId: string) {
    const startY = e.touches[0].clientY;
    touchDragRef.current = {
      taskId, startY, active: false,
      timer: setTimeout(() => {
        touchDragRef.current.active = true;
        setDraggingId(taskId);
        if (navigator.vibrate) navigator.vibrate(30);
      }, 400),
    };
  }

  function onHandleTouchMove(e: React.TouchEvent) {
    const ref = touchDragRef.current;
    if (!ref.active) {
      if (Math.abs(e.touches[0].clientY - ref.startY) > 8 && ref.timer) {
        clearTimeout(ref.timer);
        ref.timer = null;
      }
      return;
    }
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const taskEl = el?.closest("[data-task-id]");
    const overId = taskEl?.getAttribute("data-task-id") ?? null;
    touchDragOverRef.current = overId;
    setDragOverId(overId);
  }

  function onHandleTouchEnd() {
    const ref = touchDragRef.current;
    if (ref.timer) clearTimeout(ref.timer);
    if (ref.active && touchDragOverRef.current && touchDragOverRef.current !== ref.taskId) {
      moveTask(ref.taskId, touchDragOverRef.current);
    }
    touchDragOverRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    touchDragRef.current = { taskId: "", startY: 0, active: false, timer: null };
  }

  async function sendInvite(friend: { username: string; userId: string }) {
    if (!session?.homeroomId || !myUserId) return;
    const supabase = createClient();
    const { error } = await supabase.from("homeroom_invites").upsert({
      homeroom_id: session.homeroomId,
      from_user: myUserId,
      to_user: friend.userId,
      status: "pending",
    }, { onConflict: "homeroom_id,to_user" });
    if (!error) setInvitedInSession(prev => new Set([...prev, friend.userId]));
  }

  async function resendInvite(userId: string, username: string) {
    await sendInvite({ username, userId });
    setResentIds(prev => new Set([...prev, userId]));
    setTimeout(() => setResentIds(prev => { const n = new Set(prev); n.delete(userId); return n; }), 2000);
  }

  async function addTask() {
    const text = taskInput.trim();
    if (!text || !session?.homeroomId) return;
    setTaskInput("");
    const supabase = createClient();
    const userId = myUserId ?? (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;
    const { data } = await supabase.from("tasks").insert({
      user_id: userId,
      text,
      done: false,
      time_spent: 0,
      homeroom_id: session.homeroomId,
      sort_order: tasks.length,
    }).select("id").single();
    if (data) {
      setTasks((prev) => [...prev, { id: data.id, text, done: false, timeSpent: 0, startedAt: null, completedAt: null }]);
    }
  }

  // Load friends and squads once username is known
  useEffect(() => {
    if (!myUsername || myUsername === "You") return;
    const supabase = createClient();
    supabase.from("friend_requests")
      .select("from_username, to_username")
      .eq("status", "accepted")
      .or(`from_username.eq.${myUsername},to_username.eq.${myUsername}`)
      .then(async ({ data }) => {
        if (!data) return;
        const usernames = (data as { from_username: string; to_username: string }[]).map((r) =>
          r.from_username === myUsername ? r.to_username : r.from_username
        );
        setMyFriendUsernames(new Set(usernames));
        if (!usernames.length) return;
        const { data: profiles } = await supabase.from("profiles").select("id, username").in("username", usernames);
        if (profiles) {
          setFriendsWithIds(profiles.map(p => ({
            username: p.username,
            userId: p.id,
            color: colorFromUsername(p.username),
            initials: p.username.slice(0, 2).toUpperCase(),
          })));
        }
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

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
    if (!homeroomIdRef.current || chatMessages.length === 0) return;
    try {
      sessionStorage.setItem(`homeroom-msgs-${homeroomIdRef.current}`, JSON.stringify(chatMessages.map(m => ({ ...m, time: m.time.toISOString() }))));
    } catch { /* ignore */ }
  }, [chatMessages]);
  useEffect(() => {
    if (!homeroomIdRef.current || highfivedUsers.size === 0) return;
    try {
      sessionStorage.setItem(`homeroom-highfived-${homeroomIdRef.current}`, JSON.stringify([...highfivedUsers]));
    } catch { /* ignore */ }
  }, [highfivedUsers]);
  useEffect(() => {
    if (!homeroomIdRef.current || receivedHighfivesFrom.size === 0) return;
    try {
      sessionStorage.setItem(`homeroom-receivedhf-${homeroomIdRef.current}`, JSON.stringify([...receivedHighfivesFrom]));
    } catch { /* ignore */ }
  }, [receivedHighfivesFrom]);
  useEffect(() => {
    if (!homeroomIdRef.current || dbParticipants.length === 0) return;
    try {
      sessionStorage.setItem(`homeroom-participants-${homeroomIdRef.current}`, JSON.stringify(dbParticipants));
    } catch { /* ignore */ }
  }, [dbParticipants]);
  useEffect(() => {
    if (!homeroomIdRef.current || Object.keys(participantData).length === 0) return;
    try {
      sessionStorage.setItem(`homeroom-participantdata-${homeroomIdRef.current}`, JSON.stringify(participantData));
    } catch { /* ignore */ }
  }, [participantData]);
  useEffect(() => { showChatRef.current = showChat; if (showChat) setChatUnread(0); }, [showChat]);

  const [showTodos, setShowTodos] = useState(true);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => { showTodosRef.current = showTodos; }, [showTodos]);
  useEffect(() => {
    if (!homeroomIdRef.current) return;
    try {
      sessionStorage.setItem(`homeroom-show-todos-${homeroomIdRef.current}`, String(showTodos));
    } catch { /* ignore */ }
  }, [showTodos]);

  useEffect(() => {
    if (!realtimeChannelRef.current) return;
    realtimeChannelRef.current.send({
      type: "broadcast", event: "task-share",
      payload: {
        username: myUsernameRef.current || myUsername,
        avatar: myAvatar || "",
        tasks: tasks.map((t) => ({ id: t.id, text: t.text, done: t.done })),
        sharing: showTodos,
      },
    });
  }, [showTodos, tasks, myUsername]);

  const undoneSorted = tasks.filter(t => !t.done);
  const doneSorted   = tasks.filter(t => t.done).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const doneTasks = tasks.filter((t) => t.done).length;
  const groupDone = doneTasks + Object.values(participantData).reduce((sum, p) => sum + p.tasks.filter(t => t.done).length, 0);
  const duration = session?.duration ?? 0;

  const elapsedSec = tick >= 0 && session?.startedAt
    ? Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000)
    : 0;
  const elapsedMin = Math.floor(elapsedSec / 60);
  const remainingSec = duration > 0 ? Math.max(0, duration * 60 - elapsedSec) : 0;
  const remainingMin = Math.floor(remainingSec / 60);
  const progressPct  = duration > 0 ? Math.min(100, (elapsedSec / (duration * 60)) * 100) : 0;

  useEffect(() => {
    if (duration > 0 && remainingSec === 0 && !timerEndedRef.current) {
      timerEndedRef.current = true;
      // Mark completed immediately so the home page removes it from active rooms
      const supabase = createClient();
      const homeroomId = session?.homeroomId;
      if (homeroomId) {
        realtimeChannelRef.current?.send({ type: "broadcast", event: "session-ended", payload: {} });
        supabase.from("homerooms")
          .update({ status: "completed", ended_at: new Date().toISOString() })
          .eq("id", homeroomId)
          .then(() => {});
        if (myUserId) {
          supabase.from("tasks")
            .update({ homeroom_id: null })
            .eq("homeroom_id", homeroomId).eq("user_id", myUserId).eq("done", false)
            .then(() => {});
        }
      }
      leaveRoom();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec, duration]);

  async function leaveRoom() {
    // Stop any running timer and accumulate time
    const runningTask = tasks.find(t => t.startedAt !== null);
    setTasks((prev) => prev.map((t) =>
      t.startedAt !== null ? { ...t, timeSpent: getElapsed(t), startedAt: null } : t
    ));
    if (session?.homeroomId && myUserId) {
      const supabase = createClient();
      // Flush running timer to DB before leaving
      if (runningTask) {
        await supabase.from("tasks").update({ timer_started_at: null, time_spent: getElapsed(runningTask) }).eq("id", runningTask.id);
      }
      await supabase.from("homeroom_participants").delete()
        .eq("homeroom_id", session.homeroomId).eq("user_id", myUserId);
      supabase.from("tasks").update({ homeroom_id: null })
        .eq("homeroom_id", session.homeroomId).eq("user_id", myUserId).eq("done", false).then(() => {});
      realtimeChannelRef.current?.send({
        type: "broadcast", event: "user-left",
        payload: { username: myUsernameRef.current || myUsername },
      });
      // If no participants remain, mark completed and clean up
      const { count } = await supabase.from("homeroom_participants")
        .select("*", { count: "exact", head: true })
        .eq("homeroom_id", session.homeroomId);
      if (count === 0) {
        await supabase.from("homerooms")
          .update({ status: "completed", ended_at: new Date().toISOString() })
          .eq("id", session.homeroomId);
        realtimeChannelRef.current?.send({ type: "broadcast", event: "session-ended", payload: {} });
        // Delete ephemeral homeroom data
        supabase.from("homeroom_messages").delete().eq("homeroom_id", session.homeroomId).then(() => {});
        if (session.isPublic) {
          supabase.from("homeroom_participants").delete().eq("homeroom_id", session.homeroomId).then(() => {});
        }
      }
    }
    setShowSummary(true);
  }

  function scheduleRemaining(remaining: Task[]) {
    localStorage.setItem(
      "homeroom-carry-forward",
      JSON.stringify(remaining.map((t) => ({ id: t.id, text: t.text })))
    );
    window.location.href = "/start";
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 flex items-center justify-center min-h-[70vh]">
        <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-sage animate-spin" />
      </div>
    );
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
    <div
      id="screen-room"
      className="pb-20"
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t.clientX > window.innerWidth - 28) {
          swipeChatRef.current = { startX: t.clientX, startY: t.clientY, active: true };
        }
      }}
      onTouchMove={(e) => {
        if (!swipeChatRef.current.active || showChat || session?.isPublic) return;
        const t = e.touches[0];
        const dx = swipeChatRef.current.startX - t.clientX;
        const dy = Math.abs(swipeChatRef.current.startY - t.clientY);
        if (dx > 50 && dy < 80) {
          swipeChatRef.current.active = false;
          setShowChat(true);
        }
      }}
      onTouchEnd={() => { swipeChatRef.current.active = false; }}
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-30 border-b border-gray-100" style={{ background: "var(--bg)" }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/home" className="text-warm-gray hover:text-charcoal mr-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="font-semibold text-charcoal text-base leading-tight">
                {session.title || "Homeroom"}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-block w-2 h-2 rounded-full bg-clay animate-pulse" />
                <span className="text-xs text-warm-gray">
                  {session.isPublic ? "Public" : "Friends only"} · {duration > 0 ? formatDuration(duration) : "No time set"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmLeave(true)}
              className="text-xs font-medium text-warm-gray border border-gray-200 rounded-lg px-3 py-1.5 hover:border-clay hover:text-clay transition-colors"
            >
              Leave
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">

        {/* Group accomplishments */}
        <div className="mt-4 flex justify-center">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold select-none"
            style={groupDone > 0
              ? { background: "var(--purple-bg)", color: "var(--purple-dark)", border: "1.5px solid var(--purple-border)" }
              : { background: "var(--border)", color: "var(--text-3)", border: "1.5px solid var(--border-2)" }}
          >
            <span>{groupDone > 0 ? "🔥" : "🎯"}</span>
            <span>{groupDone} task{groupDone !== 1 ? "s" : ""} done together</span>
          </div>
        </div>

        {/* My card */}
        <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-sage flex items-center justify-center text-white font-semibold text-sm overflow-hidden">
                {myAvatar ? <span className="text-xl leading-none">{myAvatar}</span> : <span>?</span>}
              </div>
              <div>
                <span className="font-semibold text-sm text-charcoal">{myUsername}</span>
                <span className="ml-1.5 text-xs text-warm-gray">{formatDuration(elapsedMin)} / {formatDuration(duration)}</span>
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

          <div className="bg-gray-100 rounded-full h-1.5 mb-3" title={duration > 0 ? `${formatDuration(remainingMin)} remaining` : undefined}>
            <div className="h-1.5 rounded-full bg-sage transition-all duration-1000" style={{ width: `${progressPct}%` }} />
          </div>

          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setShowTodos((v) => !v)}
              className="inline-flex items-center w-9 h-5 rounded-full p-0.5 transition-colors duration-200 flex-shrink-0"
              style={{ background: showTodos ? "var(--purple)" : "var(--border-3)" }}
            >
              <span
                className="w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"
                style={{ transform: showTodos ? "translateX(16px)" : "translateX(0px)" }}
              />
            </button>
            <span className="text-xs text-warm-gray">Share tasks with room</span>
          </div>

          <div className="">
            <div className="">
              {tasks.length === 0 ? (
                <div className="text-sm text-warm-gray text-center py-4">No tasks added yet.</div>
              ) : (
                <div className="space-y-2 mb-3">
                  {(tasksCollapsed
                    ? [undoneSorted.find(t => t.startedAt !== null) ?? undoneSorted[0]].filter(Boolean)
                    : tasksExpanded ? undoneSorted : undoneSorted.slice(0, TASK_VISIBLE_LIMIT)
                  ).map((t) => {
                    const elapsed = getElapsed(t);
                    const running = t.startedAt !== null;
                    return (
                      <div
                        key={t.id}
                        data-task-id={t.id}
                        draggable={!t.done}
                        onDragStart={() => setDraggingId(t.id)}
                        onDragOver={(e) => { e.preventDefault(); setDragOverId(t.id); }}
                        onDrop={() => { if (draggingId) moveTask(draggingId, t.id); setDraggingId(null); setDragOverId(null); }}
                        onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                        className="flex items-center gap-2 px-1 py-0.5 rounded-lg transition-colors"
                        style={{
                          opacity: draggingId === t.id ? 0.4 : 1,
                          background: dragOverId === t.id && draggingId !== t.id ? "var(--purple-bg-2)" : "transparent",
                          cursor: t.done ? "default" : "grab",
                        }}
                      >
                        {!t.done && (
                          <span
                            className="flex-shrink-0 text-warm-gray opacity-40 hover:opacity-80 cursor-grab"
                            style={{ lineHeight: 1, touchAction: "none" }}
                            onTouchStart={(e) => onHandleTouchStart(e, t.id)}
                            onTouchMove={onHandleTouchMove}
                            onTouchEnd={onHandleTouchEnd}
                          >
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
                            ? { background: "var(--purple)", border: "2px solid var(--purple)" }
                            : { border: "2px solid var(--border-3)" }}
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
                            className={`text-sm flex-1 break-words min-w-0 ${t.done ? "line-through text-warm-gray" : "text-charcoal"}`}
                            onDoubleClick={() => { if (!t.done) { setEditingTaskId(t.id); setEditingTaskText(t.text); } }}
                          >
                            {t.text}
                          </span>
                        )}
                        {t.done ? (
                          <span className="text-xs text-warm-gray flex-shrink-0">{formatTime(elapsed)}</span>
                        ) : taskMenuId === t.id ? (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => { removeTaskFromRoom(t.id); setTaskMenuId(null); }}
                              className="text-xs font-medium px-2 py-1 rounded-lg transition-colors flex-shrink-0"
                              style={{ background: "var(--border)", color: "var(--text-2)" }}
                            >
                              Remove
                            </button>
                            <button
                              onClick={() => { deleteTask(t.id); setTaskMenuId(null); }}
                              className="text-xs font-medium px-2 py-1 rounded-lg transition-colors flex-shrink-0"
                              style={{ background: "#FEE2E2", color: "#EF4444" }}
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setTaskMenuId(null)}
                              className="text-warm-gray p-1 flex-shrink-0"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-xs font-mono w-10 text-right" style={{ color: running ? "var(--purple)" : "#A8A29E" }}>
                              {elapsed > 0 || running ? formatTime(elapsed) : ""}
                            </span>
                            <button
                              onClick={() => running ? stopTimer(t.id) : startTimer(t.id)}
                              className="flex items-center justify-center w-6 h-6 rounded-full transition-colors flex-shrink-0"
                              style={running ? { background: "var(--purple)" } : { background: "var(--border)" }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={running ? "white" : "#78716C"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setTaskMenuId(t.id)}
                              className="flex items-center justify-center w-5 h-5 rounded flex-shrink-0 transition-colors"
                              style={{ color: "var(--text-3)" }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!tasksCollapsed && undoneSorted.length > TASK_VISIBLE_LIMIT && (
                <button
                  onClick={() => setTasksExpanded(v => !v)}
                  className="text-xs font-medium mb-2"
                  style={{ color: "var(--purple)" }}
                >
                  {tasksExpanded ? "Show less" : `+ ${undoneSorted.length - TASK_VISIBLE_LIMIT} more task${undoneSorted.length - TASK_VISIBLE_LIMIT !== 1 ? "s" : ""}`}
                </button>
              )}

              {tasksCollapsed && undoneSorted.length > 1 && (
                <button
                  onClick={() => setTasksCollapsed(false)}
                  className="text-xs text-warm-gray mt-1 mb-2"
                  style={{ color: "var(--purple)" }}
                >
                  + {undoneSorted.length - 1} more task{undoneSorted.length - 1 !== 1 ? "s" : ""}
                </button>
              )}

              {doneSorted.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={toggleDoneCollapsed}
                    className="w-full flex items-center justify-between py-1 mb-1"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
                      Done · {doneSorted.length}
                    </span>
                    <svg
                      width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ color: "var(--text-2)", transform: doneCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {!doneCollapsed && (
                    <div className="space-y-1">
                      {doneSorted.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 px-1 py-0.5 rounded-lg opacity-60">
                          <span className="w-2.5 flex-shrink-0" />
                          <button
                            onClick={() => toggleTask(t.id)}
                            className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                            style={{ background: "var(--purple)", border: "2px solid var(--purple)" }}
                          >
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <span className="text-sm line-through flex-1 break-words min-w-0" style={{ color: "var(--text-2)" }}>{t.text}</span>
                          <span className="text-xs flex-shrink-0" style={{ color: "var(--text-3)" }}>{t.timeSpent > 0 ? formatTime(t.timeSpent) : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
                <button onClick={addTask} style={{ color: "var(--purple)" }} className="hover:opacity-70 transition-opacity">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
                  </svg>
                </button>
              </div>}

              {!tasksCollapsed && (
                <button
                  onClick={async () => {
                    if (!myUserId) return;
                    const supabase = createClient();
                    const { data } = await supabase
                      .from("tasks")
                      .select("id, text")
                      .eq("user_id", myUserId)
                      .eq("done", false)
                      .order("sort_order", { ascending: true });
                    setMyListTasks((data ?? []).map(t => ({ id: t.id, text: t.text, done: false })));
                    setShowListPicker(true);
                    setListPickerSearch("");
                  }}
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
          </div>
        </div>


        {/* Invite button — only shown when solo (invite lives in "In this room" header otherwise) */}
        {friendsWithIds.length > 0 && dbParticipants.filter(p => p.username !== (myUsernameRef.current || myUsername)).length === 0 && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => { setShowInviteModal(true); setInviteSearch(""); }}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border transition-colors"
              style={{ color: "var(--purple)", borderColor: "var(--purple-border)", background: "var(--purple-bg)" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Invite a friend
            </button>
          </div>
        )}

        {/* Activity feed */}
        <div className="mt-4 mb-4">
          <button onClick={toggleActivityCollapsed} className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-charcoal">Activity</h2>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: "var(--text-2)", transform: activityCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {!activityCollapsed && (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {chatMessages.filter((m) => m.type === "activity" || m.type === "highfive").length === 0 ? (
                <p className="text-sm text-warm-gray italic text-center py-6">No activity yet. Complete a task to get things going.</p>
              ) : [...chatMessages].filter((m) => m.type === "activity" || m.type === "highfive").reverse().map((msg) => {
                const isHighfive = msg.type === "highfive";
                return (
                  <div
                    key={msg.id}
                    className="rounded-2xl px-4 py-3 border"
                    style={{ borderColor: "var(--border-2)", background: "var(--surface)" }}
                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                    onMouseLeave={() => setHoveredMsgId(null)}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm mt-0.5"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--border-2)" }}
                      >
                        {isHighfive ? "✋" : "✅"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs text-warm-gray leading-snug">
                            {isHighfive ? (
                              <><span className="font-semibold text-charcoal">{msg.sender}</span> high-fived <span className="font-semibold text-charcoal">{msg.text}</span></>
                            ) : (
                              <><span className="font-semibold text-charcoal">{msg.sender}</span> finished a task</>
                            )}
                          </p>
                          <span className="text-xs text-warm-gray flex-shrink-0">{formatRelativeTime(msg.time)}</span>
                        </div>
                        {!isHighfive && showTodos && (
                          <p className="text-sm font-semibold text-charcoal mt-1 leading-snug">{msg.text}</p>
                        )}
                        {msg.reactions.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-2">
                            {msg.reactions.map((emoji) => (
                              <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)} className="text-sm bg-white border border-gray-200 rounded-full px-1.5 py-0.5 hover:bg-gray-50 transition-colors shadow-sm">{emoji}</button>
                            ))}
                          </div>
                        )}
                        {hoveredMsgId === msg.id && (
                          <div className="flex gap-1 mt-2">
                            {REACTION_EMOJIS.map((emoji) => {
                              const reacted = msg.reactions.includes(emoji);
                              return <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)} className="text-base transition-transform hover:scale-125" style={{ opacity: reacted ? 1 : 0.4 }}>{emoji}</button>;
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Participants */}
        {(() => {
          const presentSet = new Set(presentUsers.map(p => p.username));
          const me = myUsernameRef.current || myUsername;
          const others = dbParticipants.filter(p => p.username !== me);
          const filteredOthers = activeFilters.size === 0 ? others : others.filter((p) => {
            for (const f of activeFilters) {
              if (f === "friends" && myFriendUsernames.has(p.username)) return true;
              if (f !== "friends" && squadMemberMap[f]?.has(p.username)) return true;
            }
            return false;
          });
          const visibleOthers = participantsExpanded ? filteredOthers : filteredOthers.slice(0, PARTICIPANTS_VISIBLE);
          const hiddenCount = filteredOthers.length - PARTICIPANTS_VISIBLE;
          if (others.length === 0) return null;
          return (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-3">
                <button onClick={toggleParticipantsCollapsed} className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-charcoal">In this room</h2>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ color: "var(--text-2)", transform: participantsCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-warm-gray">{others.length} {others.length === 1 ? "other" : "others"}</span>
                  {friendsWithIds.length > 0 && (
                    <button
                      onClick={() => { setShowInviteModal(true); setInviteSearch(""); }}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors"
                      style={{ color: "var(--purple)", borderColor: "var(--purple-border)" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
                        <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
                      </svg>
                      Invite
                    </button>
                  )}
                </div>
              </div>

              {!participantsCollapsed && others.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    onClick={() => toggleFilter("friends")}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                    style={activeFilters.has("friends") ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" } : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
                  >
                    👤 Friends
                  </button>
                  {mySquads.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggleFilter(s.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                      style={activeFilters.has(s.id) ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" } : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
                    >
                      {s.emoji} {s.name}
                    </button>
                  ))}
                </div>
              )}

              {!participantsCollapsed && (others.length === 0 ? (
                <div className="text-center py-6 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">No one else here yet.</div>
              ) : filteredOthers.length === 0 ? (
                <div className="text-center py-5 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">No one here matches this filter.</div>
              ) : (
                <>
                  <div className="space-y-2">
                    {visibleOthers.map((p) => {
                      const pData = participantData[p.username];
                      const isExpanded = expandedCards.has(p.username);
                      const doneCount = pData?.tasks.filter((t) => t.done).length ?? 0;
                      const totalCount = pData?.tasks.length ?? 0;
                      const isPresent = presentSet.has(p.username);
                      return (
                        <div key={p.username} className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
                          <div className="flex items-center gap-3">
                            {/* Avatar with presence dot */}
                            <div className="relative flex-shrink-0">
                              <div className="w-9 h-9 rounded-full flex items-center justify-center text-base" style={{ background: p.avatar ? "var(--border)" : colorFromUsername(p.username) }}>
                                {p.avatar || <span className="text-white text-xs font-bold">{p.username.slice(0, 2).toUpperCase()}</span>}
                              </div>
                              {isPresent && (
                                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2" style={{ background: "#22C55E", borderColor: "var(--surface)" }} />
                              )}
                              {receivedHighfivesFrom.has(p.username) && (
                                <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center text-xs border-2" style={{ background: "var(--yellow-bg)", borderColor: "var(--surface)", fontSize: "10px" }}>✋</span>
                              )}
                            </div>
                            {/* Name + task count */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-charcoal break-words">{p.username}</p>
                              <p className="text-xs text-warm-gray">{pData ? `${doneCount}/${totalCount} tasks` : "joining…"}</p>
                            </div>
                            {/* High five + expand */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); if (!highfivedUsers.has(p.username)) sendHighFive(p.username); }}
                                disabled={highfivedUsers.has(p.username)}
                                className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors"
                                style={highfivedUsers.has(p.username)
                                  ? { background: "var(--border)", color: "var(--text-3)", cursor: "default" }
                                  : { background: "var(--purple-bg-2)", color: "var(--purple)" }}
                              >
                                {highfivedUsers.has(p.username) ? "✋ Sent!" : "✋"}
                              </button>
                              <button onClick={() => toggleCard(p.username)} className="text-warm-gray p-0.5 transition-transform duration-200" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                              </button>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              {pData?.sharing ? (
                                pData.tasks.length === 0 ? (
                                  <p className="text-xs text-warm-gray italic">No tasks</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {[...pData.tasks].sort((a, b) => Number(a.done) - Number(b.done)).map((t) => (
                                      <div key={t.id} className="flex items-start gap-2">
                                        <div className="w-3 h-3 rounded flex-shrink-0 flex items-center justify-center mt-0.5" style={t.done ? { background: "var(--purple)", border: "2px solid var(--purple)" } : { border: "2px solid var(--border-3)" }}>
                                          {t.done && <svg width="5" height="5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                                        </div>
                                        <span className={`text-xs leading-snug ${t.done ? "line-through text-warm-gray" : "text-charcoal"}`}>{t.text}</span>
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
                    <button onClick={() => setParticipantsExpanded(true)} className="mt-2 text-xs font-medium" style={{ color: "var(--purple)" }}>
                      + {hiddenCount} more {hiddenCount === 1 ? "person" : "people"}
                    </button>
                  )}
                  {participantsExpanded && filteredOthers.length > PARTICIPANTS_VISIBLE && (
                    <button onClick={() => setParticipantsExpanded(false)} className="mt-2 text-xs font-medium" style={{ color: "var(--purple)" }}>Show less</button>
                  )}
                </>
              ))}
            </div>
          );
        })()}

        {/* Invited but not yet joined */}
        {(() => {
          const presentSet = new Set([
            ...presentUsers.map(p => p.username),
            ...Object.keys(participantData),
          ]);
          const pending = (session.invitedFriends ?? []).filter(f => !presentSet.has(f.name));
          if (pending.length === 0) return null;
          return (
            <div className="mt-5">
              <button onClick={toggleInvitedCollapsed} className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-semibold text-charcoal">Invited · waiting to join</h2>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ color: "var(--text-2)", transform: invitedCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {!invitedCollapsed && <div className="flex flex-wrap gap-2">
                {pending.map((f) => (
                  <div key={f.id} className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-full pl-2 pr-1 py-1">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: f.color }}>{f.initials}</div>
                    <span className="text-xs text-warm-gray">{f.name}</span>
                    <button
                      onClick={() => resendInvite(f.id, f.name)}
                      className="text-xs px-2 py-0.5 rounded-full ml-0.5"
                      style={{ background: "var(--border)", color: "var(--text-3)" }}
                    >
                      {resentIds.has(f.id) ? "Sent!" : "Resend"}
                    </button>
                  </div>
                ))}
              </div>}
            </div>
          );
        })()}
      </div>

      {/* Chat FAB */}
      {session && !session.isPublic && (
        <button
          onClick={() => setShowChat(true)}
          className="fixed z-30 flex items-center gap-2 rounded-full shadow-xl transition-transform active:scale-95"
          style={{ bottom: "96px", right: "16px", background: "var(--purple)", color: "white", padding: "12px 20px" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span className="text-sm font-semibold">Chat</span>
          {chatUnread > 0 && (
            <span className="w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ background: "var(--red)", fontSize: "10px", marginLeft: "-2px" }}>
              {chatUnread > 9 ? "9+" : chatUnread}
            </span>
          )}
        </button>
      )}

      {/* Chat drawer (private rooms only) */}
      {session && !session.isPublic && (
        <>
          <div
            className="fixed inset-0 z-40 transition-opacity duration-300"
            style={{ background: "rgba(0,0,0,0.3)", opacity: showChat ? 1 : 0, pointerEvents: showChat ? "auto" : "none" }}
            onClick={() => setShowChat(false)}
          />
          <div
            className="fixed z-50 bg-white flex flex-col shadow-2xl transition-transform duration-300 ease-in-out rounded-l-3xl w-full md:w-96"
            style={{ top: "10%", bottom: "10%", right: 0, transform: showChat ? "translateX(0)" : "translateX(100%)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <h2 className="font-semibold text-charcoal">Chat</h2>
              <button onClick={() => setShowChat(false)} className="text-warm-gray hover:text-charcoal p-1 transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col-reverse gap-3">
              {chatMessages.filter((m) => m.type === "chat").length === 0 ? (
                <p className="text-sm text-warm-gray italic text-center py-4">No messages yet. Say hi!</p>
              ) : [...chatMessages].filter((m) => m.type === "chat").reverse().map((msg) => {
                const isMe = msg.sender === myUsername;
                const av = isMe ? myAvatar : (dbParticipants.find((p) => p.username === msg.sender)?.avatar ?? "");
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                    onMouseLeave={() => setHoveredMsgId(null)}
                  >
                    <div className={`flex items-end gap-1.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {av ? <span className="text-sm leading-none">{av}</span> : <span className="text-xs font-bold text-gray-500">{msg.sender.slice(0, 1).toUpperCase()}</span>}
                      </div>
                      <div className="max-w-[75%] px-3 py-2 rounded-2xl text-sm" style={isMe ? { background: "var(--purple)", color: "white" } : { background: "var(--border)", color: "var(--text)" }}>
                        {msg.text}
                      </div>
                    </div>
                    {hoveredMsgId === msg.id && (
                      <div className={`flex gap-1 bg-white border border-gray-100 rounded-full px-2 py-1 shadow-sm mt-1 ${isMe ? "self-end" : "self-start"}`}>
                        {REACTION_EMOJIS.map((emoji) => {
                          const reacted = msg.reactions.includes(emoji);
                          return <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)} className="text-base transition-transform hover:scale-125" style={{ opacity: reacted ? 1 : 0.5 }}>{emoji}</button>;
                        })}
                      </div>
                    )}
                    {msg.reactions.length > 0 && (
                      <div className={`flex gap-1 flex-wrap mt-1 ${isMe ? "justify-end" : "justify-start"}`}>
                        {msg.reactions.map((emoji) => (
                          <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)} className="text-sm bg-gray-50 border border-gray-100 rounded-full px-1.5 py-0.5 hover:bg-gray-100 transition-colors">{emoji}</button>
                        ))}
                      </div>
                    )}
                    <span className="text-xs text-warm-gray mt-0.5 px-1">
                      {!isMe && <span className="font-medium mr-1">{msg.sender}</span>}
                      {msg.time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-gray-100 px-3 py-2 flex items-center gap-2 flex-shrink-0" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChatMessage(); }}
                placeholder="Message the room…"
                className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
              />
              <button onClick={sendChatMessage} style={{ color: "var(--purple)" }} className="hover:opacity-70 transition-opacity flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add from list modal */}
      {showListPicker && (() => {
        const sessionTaskTexts = new Set(tasks.map((t) => t.text.toLowerCase()));
        const available = myListTasks.filter((t) =>
          !sessionTaskTexts.has(t.text.toLowerCase()) &&
          (!listPickerSearch || t.text.toLowerCase().includes(listPickerSearch.toLowerCase()))
        );
        const allVisibleSelected = available.length > 0 && available.every((t) => selectedListIds.includes(t.id));

        async function addSelected() {
          if (!session?.homeroomId) return;
          const toAdd = myListTasks.filter((t) => selectedListIds.includes(t.id));
          if (toAdd.length > 0) {
            const supabase = createClient();
            await supabase.from("tasks").update({ homeroom_id: session.homeroomId }).in("id", toAdd.map(t => t.id));
            setTasks((prev) => [
              ...prev,
              ...toAdd.map((t) => ({ id: t.id, text: t.text, done: false, timeSpent: 0, startedAt: null, completedAt: null })),
            ]);
            setMyListTasks(prev => prev.filter(t => !selectedListIds.includes(t.id)));
          }
          setShowListPicker(false);
          setSelectedListIds([]);
        }

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
            <div className="bg-white rounded-3xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl">
              <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
                <h2 className="font-bold text-charcoal text-base">Add from your list</h2>
                <button onClick={() => { setShowListPicker(false); setSelectedListIds([]); }} className="text-warm-gray hover:text-charcoal p-1">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="px-5 pb-2 flex-shrink-0">
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input autoFocus type="text" value={listPickerSearch} onChange={(e) => setListPickerSearch(e.target.value)} placeholder="Search tasks…" className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none" />
                </div>
              </div>
              {available.length > 0 && (
                <div className="px-5 pb-2 flex-shrink-0">
                  <button onClick={() => setSelectedListIds(allVisibleSelected ? [] : available.map((t) => t.id))} className="text-xs font-semibold text-warm-gray hover:text-charcoal transition-colors">
                    {allVisibleSelected ? "Deselect all" : "Select all"}
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-1">
                {myListTasks.length === 0 ? (
                  <p className="text-sm text-warm-gray text-center py-6">Your list is empty.</p>
                ) : available.length === 0 ? (
                  <p className="text-sm text-warm-gray text-center py-6">{listPickerSearch ? "No matches." : "All tasks are already in this session."}</p>
                ) : available.map((t) => {
                  const checked = selectedListIds.includes(t.id);
                  return (
                    <button key={t.id} onClick={() => setSelectedListIds(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-gray-50" style={checked ? { background: "var(--purple-bg-2)" } : {}}>
                      <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center" style={checked ? { background: "var(--purple)", border: "2px solid var(--purple)" } : { border: "2px solid var(--border-3)" }}>
                        {checked && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                      </div>
                      <span className="text-sm text-charcoal flex-1 truncate">{t.text}</span>
                    </button>
                  );
                })}
              </div>
              <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
                <button onClick={addSelected} disabled={selectedListIds.length === 0} className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity" style={{ background: "var(--purple)", color: "white", opacity: selectedListIds.length > 0 ? 1 : 0.4 }}>
                  {selectedListIds.length === 0 ? "Select tasks to add" : `Add ${selectedListIds.length} task${selectedListIds.length !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Leave confirmation */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full shadow-xl">
            <p className="text-sm font-semibold text-charcoal mb-1">Leave this room?</p>
            <p className="text-sm text-warm-gray mb-4">Are you sure you want to leave your current homeroom?</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmLeave(false); leaveRoom(); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
                style={{ background: "var(--red)" }}
              >
                Yes, leave
              </button>
              <button
                onClick={() => setConfirmLeave(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-charcoal hover:bg-gray-50 transition-colors"
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave summary modal */}
      {showSummary && (() => {
        const done = tasks.filter((t) => t.done);
        const remaining = tasks.filter((t) => !t.done);
        const timedDone = done.filter((t) => t.timeSpent > 0);
        const elapsedDisplay = elapsedMin < 1 ? "less than a minute" : elapsedMin === 1 ? "1 minute" : `${elapsedMin} minutes`;

        async function goHome() {
          const supabase = createClient();
          // Save final time_spent for running timers
          const finalTasks = tasks.map(t => t.startedAt !== null ? { ...t, timeSpent: getElapsed(t), startedAt: null } : t);
          const tasksWithTime = finalTasks.filter(t => t.timeSpent > 0 && !t.done);
          if (tasksWithTime.length > 0) {
            await Promise.all(tasksWithTime.map(t =>
              supabase.from("tasks").update({ time_spent: t.timeSpent }).eq("id", t.id)
            ));
          }
          localStorage.removeItem("homeroom-active-id");
          window.location.href = "/home";
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
            <div className="relative bg-white w-full max-w-sm rounded-3xl shadow-xl p-6 flex flex-col gap-5">
              <div className="text-center">
                <div className="text-4xl mb-3">{done.length === tasks.length && tasks.length > 0 ? "🎉" : "🏠"}</div>
                <h2 className="text-xl font-bold text-charcoal">Session wrapped</h2>
                <p className="text-sm text-warm-gray mt-1">You were in here for {elapsedDisplay}</p>
              </div>
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
              {timedDone.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Tasks you beat the time on</p>
                  <div className="space-y-1.5">
                    {timedDone.map((t) => (
                      <div key={t.id} className="flex items-center justify-between rounded-xl bg-purple-50 px-3 py-2">
                        <span className="text-sm text-charcoal truncate flex-1 mr-3">{t.text}</span>
                        <span className="text-xs font-semibold flex-shrink-0" style={{ color: "var(--purple)" }}>{formatTime(t.timeSpent)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                {remaining.length > 0 && (
                  <button onClick={() => scheduleRemaining(remaining)} className="w-full font-semibold text-sm py-3 rounded-xl text-white" style={{ background: "var(--purple)" }}>
                    Schedule a homeroom to finish ({remaining.length} task{remaining.length !== 1 ? "s" : ""})
                  </button>
                )}
                <button onClick={goHome} className="w-full font-semibold text-sm py-3 rounded-xl border border-gray-200 text-charcoal hover:bg-gray-50 transition-colors">
                  Back to home
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Invite friends modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop — sibling to content, no propagation tricks needed */}
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setShowInviteModal(false)} />
          <div className="absolute inset-x-0 bottom-0 sm:inset-0 flex sm:items-center sm:justify-center sm:p-4 pointer-events-none">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[80vh] flex flex-col shadow-xl pointer-events-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
              <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
                <h2 className="font-bold text-charcoal text-base">Invite friends</h2>
                <button onClick={() => setShowInviteModal(false)} className="text-warm-gray hover:text-charcoal p-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="px-5 pb-3 flex-shrink-0">
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    value={inviteSearch}
                    onChange={e => setInviteSearch(e.target.value)}
                    placeholder="Search friends…"
                    className="flex-1 bg-transparent text-sm text-charcoal placeholder:text-warm-gray focus:outline-none"
                  />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 px-5 pb-5 space-y-1">
                {(() => {
                  const presentSet = new Set(presentUsers.map(p => p.username));
                  const me = myUsernameRef.current || myUsername;
                  const alreadyInvited = new Set((session?.invitedFriends ?? []).map(f => f.name));

                  // Previously in this room but no longer present
                  const prevParticipants = dbParticipants.filter(p =>
                    p.username !== me && p.userId && !presentSet.has(p.username) &&
                    (!inviteSearch || p.username.toLowerCase().includes(inviteSearch.toLowerCase()))
                  );

                  const available = friendsWithIds.filter(f =>
                    !presentSet.has(f.username) &&
                    !prevParticipants.some(p => p.username === f.username) &&
                    (!inviteSearch || f.username.toLowerCase().includes(inviteSearch.toLowerCase()))
                  );

                  if (prevParticipants.length === 0 && available.length === 0) return (
                    <p className="text-sm text-warm-gray text-center py-6">
                      {inviteSearch ? "No matches." : "All friends are already in the room."}
                    </p>
                  );
                  return (
                    <>
                      {prevParticipants.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide pt-1 pb-0.5">Previously here</p>
                          {prevParticipants.map(p => {
                            const sent = invitedInSession.has(p.userId) || alreadyInvited.has(p.username);
                            return (
                              <div key={p.userId} className="flex items-center justify-between py-2.5">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0" style={{ background: p.avatar ? "var(--border)" : colorFromUsername(p.username) }}>
                                    {p.avatar || <span className="text-white text-xs font-bold">{p.username.slice(0, 2).toUpperCase()}</span>}
                                  </div>
                                  <span className="text-sm font-medium text-charcoal">{p.username}</span>
                                </div>
                                <button
                                  onClick={() => sent ? resendInvite(p.userId, p.username) : sendInvite({ username: p.username, userId: p.userId })}
                                  className="text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                                  style={sent ? { background: "var(--border)", color: "var(--text-3)" } : { background: "var(--purple)", color: "white" }}
                                >{resentIds.has(p.userId) ? "Sent!" : sent ? "Resend" : "Invite back"}</button>
                              </div>
                            );
                          })}
                          {available.length > 0 && <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide pt-2 pb-0.5">Friends</p>}
                        </>
                      )}
                  {available.map(f => {
                    const sent = invitedInSession.has(f.userId) || alreadyInvited.has(f.username);
                    return (
                      <div key={f.userId} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: f.color }}>
                            {f.initials}
                          </div>
                          <span className="text-sm font-medium text-charcoal">{f.username}</span>
                        </div>
                        <button
                          onClick={() => sent ? resendInvite(f.userId, f.username) : sendInvite(f)}
                          className="text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                          style={sent
                            ? { background: "var(--border)", color: "var(--text-3)" }
                            : { background: "var(--purple)", color: "white" }}
                        >
                          {resentIds.has(f.userId) ? "Sent!" : sent ? "Resend" : "Invite"}
                        </button>
                      </div>
                    );
                  })}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
