"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

type Task = {
  id: string;
  text: string;
  done: boolean;
  timeSpent: number;
  startedAt: number | null;
};
type Friend = { id: string; name: string; initials: string; color: string };
type Session = {
  title: string;
  duration: number;
  isPublic: boolean;
  tasks: { id: string; text: string }[];
  invitedFriends: Friend[];
  scheduledFor: string | null;
};
type FeedItem = { id: string; text: string; time: Date };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function RoomPage() {
  const [myUsername, setMyUsername] = useState("You");
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
  const [myListTasks, setMyListTasks]             = useState<{ id: string; text: string; done: boolean; scheduledForSessionId?: string; scheduledForDate?: string; scheduledForTitle?: string }[]>([]);
  const [selectedListIds, setSelectedListIds]     = useState<string[]>([]);

  const REACTION_EMOJIS = ["🎉", "🙌", "🔥", "💪", "👏", "✨", "🚀", "🎯"];

  function toggleReaction(msgId: string, emoji: string) {
    setChatMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m;
      const has = m.reactions.includes(emoji);
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
    const u = localStorage.getItem("homeroom-username");
    if (u) setMyUsername(u);
    try {
      const stored = localStorage.getItem("homeroom-session");
      if (stored) {
        const s: Session = JSON.parse(stored);
        setSession(s);
        setTasks(s.tasks.map((t) => ({ ...t, done: false, timeSpent: 0, startedAt: null })));
      }
      const listStored = localStorage.getItem("homeroom-tasks");
      if (listStored) setMyListTasks(JSON.parse(listStored));
    } catch { /* ignore */ }
  }, []);

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
      setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), type: "activity" as const, text: task.text, sender: myUsername, time: new Date(), reactions: [] }]);
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
    } else {
      pushFeed(`↩ Reopened "${task.text}"`);
    }
    setTasks((prev) => prev.map((t) =>
      t.id === id ? { ...t, done: !t.done, timeSpent, startedAt: null } : t
    ));
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

  const sessionStartRef = useRef<number | null>(null);

  const [showTodos, setShowTodos] = useState(true);
  const doneTasks = tasks.filter((t) => t.done).length;
  const duration = session?.duration ?? 0;

  if (sessionStartRef.current === null && session !== null) {
    sessionStartRef.current = Date.now();
  }

  const elapsedSec = tick >= 0 && sessionStartRef.current !== null
    ? Math.floor((Date.now() - sessionStartRef.current) / 1000)
    : 0;
  const elapsedMin = Math.floor(elapsedSec / 60);
  const remainingSec = duration > 0 ? Math.max(0, duration * 60 - elapsedSec) : 0;
  const remainingMin = Math.floor(remainingSec / 60);
  const remainingSs  = remainingSec % 60;
  const progressPct  = duration > 0 ? Math.min(100, (elapsedSec / (duration * 60)) * 100) : 0;

  function formatScheduled(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
          <button className="text-xs font-medium text-warm-gray border border-gray-200 rounded-lg px-3 py-1.5 hover:border-clay hover:text-clay transition-colors">
            Leave
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* My card */}
        <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-sage flex items-center justify-center text-white font-semibold text-sm">?</div>
              <div>
                <span className="font-semibold text-sm text-charcoal">You</span>
                <span className="ml-1.5 text-xs text-warm-gray">{elapsedMin} / {duration} min</span>
              </div>
            </div>
              <span className="text-xs text-warm-gray">{doneTasks}/{tasks.length} tasks</span>
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

          <div className="relative pr-40">
            {/* Left: tasks — sets the container height */}
            <div className="">
              {tasks.length === 0 ? (
                <div className="text-sm text-warm-gray text-center py-4">No tasks added yet.</div>
              ) : (
                <div className="space-y-2 mb-3">
                  {tasks.map((t) => {
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

              <div className="flex items-center gap-2 mt-2">
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
              </div>

              {/* Add from list */}
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
            </div>

            {/* Right: personal feed — absolutely fills the height of the left column */}
            <div className="absolute top-0 right-0 bottom-0 w-36 border-l border-gray-100 pl-3 flex flex-col">
              <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2 flex-shrink-0">Your feed</p>
              <div className="flex-1 overflow-y-auto space-y-2">
                {feed.length === 0 ? (
                  <p className="text-xs text-warm-gray italic">No activity yet.</p>
                ) : feed.map((item) => (
                  <div key={item.id}>
                    <p className="text-xs text-charcoal leading-snug">{item.text}</p>
                    <p className="text-xs text-warm-gray">
                      {item.time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Invited friends */}
        {session?.invitedFriends && session.invitedFriends.length > 0 && (
          <div className="mt-5 mb-3">
            <h2 className="text-sm font-semibold text-charcoal mb-2">Invited</h2>
            <div className="flex flex-wrap gap-2">
              {session.invitedFriends.map((f) => (
                <div key={f.id} className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-full px-2.5 py-1">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                    style={{ background: f.color }}
                  >
                    {f.initials}
                  </div>
                  <span className="text-xs text-charcoal">{f.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
                      const label = showTodos
                        ? `You finished "${msg.text}"`
                        : "You completed a task";
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
                      setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), type: "chat" as const, text, sender: myUsername, time: new Date(), reactions: [] }]);
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
                    setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), type: "chat" as const, text, sender: myUsername, time: new Date(), reactions: [] }]);
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
            <div className="text-sm text-warm-gray italic">Activity feed coming soon for public rooms.</div>
          )}
        </div>

        {/* Participants */}
        <div className="flex items-center justify-between mt-5 mb-3">
          <h2 className="text-sm font-semibold text-charcoal">In this room</h2>
          <span className="text-xs text-warm-gray">0 others</span>
        </div>
        <div className="text-center py-8 text-warm-gray text-sm">
          No one else here yet.
        </div>
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
    </div>
  );
}
