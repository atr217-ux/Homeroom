"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type SetupTask = { id: string; text: string; created_at: string; tagIds: string[] };
type Tag = { id: string; name: string };
type Task = { id: string; text: string; done: boolean; timeSpent: number; startedAt: number | null };
type UnassignedTask = { id: string; text: string; created_at: string; tagIds: string[] };

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const TAG_COLORS = ["#7C3AED","#0891B2","#059669","#D97706","#DC2626","#DB2777","#65A30D","#0284C7"];
function tagColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const c = TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
  return { bg: c + "22", fg: c };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "setup" | "committed">("loading");
  const [toast, setToast] = useState<string | null>(null);

  // ── Setup state ──────────────────────────────────────────────────────────
  const [setupTasks, setSetupTasks] = useState<SetupTask[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [sortDir, setSortDir] = useState<"none" | "asc" | "desc">("none");
  const [showAll, setShowAll] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const newTaskRef = useRef<HTMLDivElement | null>(null);
  const [committing, setCommitting] = useState(false);
  const LIMIT = 10;

  // ── Committed state ──────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<Task[]>([]);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // ── Add more state ───────────────────────────────────────────────────────
  const [showAddMore, setShowAddMore] = useState(false);
  const [addMoreText, setAddMoreText] = useState("");
  const addMoreRef = useRef<HTMLDivElement | null>(null);
  const [addMoreSearch, setAddMoreSearch] = useState("");
  const [addMoreTagFilters, setAddMoreTagFilters] = useState<string[]>([]);
  const [addMoreSortDir, setAddMoreSortDir] = useState<"none" | "asc" | "desc">("none");
  const [addMoreTagDropdownOpen, setAddMoreTagDropdownOpen] = useState(false);
  const addMoreTagDropdownRef = useRef<HTMLDivElement>(null);
  const [unassigned, setUnassigned] = useState<UnassignedTask[]>([]);

  // ── Init ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      userIdRef.current = user.id;
      const today = dateKey(new Date());
      if (localStorage.getItem("homeroom-today-setup-date") === today) {
        await loadCommittedTasks(user.id, today);
      } else {
        await loadSetupTasks(user.id);
        setPhase("setup");
      }
    }
    init();

    const ticker = setInterval(() => setTick(t => t + 1), 1000);
    function onOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node))
        setTagDropdownOpen(false);
      if (addMoreTagDropdownRef.current && !addMoreTagDropdownRef.current.contains(e.target as Node))
        setAddMoreTagDropdownOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => { clearInterval(ticker); document.removeEventListener("mousedown", onOutside); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load setup tasks ──────────────────────────────────────────────────────

  async function loadSetupTasks(uid: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks").select("id, text, created_at")
      .eq("user_id", uid).eq("done", false)
      .order("created_at", { ascending: true }).limit(200);
    if (!data) { setSetupTasks([]); return; }

    const ids = data.map(t => t.id);
    const [tagsRes, ttRes] = await Promise.allSettled([
      supabase.from("tags").select("id, name").eq("user_id", uid),
      ids.length > 0 ? supabase.from("task_tags").select("task_id, tag_id").in("task_id", ids) : Promise.resolve({ data: [] }),
    ]);
    const tagsData = tagsRes.status === "fulfilled" ? (tagsRes.value.data ?? []) : [];
    const ttData = ttRes.status === "fulfilled" ? ((ttRes.value as { data: { task_id: string; tag_id: string }[] | null }).data ?? []) : [];
    setAllTags(tagsData as Tag[]);
    const tagMap: Record<string, string[]> = {};
    for (const r of ttData) { if (!tagMap[r.task_id]) tagMap[r.task_id] = []; tagMap[r.task_id].push(r.tag_id); }

    const tasks = data.map(t => ({ id: t.id, text: t.text, created_at: t.created_at as string, tagIds: tagMap[t.id] ?? [] }));
    setSetupTasks(tasks);
    // Start with nothing selected — user picks their own tasks
    setSelectedIds(new Set());
  }

  // ── Load committed tasks ──────────────────────────────────────────────────

  async function loadCommittedTasks(uid: string, today: string) {
    const supabase = createClient();
    const { data: blocks } = await supabase
      .from("blocks").select("id")
      .eq("user_id", uid).eq("date", today)
      .order("position", { ascending: true }).limit(1);

    if (!blocks || blocks.length === 0) {
      localStorage.removeItem("homeroom-today-setup-date");
      await loadSetupTasks(uid);
      setPhase("setup");
      return;
    }

    const bid = blocks[0].id;
    setBlockId(bid);
    const { data: taskData } = await supabase
      .from("tasks").select("id, text, done, time_spent, timer_started_at")
      .eq("block_id", bid).order("created_at", { ascending: true });

    setTasks((taskData ?? []).map(t => ({
      id: t.id, text: t.text, done: t.done,
      timeSpent: t.time_spent ?? 0,
      startedAt: t.timer_started_at ? new Date(t.timer_started_at).getTime() : null,
    })));
    setPhase("committed");
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function commit() {
    const uid = userIdRef.current;
    if (!uid) { showToast("Not logged in — please refresh"); return; }
    setCommitting(true);
    try {
      const supabase = createClient();
      const today = dateKey(new Date());
      const { data: block, error } = await supabase
        .from("blocks")
        .insert({ user_id: uid, date: today, name: "Today", position: 0, visibility: "private" })
        .select("id").single();
      if (!block) {
        showToast(error?.message ?? "Could not save — try again");
        return;
      }
      const ids = [...selectedIds];
      if (ids.length > 0) await supabase.from("tasks").update({ block_id: block.id }).in("id", ids);
      localStorage.setItem("homeroom-today-setup-date", today);
      setBlockId(block.id);
      setTasks(setupTasks.filter(t => selectedIds.has(t.id)).map(t => ({ id: t.id, text: t.text, done: false, timeSpent: 0, startedAt: null })));
      setPhase("committed");
    } catch (e) {
      console.error("Commit error:", e);
      showToast("Something went wrong — try again");
    } finally {
      setCommitting(false);
    }
  }

  // ── Add task during setup ─────────────────────────────────────────────────

  async function addSetupTask() {
    if (!newTaskText.trim() || !userId) return;
    const { data } = await createClient()
      .from("tasks").insert({ user_id: userId, text: newTaskText.trim(), done: false })
      .select("id, text, created_at").single();
    if (data) {
      const t = { id: data.id, text: data.text, created_at: data.created_at as string, tagIds: [] };
      setSetupTasks(prev => [...prev, t]);
      setNewTaskText("");
      if (newTaskRef.current) newTaskRef.current.innerHTML = "";
    }
  }

  // ── Timer helpers ─────────────────────────────────────────────────────────

  function elapsed(t: Task) {
    return t.startedAt === null ? t.timeSpent : t.timeSpent + Math.floor((Date.now() - t.startedAt) / 1000);
  }

  async function startTimer(id: string) {
    const now = Date.now();
    const supabase = createClient();
    const running = tasks.find(t => t.startedAt !== null && t.id !== id);
    await Promise.all([
      supabase.from("tasks").update({ timer_started_at: new Date(now).toISOString() }).eq("id", id),
      running ? supabase.from("tasks").update({ timer_started_at: null, time_spent: elapsed(running) }).eq("id", running.id) : Promise.resolve(),
    ]);
    setTasks(prev => prev.map(t => {
      if (t.id === id) return { ...t, startedAt: now };
      if (t.startedAt !== null) return { ...t, timeSpent: elapsed(t), startedAt: null };
      return t;
    }));
  }

  async function stopTimer(id: string) {
    const t = tasks.find(t => t.id === id);
    const spent = t ? elapsed(t) : 0;
    await createClient().from("tasks").update({ timer_started_at: null, time_spent: spent }).eq("id", id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, timeSpent: elapsed(t), startedAt: null } : t));
  }

  async function toggleTask(id: string) {
    const t = tasks.find(t => t.id === id);
    if (!t) return;
    const spent = elapsed(t);
    const nowDone = !t.done;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: nowDone, timeSpent: spent, startedAt: null } : t));
    await createClient().from("tasks").update({
      done: nowDone, time_spent: spent,
      timer_started_at: null,
      completed_at: nowDone ? new Date().toISOString() : null,
    }).eq("id", id);
  }

  // ── Add more tasks ────────────────────────────────────────────────────────

  async function openAddMore() {
    if (!userId) return;
    const alreadyIn = new Set(tasks.map(t => t.id));
    const supabase = createClient();

    const [tasksRes, tagsRes] = await Promise.allSettled([
      supabase.from("tasks").select("id, text, created_at")
        .eq("user_id", userId).eq("done", false)
        .order("created_at", { ascending: false }).limit(100),
      allTags.length === 0
        ? supabase.from("tags").select("id, name").eq("user_id", userId)
        : Promise.resolve({ data: allTags }),
    ]);

    const taskData = tasksRes.status === "fulfilled" ? (tasksRes.value.data ?? []) : [];
    const tagsData = tagsRes.status === "fulfilled" ? ((tagsRes.value as { data: Tag[] | null }).data ?? []) : [];
    if (allTags.length === 0 && tagsData.length > 0) setAllTags(tagsData);

    const filtered = taskData.filter(t => !alreadyIn.has(t.id));
    const ids = filtered.map(t => t.id);
    const tagMap: Record<string, string[]> = {};
    if (ids.length > 0) {
      const { data: ttData } = await supabase.from("task_tags").select("task_id, tag_id").in("task_id", ids);
      for (const r of (ttData ?? [])) {
        if (!tagMap[r.task_id]) tagMap[r.task_id] = [];
        tagMap[r.task_id].push(r.tag_id);
      }
    }

    setUnassigned(filtered.map(t => ({ id: t.id, text: t.text, created_at: t.created_at as string, tagIds: tagMap[t.id] ?? [] })));
    setShowAddMore(true);
  }

  async function addNewCommittedTask() {
    if (!addMoreText.trim() || !userId || !blockId) return;
    const text = addMoreText.trim();
    const tempId = crypto.randomUUID();
    setTasks(prev => [...prev, { id: tempId, text, done: false, timeSpent: 0, startedAt: null }]);
    setAddMoreText("");
    if (addMoreRef.current) addMoreRef.current.innerHTML = "";
    const { data } = await createClient()
      .from("tasks").insert({ user_id: userId, text, done: false, block_id: blockId })
      .select("id").single();
    if (data) setTasks(prev => prev.map(t => t.id === tempId ? { ...t, id: data.id } : t));
  }

  async function importTask(id: string, text: string) {
    if (!blockId) return;
    setTasks(prev => [...prev, { id, text, done: false, timeSpent: 0, startedAt: null }]);
    setUnassigned(prev => prev.filter(t => t.id !== id));
    await createClient().from("tasks").update({ block_id: blockId }).eq("id", id);
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const filtered = (() => {
    let list = tagFilters.length > 0 ? setupTasks.filter(t => tagFilters.every(id => t.tagIds.includes(id))) : setupTasks;
    if (search.trim()) list = list.filter(t => t.text.toLowerCase().includes(search.toLowerCase().trim()));
    if (sortDir !== "none") list = [...list].sort((a, b) => {
      const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortDir === "asc" ? d : -d;
    });
    return list;
  })();

  const filteredUnassigned = (() => {
    let list = addMoreTagFilters.length > 0
      ? unassigned.filter(t => addMoreTagFilters.every(id => t.tagIds.includes(id)))
      : unassigned;
    if (addMoreSearch.trim()) list = list.filter(t => t.text.toLowerCase().includes(addMoreSearch.toLowerCase().trim()));
    if (addMoreSortDir !== "none") list = [...list].sort((a, b) => {
      const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return addMoreSortDir === "asc" ? d : -d;
    });
    return list;
  })();

  const done = tasks.filter(t => t.done);
  const undone = tasks.filter(t => !t.done);

  void tick;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 pb-28">

      {/* Loading */}
      {phase === "loading" && (
        <div className="flex items-center justify-center pt-32">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }} />
        </div>
      )}

      {/* ── Setup ─────────────────────────────────────────────────────────── */}
      {phase === "setup" && (
        <div>
          {/* Header */}
          <div className="pt-10 pb-6">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-3"
              style={{ background: "rgba(139,92,246,0.12)", color: "var(--purple)" }}>
              Today&apos;s Commitment
            </span>
            <h1 className="text-2xl font-bold text-charcoal leading-snug">
              What are you committing to accomplish today?
            </h1>
          </div>

          {/* Search */}
          <div className="mb-3 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks…"
              className="w-full text-sm rounded-xl pl-8 pr-3 py-2.5 focus:outline-none border transition-colors"
              style={{ background: "var(--surface)", borderColor: search ? "var(--purple)" : "var(--border-2)", color: "var(--text)", fontSize: "16px" }} />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 mb-4">
            {allTags.length > 0 && (
              <div ref={tagDropdownRef} className="relative">
                <button onClick={() => setTagDropdownOpen(v => !v)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-colors"
                  style={tagFilters.length > 0
                    ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                    : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" /></svg>
                  {tagFilters.length > 0 ? `${tagFilters.length} tag${tagFilters.length > 1 ? "s" : ""}` : "Filter by tag"}
                  {tagFilters.length > 0 && <span onClick={e => { e.stopPropagation(); setTagFilters([]); }} className="ml-1 opacity-70">×</span>}
                </button>
                {tagDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 z-20 border rounded-xl shadow-md overflow-hidden min-w-[180px]" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                    {allTags.map(tag => {
                      const { bg, fg } = tagColor(tag.name);
                      const checked = tagFilters.includes(tag.id);
                      return (
                        <button key={tag.id} onClick={() => setTagFilters(prev => checked ? prev.filter(i => i !== tag.id) : [...prev, tag.id])}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50">
                          <span className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2"
                            style={checked ? { background: "var(--purple)", borderColor: "var(--purple)" } : { borderColor: "#D1D5DB" }}>
                            {checked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5"><polyline points="2 6 5 9 10 3" /></svg>}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>#{tag.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setSortDir(d => d === "none" ? "desc" : d === "desc" ? "asc" : "none")}
              className="ml-auto text-xs px-2.5 py-1.5 rounded-full border font-medium transition-colors"
              style={sortDir !== "none"
                ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}>
              Date added {sortDir === "asc" ? "↑" : sortDir === "desc" ? "↓" : ""}
            </button>
          </div>

          {/* Select all / clear */}
          {setupTasks.length > 0 && (
            <div className="flex items-center gap-3 mb-3">
              <button onClick={() => setSelectedIds(new Set(setupTasks.map(t => t.id)))} className="text-xs font-semibold" style={{ color: "var(--purple)" }}>Select all</button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs font-semibold" style={{ color: "var(--text-2)" }}>Clear</button>
              {selectedIds.size > 0 && (
                <span className="text-xs font-medium ml-auto px-2 py-0.5 rounded-full" style={{ background: "rgba(139,92,246,0.1)", color: "var(--purple)" }}>
                  {selectedIds.size} selected
                </span>
              )}
              {selectedIds.size === 0 && search && (
                <span className="text-xs ml-auto" style={{ color: "var(--text-2)" }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
              )}
            </div>
          )}

          {/* Task list */}
          <div className="space-y-2 mb-4">
            {(showAll ? filtered : filtered.slice(0, LIMIT)).map(task => {
              const sel = selectedIds.has(task.id);
              return (
                <button key={task.id}
                  onClick={() => setSelectedIds(prev => { const s = new Set(prev); s.has(task.id) ? s.delete(task.id) : s.add(task.id); return s; })}
                  className="w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left transition-all"
                  style={{
                    background: sel ? "rgba(139,92,246,0.06)" : "var(--surface)",
                    border: `1.5px solid ${sel ? "var(--purple)" : "var(--border-2)"}`,
                  }}>
                  <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-0.5 transition-all"
                    style={sel ? { background: "var(--purple)", border: "2px solid var(--purple)" } : { border: "2px solid var(--border-3)" }}>
                    {sel && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm leading-snug" style={{ color: sel ? "var(--text)" : "var(--text-2)" }}>{task.text}</span>
                    {task.tagIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {task.tagIds.map(tid => {
                          const tag = allTags.find(t => t.id === tid);
                          if (!tag) return null;
                          const { bg, fg } = tagColor(tag.name);
                          return <span key={tid} className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>#{tag.name}</span>;
                        })}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
            {filtered.length > LIMIT && (
              <button onClick={() => setShowAll(v => !v)} className="w-full text-xs font-medium py-2 rounded-xl border"
                style={{ color: "var(--text-2)", borderColor: "var(--border-2)", background: "var(--surface)" }}>
                {showAll ? "Show less" : `Show all ${filtered.length} tasks`}
              </button>
            )}
            {filtered.length === 0 && (search || tagFilters.length > 0) && (
              <p className="text-sm text-center py-6" style={{ color: "var(--text-2)" }}>No tasks match your filters</p>
            )}
            {filtered.length === 0 && !search && tagFilters.length === 0 && (
              <p className="text-sm text-center py-6" style={{ color: "var(--text-2)" }}>Your list is empty — add a task below</p>
            )}
          </div>

          {/* Add a task */}
          <div className="flex gap-2 items-center mb-24">
            <div className="flex-1 relative rounded-xl"
              style={{ background: "var(--surface)", border: `2px solid ${newTaskText ? "var(--purple)" : "rgba(139,92,246,0.3)"}` }}>
              {!newTaskText && (
                <span className="absolute inset-0 flex items-center px-3 text-sm pointer-events-none font-medium" style={{ color: "var(--purple)", opacity: 0.5 }}>Add a task…</span>
              )}
              <div ref={newTaskRef} contentEditable suppressContentEditableWarning role="textbox"
                onInput={() => { const el = newTaskRef.current; if (el) setNewTaskText(el.innerText.replace(/\n/g, "")); }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSetupTask(); } }}
                onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }} // eslint-disable-line
                className="w-full px-3 py-2.5 focus:outline-none"
                style={{ color: "var(--text)", fontSize: "16px" } as React.CSSProperties} />
            </div>
            <button onClick={addSetupTask} style={{ color: "var(--purple)" }} className="flex-shrink-0 hover:opacity-70 transition-opacity">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></svg>
            </button>
          </div>

          {/* Commit button */}
          <div className="fixed bottom-20 left-0 right-0 px-4 max-w-2xl mx-auto">
            <button onClick={commit} disabled={committing}
              className="w-full py-4 rounded-2xl text-base font-bold text-white shadow-lg flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
              style={{ background: "var(--purple)" }}>
              {committing && <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "white", borderTopColor: "transparent" }} />}
              I&apos;m ready to commit{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Committed ─────────────────────────────────────────────────────── */}
      {phase === "committed" && (
        <div>
          {/* Header */}
          <div className="pt-8 pb-5 flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold text-charcoal">
                {new Date().toLocaleDateString(undefined, { weekday: "long" })}
              </h1>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-2)" }}>
                {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" })}
              </p>
            </div>
            {tasks.length > 0 && (
              <span className="text-sm font-semibold px-3 py-1 rounded-full mb-1"
                style={{ background: done.length === tasks.length ? "rgba(139,92,246,0.15)" : "rgba(139,92,246,0.08)", color: "var(--purple)" }}>
                {done.length}/{tasks.length} done
              </span>
            )}
          </div>

          {/* Task block */}
          <div className="rounded-2xl border overflow-hidden mb-4"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            {/* Purple top accent */}
            <div className="h-1 w-full" style={{ background: "var(--purple)" }} />

            <div className="p-4">
              {tasks.length === 0 && (
                <p className="text-sm text-center py-4" style={{ color: "var(--text-2)" }}>No tasks yet — add some below.</p>
              )}

              {/* Undone tasks */}
              <div className="space-y-0.5">
                {undone.map(t => {
                  const e = elapsed(t);
                  const running = t.startedAt !== null;
                  return (
                    <div key={t.id} className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl transition-colors"
                      style={{ background: running ? "rgba(139,92,246,0.05)" : "transparent" }}>
                      <button onClick={() => toggleTask(t.id)}
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors"
                        style={{ border: `2px solid ${running ? "var(--purple)" : "var(--border-3)"}` }} />
                      <span className="text-sm flex-1 break-words min-w-0" style={{ color: "var(--text)" }}>{t.text}</span>
                      <span className="text-xs font-mono w-10 text-right flex-shrink-0 tabular-nums"
                        style={{ color: running ? "var(--purple)" : "var(--text-2)", opacity: e > 0 || running ? 1 : 0 }}>
                        {formatTime(e)}
                      </span>
                      <button onClick={() => running ? stopTimer(t.id) : startTimer(t.id)}
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                        style={running ? { background: "var(--purple)" } : { background: "var(--border-2)" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={running ? "white" : "var(--text-2)"} strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Done tasks */}
              {done.length > 0 && (
                <div className={`space-y-0.5 border-t pt-2 mt-2`} style={{ borderColor: "var(--border-2)" }}>
                  {done.map(t => (
                    <div key={t.id} className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl opacity-55">
                      <button onClick={() => toggleTask(t.id)}
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                        style={{ background: "var(--purple)", border: "2px solid var(--purple)" }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                      </button>
                      <span className="text-sm flex-1 min-w-0 line-through" style={{ color: "var(--text-2)" }}>{t.text}</span>
                      <span className="text-xs font-mono flex-shrink-0 tabular-nums" style={{ color: "var(--text-2)" }}>{formatTime(t.timeSpent)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Add more tasks toggle */}
          <button onClick={showAddMore ? () => setShowAddMore(false) : openAddMore}
            className="w-full text-sm font-medium py-3 rounded-2xl border mb-3 flex items-center justify-center gap-1.5 transition-all"
            style={showAddMore
              ? { borderColor: "var(--purple)", color: "var(--purple)", background: "rgba(139,92,246,0.06)" }
              : { borderColor: "var(--border-3)", color: "var(--text-2)", background: "transparent" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              {showAddMore
                ? <path d="M18 12H6" />
                : <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>}
            </svg>
            {showAddMore ? "Close" : "Add more tasks"}
          </button>

          {showAddMore && (
            <div className="rounded-2xl border p-4 space-y-3 mb-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              {/* New task input */}
              <div className="flex gap-2 items-center">
                <div className="flex-1 relative rounded-xl"
                  style={{ background: "var(--bg)", border: `2px solid ${addMoreText ? "var(--purple)" : "rgba(139,92,246,0.3)"}` }}>
                  {!addMoreText && (
                    <span className="absolute inset-0 flex items-center px-3 text-sm pointer-events-none font-medium" style={{ color: "var(--purple)", opacity: 0.5 }}>New task…</span>
                  )}
                  <div ref={addMoreRef} contentEditable suppressContentEditableWarning role="textbox"
                    onInput={() => { const el = addMoreRef.current; if (el) setAddMoreText(el.innerText.replace(/\n/g, "")); }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNewCommittedTask(); } }}
                    onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }} // eslint-disable-line
                    className="w-full px-3 py-2.5 focus:outline-none"
                    style={{ color: "var(--text)", fontSize: "16px" } as React.CSSProperties} />
                </div>
                <button onClick={addNewCommittedTask} style={{ color: "var(--purple)" }} className="flex-shrink-0 hover:opacity-70">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></svg>
                </button>
              </div>

              {/* My List — search, tag filter, sort */}
              {unassigned.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    {/* Search */}
                    <div className="flex-1 relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
                        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                      </svg>
                      <input type="text" value={addMoreSearch} onChange={e => setAddMoreSearch(e.target.value)} placeholder="Search My List…"
                        className="w-full text-sm rounded-xl pl-8 pr-3 py-2 focus:outline-none border"
                        style={{ background: "var(--bg)", borderColor: addMoreSearch ? "var(--purple)" : "var(--border-2)", color: "var(--text)", fontSize: "16px" }} />
                    </div>
                    {/* Tag filter */}
                    {allTags.length > 0 && (
                      <div ref={addMoreTagDropdownRef} className="relative flex-shrink-0">
                        <button onClick={() => setAddMoreTagDropdownOpen(v => !v)}
                          className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-xl border font-medium"
                          style={addMoreTagFilters.length > 0
                            ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                            : { background: "var(--bg)", color: "var(--text-2)", borderColor: "var(--border-2)" }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" /></svg>
                          {addMoreTagFilters.length > 0 ? `${addMoreTagFilters.length}` : "Tags"}
                          {addMoreTagFilters.length > 0 && <span onClick={e => { e.stopPropagation(); setAddMoreTagFilters([]); }} className="ml-0.5 opacity-70">×</span>}
                        </button>
                        {addMoreTagDropdownOpen && (
                          <div className="absolute right-0 top-full mt-1 z-20 border rounded-xl shadow-md overflow-hidden min-w-[160px]" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                            {allTags.map(tag => {
                              const { bg, fg } = tagColor(tag.name);
                              const checked = addMoreTagFilters.includes(tag.id);
                              return (
                                <button key={tag.id} onClick={() => setAddMoreTagFilters(prev => checked ? prev.filter(i => i !== tag.id) : [...prev, tag.id])}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50">
                                  <span className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2"
                                    style={checked ? { background: "var(--purple)", borderColor: "var(--purple)" } : { borderColor: "#D1D5DB" }}>
                                    {checked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5"><polyline points="2 6 5 9 10 3" /></svg>}
                                  </span>
                                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>#{tag.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Sort */}
                    <button onClick={() => setAddMoreSortDir(d => d === "none" ? "desc" : d === "desc" ? "asc" : "none")}
                      className="flex-shrink-0 text-xs px-2.5 py-2 rounded-xl border font-medium"
                      style={addMoreSortDir !== "none"
                        ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                        : { background: "var(--bg)", color: "var(--text-2)", borderColor: "var(--border-2)" }}>
                      {addMoreSortDir === "asc" ? "↑" : addMoreSortDir === "desc" ? "↓" : "Date"}
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {filteredUnassigned.length === 0 && (
                      <p className="text-xs text-center py-3" style={{ color: "var(--text-2)" }}>No tasks match</p>
                    )}
                    {filteredUnassigned.map(t => (
                      <button key={t.id} onClick={() => importTask(t.id, t.text)}
                        className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left hover:opacity-80 transition-opacity"
                        style={{ background: "var(--bg)", border: "1px solid var(--border-2)" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--purple)", flexShrink: 0, marginTop: 2 }}>
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm" style={{ color: "var(--text)" }}>{t.text}</span>
                          {t.tagIds.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {t.tagIds.map(tid => {
                                const tag = allTags.find(tg => tg.id === tid);
                                if (!tag) return null;
                                const { bg, fg } = tagColor(tag.name);
                                return <span key={tid} className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>#{tag.name}</span>;
                              })}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {unassigned.length === 0 && (
                <p className="text-xs text-center py-2" style={{ color: "var(--text-2)" }}>All your tasks are already in today&apos;s list</p>
              )}
            </div>
          )}

          {/* Add a block — behavior TBD */}
          <button className="w-full text-sm font-medium py-3 rounded-2xl border border-dashed flex items-center justify-center gap-1.5 opacity-40"
            style={{ borderColor: "var(--purple)", color: "var(--purple)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add a block
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="bg-charcoal text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg whitespace-nowrap">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
