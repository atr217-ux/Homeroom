"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const INITIAL_LIMIT = 15;
const EXPANDED_LIMIT = 25;

type Task = {
  id: string;
  text: string;
  done: boolean;
  addedAt: string;
  completedAt?: string | null;
  lastSessionTime?: number;
  scheduledForTitle?: string;
  scheduledForDate?: string | null;
  homeroomId?: string | null;
  homeroomStatus?: string | null;
  tagIds: string[];
};

type TaskHistory = { text: string; lastSessionTime: number };

type Tag = { id: string; name: string };

const TAG_COLORS = ["#7C3AED","#0891B2","#059669","#D97706","#DC2626","#DB2777","#65A30D","#0284C7"];
function tagColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const c = TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
  return { bg: c + "22", fg: c };
}

function completedLabel(completedAt: string | null | undefined): string {
  if (!completedAt) return "";
  const completed = new Date(completedAt);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const completedStart = new Date(completed.getFullYear(), completed.getMonth(), completed.getDate());
  const diffDays = Math.round((todayStart.getTime() - completedStart.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

function addedAtLabel(addedAt: string): string {
  const added = new Date(addedAt);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addedStart = new Date(added.getFullYear(), added.getMonth(), added.getDate());
  const diffDays = Math.round((todayStart.getTime() - addedStart.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const getWeekStart = (d: Date) => {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    s.setDate(s.getDate() - s.getDay());
    return s;
  };
  const currentWeekStart = getWeekStart(now);
  const addedWeekStart = getWeekStart(added);
  if (addedWeekStart.getTime() === currentWeekStart.getTime()) return "This week";
  const prevWeekStart = new Date(currentWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  if (addedWeekStart.getTime() === prevWeekStart.getTime()) return "Last week";
  const weeksDiff = Math.round((currentWeekStart.getTime() - addedWeekStart.getTime()) / (7 * 86400000));
  return `${weeksDiff} weeks ago`;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  if (sec === 0) return `${m}m`;
  return `${m}m ${sec}s`;
}

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);

const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);


export default function ListPage() {
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(INITIAL_LIMIT);
  const [sortField, setSortField] = useState<"date" | "time" | "homeroom" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [taskHistory, setTaskHistory] = useState<TaskHistory[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [expandedHomeroomTaskId, setExpandedHomeroomTaskId] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState("");

  const editInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const lastTap = useRef<{ id: string; time: number } | null>(null);

  // ── Swipe-to-delete ──────────────────────────────────────────────────────
  const SWIPE_W = 80;
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => { setIsTouch(window.matchMedia("(pointer: coarse)").matches); }, []);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [liveSwipe, setLiveSwipe] = useState<{ id: string; offset: number } | null>(null);
  const swipeRef = useRef<{ id: string; x: number; y: number; isH: boolean | null } | null>(null);

  function onRowTouchStart(e: React.TouchEvent, id: string, locked?: boolean) {
    if (locked) return;
    if (swipedId && swipedId !== id) setSwipedId(null);
    setLiveSwipe(null);
    const t = e.touches[0];
    swipeRef.current = { id, x: t.clientX, y: t.clientY, isH: null };
  }

  function onRowTouchMove(e: React.TouchEvent) {
    const s = swipeRef.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (s.isH === null) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) s.isH = true;
      else if (Math.abs(dy) > 8) { swipeRef.current = null; return; }
      else return;
    }
    if (!s.isH) return;
    const base = swipedId === s.id ? -SWIPE_W : 0;
    setLiveSwipe({ id: s.id, offset: Math.max(-SWIPE_W, Math.min(0, base + dx)) });
  }

  function onRowTouchEnd(taskId: string, text: string) {
    const s = swipeRef.current;
    if (!s) return;
    const offset = liveSwipe?.id === s.id ? liveSwipe.offset : (swipedId === s.id ? -SWIPE_W : 0);
    const wasH = s.isH === true;
    swipeRef.current = null;
    setLiveSwipe(null);
    if (wasH) {
      if (offset < -SWIPE_W * 0.4) { setSwipedId(s.id); if (navigator.vibrate) navigator.vibrate(10); }
      else setSwipedId(null);
      return;
    }
    if (swipedId === s.id) { setSwipedId(null); return; }
    // double-tap to edit
    const now = Date.now();
    const last = lastTap.current;
    if (last && last.id === taskId && now - last.time < 350) { lastTap.current = null; startEdit(taskId, text); }
    else lastTap.current = { id: taskId, time: now };
  }

  function rowOffset(id: string) {
    if (liveSwipe?.id === id) return liveSwipe.offset;
    if (swipedId === id) return -SWIPE_W;
    return 0;
  }

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setMyUserId(user.id);
      supabase
        .from("tasks")
        .select("id, text, done, time_spent, created_at, completed_at, homeroom_id")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .then(async ({ data: allTasks }) => {
          const homeroomIds = [...new Set((allTasks ?? []).filter(t => t.homeroom_id).map(t => t.homeroom_id as string))];

          // Fetch homerooms, task-tags, and all user tags in parallel — all flat queries, no joins
          const taskIds = (allTasks ?? []).map(t => t.id);
          const [{ data: homeroomsData }, { data: ttRows }, { data: tagsData }] = await Promise.all([
            homeroomIds.length
              ? supabase.from("homerooms").select("id, title, scheduled_for, status").in("id", homeroomIds)
              : Promise.resolve({ data: [] }),
            taskIds.length
              ? supabase.from("task_tags").select("task_id, tag_id").in("task_id", taskIds)
              : Promise.resolve({ data: [] }),
            supabase.from("tags").select("id, name").eq("user_id", user.id),
          ]);

          const hrMap = Object.fromEntries((homeroomsData ?? []).map(h => [h.id, h]));
          const tagById = Object.fromEntries((tagsData ?? []).map(t => [t.id, t]));

          // Build per-task tag index
          const taskTagIds: Record<string, string[]> = {};
          for (const r of (ttRows ?? [])) {
            if (!taskTagIds[r.task_id]) taskTagIds[r.task_id] = [];
            taskTagIds[r.task_id].push(r.tag_id);
          }
          setAllTags(Object.values(tagById));

          // Only clear homeroom_id for completed/deleted rooms.
          // leaveRoom() in the room page already handles the active-but-left case,
          // so checking participant records here creates a race condition that wipes
          // tasks mid-session when a new deployment loads or queries are slow.
          const staleIds = (allTasks ?? [])
            .filter(t => {
              if (!t.homeroom_id || t.done) return false;
              const hr = hrMap[t.homeroom_id];
              if (!hr) return true; // homeroom deleted
              if (hr.status === "completed") return true; // session ended
              return false;
            })
            .map(t => t.id);
          if (staleIds.length > 0) {
            await supabase.from("tasks").update({ homeroom_id: null }).in("id", staleIds);
            staleIds.forEach(id => {
              const t = (allTasks ?? []).find(x => x.id === id);
              if (t) t.homeroom_id = null;
            });
          }

          const mapped = (allTasks ?? []).map(t => {
            const hr = t.homeroom_id ? hrMap[t.homeroom_id] : null;
            return {
              id: t.id,
              text: t.text,
              done: t.done,
              addedAt: t.created_at,
              completedAt: t.completed_at ?? null,
              lastSessionTime: t.time_spent > 0 ? t.time_spent : undefined,
              scheduledForTitle: hr ? hr.title : undefined,
              scheduledForDate: hr?.scheduled_for ?? null,
              homeroomId: t.homeroom_id,
              homeroomStatus: hr?.status ?? null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tagIds: taskTagIds[t.id] ?? [],
            };
          });
          setTasks(mapped);
        });
    });

    try {
      const h = localStorage.getItem("homeroom-task-history");
      if (h) setTaskHistory(JSON.parse(h));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Detect if cursor is at end of a #word — for tag autocomplete
  const hashMatch = input.match(/#(\w*)$/);
  const tagQuery = hashMatch ? hashMatch[1] : null;

  const suggestions: TaskHistory[] = tagQuery === null && input.trim().length > 0
    ? taskHistory.filter((h) =>
        h.text.toLowerCase().includes(input.toLowerCase()) &&
        h.text.toLowerCase() !== input.toLowerCase()
      )
    : [];

  const tagCompletions = tagQuery !== null
    ? allTags.filter(t => t.name.toLowerCase().startsWith(tagQuery.toLowerCase()))
    : [];

  function applyTagCompletion(tagName: string) {
    setInput(prev => prev.replace(/#\w*$/, `#${tagName} `));
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function syncOverlay() {
    if (overlayRef.current && inputRef.current)
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
  }

  async function addTask(text?: string, lastSessionTime?: number) {
    const raw = (text ?? input).trim();
    if (!raw || !myUserId) return;
    const tagNames = (raw.match(/#(\w+)/g) ?? []).map(t => t.slice(1));
    const cleanText = raw.replace(/#\w+/g, "").replace(/\s+/g, " ").trim();
    if (!cleanText) return;
    setInput("");
    setShowSuggestions(false);
    const supabase = createClient();
    const { data } = await supabase.from("tasks").insert({
      user_id: myUserId,
      text: cleanText,
      done: false,
      time_spent: lastSessionTime ?? 0,
      homeroom_id: null,
      sort_order: tasks.length,
    }).select("id, created_at").single();
    if (data) {
      const tagObjs = (await Promise.all(tagNames.map(n => getOrCreateTag(n, supabase, myUserId)))).filter(Boolean) as Tag[];
      if (tagObjs.length > 0) {
        await supabase.from("task_tags").insert(tagObjs.map(t => ({ task_id: data.id, tag_id: t.id })));
      }
      setTasks(prev => [...prev, {
        id: data.id,
        text: cleanText,
        done: false,
        addedAt: data.created_at,
        completedAt: null,
        lastSessionTime,
        tagIds: tagObjs.map(t => t.id),
      }]);
      setAllTags(prev => {
        const map = new Map(prev.map(t => [t.id, t]));
        for (const t of tagObjs) map.set(t.id, t);
        return [...map.values()];
      });
    }
  }

  async function toggleTask(id: string) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const nowDone = !task.done;
    const supabase = createClient();
    await supabase.from("tasks").update({
      done: nowDone,
      completed_at: nowDone ? new Date().toISOString() : null,
    }).eq("id", id);
    setTasks((prev) => prev.map((t) => t.id === id
      ? { ...t, done: nowDone, completedAt: nowDone ? new Date().toISOString() : null }
      : t
    ));
  }

  async function deleteTask(id: string) {
    const supabase = createClient();
    await supabase.from("tasks").delete().eq("id", id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function startEdit(id: string, text: string) {
    setEditingId(id);
    setEditingText(text);
  }

  async function saveEdit() {
    const raw = editingText.trim();
    if (raw && editingId) {
      const tagNames = (raw.match(/#(\w+)/g) ?? []).map(t => t.slice(1));
      const cleanText = tagNames.length > 0
        ? raw.replace(/#\w+/g, "").replace(/\s+/g, " ").trim() || raw
        : raw;
      const supabase = createClient();
      await supabase.from("tasks").update({ text: cleanText }).eq("id", editingId);
      const currentTask = tasks.find(t => t.id === editingId);
      if (tagNames.length > 0) {
        const tagObjs = (await Promise.all(tagNames.map(n => getOrCreateTag(n, supabase, myUserId!)))).filter(Boolean) as Tag[];
        const newTagObjs = tagObjs.filter(t => !currentTask?.tagIds.includes(t.id));
        if (newTagObjs.length > 0) {
          await supabase.from("task_tags").insert(newTagObjs.map(t => ({ task_id: editingId, tag_id: t.id })));
        }
        setTasks(prev => prev.map(t => t.id === editingId
          ? { ...t, text: cleanText, tagIds: [...new Set([...t.tagIds, ...tagObjs.map(x => x.id)])] }
          : t));
        setAllTags(prev => {
          const map = new Map(prev.map(t => [t.id, t]));
          for (const t of tagObjs) map.set(t.id, t);
          return [...map.values()];
        });
      } else {
        setTasks(prev => prev.map(t => t.id === editingId ? { ...t, text: cleanText } : t));
      }
    }
    setEditingId(null);
    setEditingText("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingText("");
  }

  async function getOrCreateTag(name: string, supabase: ReturnType<typeof createClient>, userId: string): Promise<Tag | null> {
    const normalized = name.trim();
    if (!normalized) return null;
    const { data: found, error: selErr } = await supabase
      .from("tags").select("id, name")
      .eq("user_id", userId).ilike("name", normalized).maybeSingle();
    if (selErr) return null;
    if (found) return { id: found.id, name: found.name };
    const { data: created, error: insErr } = await supabase
      .from("tags").insert({ user_id: userId, name: normalized }).select("id, name").single();
    if (insErr) return null;
    return created ? { id: created.id, name: created.name } : null;
  }


  async function removeTagFromTask(taskId: string, tagId: string) {
    const supabase = createClient();
    await supabase.from("task_tags").delete().eq("task_id", taskId).eq("tag_id", tagId);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, tagIds: t.tagIds.filter(id => id !== tagId) } : t));
  }

  async function deleteTag(tagId: string) {
    const supabase = createClient();
    await supabase.from("task_tags").delete().eq("tag_id", tagId);
    await supabase.from("tags").delete().eq("id", tagId);
    setAllTags(prev => prev.filter(t => t.id !== tagId));
    setTasks(prev => prev.map(t => ({ ...t, tagIds: t.tagIds.filter(id => id !== tagId) })));
    setTagFilters(prev => prev.filter(id => id !== tagId));
  }

  async function saveTagEdit(tagId: string) {
    const name = editingTagName.trim();
    setEditingTagId(null);
    setEditingTagName("");
    if (!name) return;
    const supabase = createClient();

    // Check if a tag with this name already exists (case-insensitive)
    const existing = allTags.find(t => t.id !== tagId && t.name.toLowerCase() === name.toLowerCase());

    if (existing) {
      // Merge tagId into existing.id
      // Tasks with only the old tag → reassign to existing
      // Tasks with both tags already → just delete the old entry (avoid unique constraint violation)
      const tasksWithOld  = tasks.filter(t => t.tagIds.includes(tagId));
      const onlyOld       = tasksWithOld.filter(t => !t.tagIds.includes(existing.id)).map(t => t.id);
      const haveBoth      = tasksWithOld.filter(t =>  t.tagIds.includes(existing.id)).map(t => t.id);

      if (onlyOld.length > 0)
        await supabase.from("task_tags").update({ tag_id: existing.id }).eq("tag_id", tagId).in("task_id", onlyOld);
      if (haveBoth.length > 0)
        await supabase.from("task_tags").delete().eq("tag_id", tagId).in("task_id", haveBoth);

      await supabase.from("tags").delete().eq("id", tagId);

      // Update local state
      setAllTags(prev => prev.filter(t => t.id !== tagId));
      setTasks(prev => prev.map(t => {
        if (!t.tagIds.includes(tagId)) return t;
        return { ...t, tagIds: [...new Set([...t.tagIds.filter(id => id !== tagId), existing.id])] };
      }));
      setTagFilters(prev => prev.includes(tagId)
        ? [...new Set([...prev.filter(id => id !== tagId), existing.id])]
        : prev
      );
    } else {
      // Simple rename
      await supabase.from("tags").update({ name }).eq("id", tagId);
      setAllTags(prev => prev.map(t => t.id === tagId ? { ...t, name } : t));
    }
  }


  function handleSort(field: "date" | "time" | "homeroom") {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "date" ? "asc" : "desc");
    }
  }

  const active = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done).sort((a, b) => {
    const aT = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const bT = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return bT - aT;
  });

  const sortedActive = !sortField
    ? [...active].reverse()
    : [...active].sort((a, b) => {
        if (sortField === "date") {
          const aT = new Date(a.addedAt).getTime();
          const bT = new Date(b.addedAt).getTime();
          return sortDir === "asc" ? aT - bT : bT - aT;
        } else if (sortField === "time") {
          const aT = a.lastSessionTime ?? null;
          const bT = b.lastSessionTime ?? null;
          if (aT === null && bT === null) return 0;
          if (aT === null) return 1;
          if (bT === null) return -1;
          return sortDir === "desc" ? bT - aT : aT - bT;
        } else {
          const aId = a.homeroomId ?? null;
          const bId = b.homeroomId ?? null;
          // Tasks without a homeroom go to the end
          if (aId === null && bId === null) return 0;
          if (aId === null) return 1;
          if (bId === null) return -1;
          // Same homeroom → keep relative order
          if (aId === bId) return 0;
          // Different homerooms → sort by scheduled date
          const aD = a.scheduledForDate ? new Date(a.scheduledForDate).getTime() : 0;
          const bD = b.scheduledForDate ? new Date(b.scheduledForDate).getTime() : 0;
          return sortDir === "asc" ? aD - bD : bD - aD;
        }
      });

  const filteredSortedActive = tagFilters.length > 0
    ? sortedActive.filter(t => tagFilters.every(id => t.tagIds.includes(id)))
    : sortedActive;

  const showScrollable = displayLimit === EXPANDED_LIMIT && filteredSortedActive.length > EXPANDED_LIMIT;
  const visibleActive = showScrollable ? filteredSortedActive : filteredSortedActive.slice(0, displayLimit);
  const canShowMore = filteredSortedActive.length > displayLimit && displayLimit < EXPANDED_LIMIT;

  return (
    <div>
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-bold text-lg text-charcoal leading-tight">My List</h1>
              <p className="text-xs text-warm-gray">
                {tasks.length === 0 ? "No tasks yet" : `${active.length} to do · ${done.length} done`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/home" className="flex-1 font-semibold text-sm py-2.5 rounded-xl flex items-center justify-center gap-1.5 border-2 transition-colors"
              style={{ borderColor: "var(--purple)", color: "var(--purple)", background: "var(--surface)" }}>
              Find a Room
            </Link>
            <Link href="/start" className="flex-1 font-semibold text-sm py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              style={{ background: "var(--purple)", color: "white" }}>
              Host a Room
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Add task */}
        <div className="mt-4 relative">
          <div className="flex gap-2">
            {/* Input with hashtag color overlay */}
            <div className="flex-1 relative rounded-xl overflow-hidden transition-colors"
              style={{ background: "var(--bg)", border: `1px solid ${inputFocused ? "var(--purple)" : "#E5E7EB"}` }}>
              {/* Color overlay — renders #tags in purple */}
              <div
                ref={overlayRef}
                aria-hidden
                className="absolute inset-0 pointer-events-none text-sm flex items-center px-3 overflow-hidden rounded-xl"
                style={{ whiteSpace: "pre", fontFamily: "inherit" }}
              >
                {input.split(/(#\w+)/g).map((part, i) =>
                  /^#\w+/.test(part)
                    ? <span key={i} style={{ color: "var(--purple)", fontWeight: 500 }}>{part}</span>
                    : <span key={i} style={{ color: "var(--text)" }}>{part}</span>
                )}
              </div>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); requestAnimationFrame(syncOverlay); }}
                onScroll={syncOverlay}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTask();
                  if (e.key === "Escape") setShowSuggestions(false);
                  if (e.key === "Tab" && tagCompletions.length > 0) {
                    e.preventDefault();
                    applyTagCompletion(tagCompletions[0].name);
                  }
                }}
                onFocus={() => { setInputFocused(true); setShowSuggestions(true); }}
                onBlur={() => { setInputFocused(false); setTimeout(() => setShowSuggestions(false), 150); }}
                placeholder="Add a task… use #tag"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full text-sm px-3 py-2.5 placeholder:text-warm-gray focus:outline-none bg-transparent"
                style={{ color: "transparent", caretColor: "var(--text)" }}
              />
            </div>
            <button
              onClick={() => addTask()}
              style={{ color: "var(--purple)" }}
              className="flex-shrink-0 hover:opacity-70 transition-opacity"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
              </svg>
            </button>
          </div>

          {showSuggestions && (tagCompletions.length > 0 || suggestions.length > 0) && (
            <div className="absolute left-0 right-8 top-full mt-1 border border-gray-200 rounded-xl shadow-md z-20 overflow-hidden" style={{ background: "var(--surface)" }}>
              {tagCompletions.map((tag) => {
                const { bg, fg } = tagColor(tag.name);
                return (
                  <button
                    key={tag.id}
                    onMouseDown={() => applyTagCompletion(tag.name)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                  >
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>#{tag.name}</span>
                  </button>
                );
              })}
              {suggestions.map((s) => (
                <button
                  key={s.text}
                  onMouseDown={() => addTask(s.text, s.lastSessionTime)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <span className="text-sm text-charcoal truncate">{s.text}</span>
                  <span className="text-xs text-warm-gray ml-2 flex-shrink-0">{formatSeconds(s.lastSessionTime)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort controls */}
        {active.length > 1 && (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-warm-gray">Sort:</span>
            {(["date", "time", "homeroom"] as const).map((field) => {
              const isActive = sortField === field;
              const arrow = isActive ? (sortDir === "asc" ? " ↑" : " ↓") : "";
              return (
                <button
                  key={field}
                  onClick={() => handleSort(field)}
                  className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                  style={isActive
                    ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                    : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
                >
                  {field === "date" ? "Date added" : field === "time" ? "Time required" : "Homeroom"}{arrow}
                </button>
              );
            })}
            {sortField && (
              <button onClick={() => setSortField(null)} className="text-xs text-warm-gray hover:text-charcoal transition-colors">
                Clear
              </button>
            )}
          </div>
        )}

        {/* Tag filter dropdown */}
        {allTags.length > 0 && (
          <div ref={tagDropdownRef} className="relative mt-2">
            <button
              onClick={() => setTagDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-colors"
              style={tagFilters.length > 0
                ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
              </svg>
              {tagFilters.length > 0 ? `${tagFilters.length} tag${tagFilters.length > 1 ? "s" : ""} selected` : "Filter by tag"}
              {tagFilters.length > 0 && (
                <span
                  onClick={e => { e.stopPropagation(); setTagFilters([]); }}
                  className="ml-1 opacity-70 hover:opacity-100"
                >×</span>
              )}
            </button>
            {tagDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-20 border rounded-xl shadow-md overflow-hidden min-w-[180px]" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                {allTags.map(tag => {
                  const { bg, fg } = tagColor(tag.name);
                  const checked = tagFilters.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => setTagFilters(prev => checked ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                    >
                      <span
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 transition-colors"
                        style={checked ? { background: "var(--purple)", borderColor: "var(--purple)" } : { borderColor: "#D1D5DB" }}
                      >
                        {checked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 6 5 9 10 3" /></svg>}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>#{tag.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Task list */}
        <div className="mt-4 mb-8">
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-warm-gray text-sm">
              No tasks yet. Add one above.
            </div>
          ) : (
            <div className="space-y-2">
              <div
                className={showScrollable ? "overflow-y-auto space-y-2 pr-1" : "space-y-2"}
                style={showScrollable ? { maxHeight: "480px" } : {}}
              >
                {visibleActive.map((t) => (
                  <div key={t.id} className="relative rounded-2xl overflow-hidden">
                    {/* Swipe-revealed delete (touch only) */}
                    {isTouch && (
                      <div
                        className="absolute inset-y-0 right-0 flex items-center justify-center"
                        style={{ width: SWIPE_W, background: "var(--red)", borderRadius: "16px 0 0 16px" }}
                      >
                        <button
                          className="w-full h-full text-white text-sm font-semibold"
                          onClick={() => { deleteTask(t.id); setSwipedId(null); }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                    {/* Row content */}
                    <div
                      className="bg-white border border-gray-200 rounded-2xl px-3 py-2.5 flex items-start gap-2 group relative"
                      style={{
                        transform: `translateX(${rowOffset(t.id)}px)`,
                        transition: liveSwipe?.id === t.id ? "none" : "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
                      }}
                      onTouchStart={(e) => onRowTouchStart(e, t.id)}
                      onTouchMove={onRowTouchMove}
                      onTouchEnd={() => onRowTouchEnd(t.id, t.text)}
                    >
                      <button
                        onClick={() => toggleTask(t.id)}
                        className="w-4 h-4 rounded border-2 border-gray-300 flex-shrink-0 mt-0.5 hover:border-sage transition-colors"
                      />
                      <div className="flex-1 min-w-0">
                        {editingId === t.id ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                            onBlur={saveEdit}
                            className="w-full text-sm text-charcoal border border-sage rounded-lg px-2 py-0.5 focus:outline-none bg-white"
                          />
                        ) : (
                          <span className="text-sm text-charcoal select-none leading-snug">{t.text}</span>
                        )}
                        {(t.lastSessionTime !== undefined || (t.homeroomStatus === "active" && t.scheduledForTitle) || t.homeroomId || t.tagIds.length > 0) && (
                          <div className="mt-1.5">
                            <div className="flex flex-wrap gap-1">
                              {t.lastSessionTime !== undefined && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--purple-bg-2)", color: "var(--purple)" }}>
                                  {formatSeconds(t.lastSessionTime)}
                                </span>
                              )}
                              {t.homeroomStatus === "active" && t.scheduledForTitle && (
                                <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1.5 font-medium" style={{ background: "var(--green-bg)", color: "var(--green-text)", border: "1px solid var(--green-border)" }}>
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0 inline-block animate-pulse" />
                                  {t.scheduledForTitle.length > 22 ? t.scheduledForTitle.slice(0, 22) + "…" : t.scheduledForTitle}
                                </span>
                              )}
                              {t.tagIds.map(tid => {
                                const tag = allTags.find(x => x.id === tid);
                                if (!tag) return null;
                                const { bg, fg } = tagColor(tag.name);
                                return (
                                  <span key={tid} className="group/tag text-xs px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1" style={{ background: bg, color: fg }}>
                                    #{tag.name}
                                    <button
                                      onClick={e => { e.stopPropagation(); removeTagFromTask(t.id, tid); }}
                                      className="opacity-0 group-hover/tag:opacity-100 transition-opacity leading-none"
                                      style={{ color: fg }}>
                                      ×
                                    </button>
                                  </span>
                                );
                              })}
                            </div>
                            {expandedHomeroomTaskId === t.id && t.homeroomId && t.scheduledForTitle && t.homeroomStatus !== "active" && (
                              <div className="mt-1.5 flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg" style={{ background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                                <span className="font-medium">{t.scheduledForTitle}</span>
                                {t.scheduledForDate && (
                                  <span className="opacity-70">· {new Date(t.scheduledForDate).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 self-start flex flex-col items-end gap-0.5">
                        <span className="text-xs text-warm-gray opacity-50 group-hover:hidden whitespace-nowrap">
                          {addedAtLabel(t.addedAt)}
                        </span>
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <button onClick={() => startEdit(t.id, t.text)} className="text-warm-gray hover:text-sage transition-colors p-1">
                            <EditIcon />
                          </button>
                          <button onClick={() => deleteTask(t.id)} className="text-warm-gray hover:text-red-400 transition-colors p-1">
                            <TrashIcon />
                          </button>
                        </div>
                        {t.homeroomId && t.homeroomStatus !== "active" && (
                          <button
                            onClick={e => { e.stopPropagation(); setExpandedHomeroomTaskId(prev => prev === t.id ? null : t.id); }}
                            className="p-0.5 rounded transition-colors hover:opacity-70"
                            style={{ color: expandedHomeroomTaskId === t.id ? "var(--purple)" : "var(--text-2)" }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {canShowMore && (
                <button
                  onClick={() => setDisplayLimit(EXPANDED_LIMIT)}
                  className="w-full text-xs text-warm-gray hover:text-charcoal py-2 border border-dashed border-gray-200 rounded-xl transition-colors"
                >
                  Show more ({sortedActive.length - displayLimit} remaining)
                </button>
              )}

              {done.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => setDoneExpanded((v) => !v)}
                    className="w-full flex items-center justify-between py-1.5 mb-2"
                  >
                    <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide">Done · {done.length}</p>
                    <svg
                      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: doneExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {doneExpanded && done.map((t) => (
                    <div key={t.id} className="relative rounded-2xl overflow-hidden mb-2">
                      {/* Swipe-revealed delete (touch only) */}
                      {isTouch && (
                        <div
                          className="absolute inset-y-0 right-0 flex items-center justify-center"
                          style={{ width: SWIPE_W, background: "var(--red)", borderRadius: "16px 0 0 16px" }}
                        >
                          <button
                            className="w-full h-full text-white text-sm font-semibold"
                            onClick={() => { deleteTask(t.id); setSwipedId(null); }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                      {/* Row content */}
                      <div
                        className="bg-white border border-gray-100 rounded-2xl px-3 py-2.5 flex items-start gap-2 group relative"
                        style={{
                          transform: `translateX(${rowOffset(t.id)}px)`,
                          transition: liveSwipe?.id === t.id ? "none" : "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
                        }}
                        onTouchStart={(e) => onRowTouchStart(e, t.id)}
                        onTouchMove={onRowTouchMove}
                        onTouchEnd={() => onRowTouchEnd(t.id, t.text)}
                      >
                      <div className="flex items-start gap-2 flex-1 min-w-0 opacity-60">
                      <button
                        onClick={() => toggleTask(t.id)}
                        className="w-4 h-4 rounded flex-shrink-0 mt-0.5 flex items-center justify-center"
                        style={{ background: "var(--purple)", border: "2px solid var(--purple)" }}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-warm-gray line-through select-none leading-snug">{t.text}</span>
                        {t.lastSessionTime !== undefined && (
                          <div className="mt-1">
                            <span className="text-xs text-warm-gray">{formatSeconds(t.lastSessionTime)}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 self-start flex items-center gap-0.5">
                          <span className="text-xs text-warm-gray opacity-70 whitespace-nowrap">{completedLabel(t.completedAt)}</span>
                          <button
                            onClick={() => deleteTask(t.id)}
                            className="opacity-0 group-hover:opacity-100 text-warm-gray hover:text-red-400 transition-all p-1"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tag manager */}
        {allTags.length > 0 && (
          <div className="mt-6 mb-8">
            <button
              onClick={() => setTagsExpanded(v => !v)}
              className="w-full flex items-center justify-between py-1.5"
            >
              <p className="text-xs font-semibold text-warm-gray uppercase tracking-wide">Tags · {allTags.length}</p>
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: tagsExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {tagsExpanded && (
              <div className="mt-2 space-y-1.5">
                {allTags.map(tag => {
                  const { bg, fg } = tagColor(tag.name);
                  const isEditingThis = editingTagId === tag.id;
                  return (
                    <div key={tag.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                      {isEditingThis ? (
                        <input
                          autoFocus
                          value={editingTagName}
                          onChange={e => setEditingTagName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") saveTagEdit(tag.id);
                            if (e.key === "Escape") { setEditingTagId(null); setEditingTagName(""); }
                          }}
                          onBlur={() => saveTagEdit(tag.id)}
                          className="flex-1 text-sm px-2 py-0.5 rounded-lg border focus:outline-none"
                          style={{ borderColor: "var(--purple)", color: "var(--text)" }}
                        />
                      ) : (
                        <span className="flex-1 text-xs px-2 py-0.5 rounded-full font-medium w-fit" style={{ background: bg, color: fg }}>
                          #{tag.name}
                        </span>
                      )}
                      <div className="flex items-center gap-1 ml-auto">
                        {!isEditingThis && (
                          <button
                            onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }}
                            className="p-1 text-warm-gray hover:text-charcoal transition-colors"
                          >
                            <EditIcon />
                          </button>
                        )}
                        <button
                          onClick={() => deleteTag(tag.id)}
                          className="p-1 text-warm-gray hover:text-red-400 transition-colors"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
