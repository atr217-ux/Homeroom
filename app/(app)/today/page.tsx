"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type SetupTask = { id: string; text: string; created_at: string; tagIds: string[] };
type Tag = { id: string; name: string };
type Task = { id: string; text: string; done: boolean; timeSpent: number; startedAt: number | null };

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
  const [phase, setPhase] = useState<"loading" | "setup" | "committed">("loading");

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

  // ── Init ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
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
    setSelectedIds(new Set(tasks.map(t => t.id)));
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

  async function commit() {
    if (!userId) return;
    setCommitting(true);
    const supabase = createClient();
    const today = dateKey(new Date());
    const { data: block, error } = await supabase
      .from("blocks")
      .insert({ user_id: userId, date: today, name: "Today", position: 0, visibility: "private" })
      .select("id").single();
    if (!block) {
      console.error("Block creation failed:", error);
      setCommitting(false);
      return;
    }
    const ids = [...selectedIds];
    if (ids.length > 0) await supabase.from("tasks").update({ block_id: block.id }).in("id", ids);
    localStorage.setItem("homeroom-today-setup-date", today);
    // Transition immediately using data we already have — no second roundtrip
    setBlockId(block.id);
    setTasks(setupTasks.filter(t => selectedIds.has(t.id)).map(t => ({ id: t.id, text: t.text, done: false, timeSpent: 0, startedAt: null })));
    setPhase("committed");
    setCommitting(false);
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
      setSelectedIds(prev => new Set([...prev, data.id]));
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

  // ── Add task to committed view ────────────────────────────────────────────

  const [showAddMore, setShowAddMore] = useState(false);
  const [addMoreText, setAddMoreText] = useState("");
  const addMoreRef = useRef<HTMLDivElement | null>(null);
  const [addMoreSearch, setAddMoreSearch] = useState("");
  const [unassigned, setUnassigned] = useState<{ id: string; text: string }[]>([]);

  async function openAddMore() {
    if (!userId) return;
    const alreadyIn = new Set(tasks.map(t => t.id));
    const { data } = await createClient()
      .from("tasks").select("id, text")
      .eq("user_id", userId).eq("done", false)
      .order("created_at", { ascending: false }).limit(100);
    setUnassigned((data ?? []).filter(t => !alreadyIn.has(t.id)));
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
          <div className="pt-10 pb-6">
            <h1 className="text-2xl font-bold text-charcoal">What are you committing to accomplish today?</h1>
          </div>

          {/* Search */}
          <div className="mb-3 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks…"
              className="w-full text-sm rounded-xl pl-8 pr-3 py-2 focus:outline-none border"
              style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }} />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 mb-4">
            {allTags.length > 0 && (
              <div ref={tagDropdownRef} className="relative">
                <button onClick={() => setTagDropdownOpen(v => !v)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium"
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
              className="ml-auto text-xs px-2.5 py-1.5 rounded-full border font-medium"
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
              {search && <span className="text-xs ml-auto" style={{ color: "var(--text-2)" }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>}
            </div>
          )}

          {/* Task list */}
          <div className="space-y-2 mb-4">
            {(showAll ? filtered : filtered.slice(0, LIMIT)).map(task => {
              const sel = selectedIds.has(task.id);
              return (
                <button key={task.id}
                  onClick={() => setSelectedIds(prev => { const s = new Set(prev); s.has(task.id) ? s.delete(task.id) : s.add(task.id); return s; })}
                  className="w-full flex items-start gap-2 px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{ background: "var(--surface)", border: `1px solid ${sel ? "var(--purple)" : "var(--border-2)"}` }}>
                  <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-0.5"
                    style={sel ? { background: "var(--purple)", border: "2px solid var(--purple)" } : { border: "2px solid var(--border-3)" }}>
                    {sel && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-charcoal leading-snug">{task.text}</span>
                    {task.tagIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
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
          </div>

          {/* Add a task */}
          <div className="flex gap-2 items-center mb-24">
            <div className="flex-1 relative rounded-xl"
              style={{ background: "var(--surface)", border: `2px solid ${newTaskText ? "var(--purple)" : "rgba(139,92,246,0.35)"}` }}>
              {!newTaskText && (
                <span className="absolute inset-0 flex items-center px-3 text-sm pointer-events-none font-medium" style={{ color: "var(--purple)", opacity: 0.6 }}>Add a task…</span>
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
              className="w-full py-4 rounded-2xl text-base font-bold text-white shadow-lg flex items-center justify-center gap-2 disabled:opacity-60"
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
          <div className="pt-8 pb-5">
            <h1 className="text-2xl font-bold text-charcoal">
              {new Date().toLocaleDateString(undefined, { weekday: "long" })}
            </h1>
            <p className="text-sm text-warm-gray">
              {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" })}
            </p>
          </div>

          {/* Task block */}
          <div className="rounded-2xl border p-4 mb-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>

            {tasks.length === 0 && (
              <p className="text-sm text-center py-4" style={{ color: "var(--text-2)" }}>No tasks yet — add some below.</p>
            )}

            {/* Undone tasks */}
            {undone.map(t => {
              const e = elapsed(t);
              const running = t.startedAt !== null;
              return (
                <div key={t.id} className="flex items-center gap-2 px-1 py-2 rounded-lg" style={{ background: "var(--bg)" }}>
                  <button onClick={() => toggleTask(t.id)}
                    className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                    style={{ border: "2px solid var(--border-3)" }} />
                  <span className="text-sm flex-1 break-words min-w-0 text-charcoal">{t.text}</span>
                  <span className="text-xs font-mono w-10 text-right flex-shrink-0" style={{ color: running ? "var(--purple)" : "#A8A29E" }}>
                    {e > 0 || running ? formatTime(e) : ""}
                  </span>
                  <button onClick={() => running ? stopTimer(t.id) : startTimer(t.id)}
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                    style={running ? { background: "var(--purple)" } : { background: "var(--border)" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={running ? "white" : "#78716C"} strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                  </button>
                </div>
              );
            })}

            {/* Done tasks */}
            {done.length > 0 && (
              <div className="mt-2 pt-2 space-y-1 border-t" style={{ borderColor: "var(--border-2)" }}>
                {done.map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-1 py-2 rounded-lg opacity-60">
                    <button onClick={() => toggleTask(t.id)}
                      className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                      style={{ background: "var(--purple)", border: "2px solid var(--purple)" }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                    </button>
                    <span className="text-sm flex-1 min-w-0 line-through text-warm-gray">{t.text}</span>
                    <span className="text-xs text-warm-gray flex-shrink-0">{formatTime(t.timeSpent)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add more tasks */}
          <button onClick={openAddMore}
            className="w-full text-sm font-medium py-3 rounded-2xl border mb-3 flex items-center justify-center gap-1.5 transition-colors hover:opacity-80"
            style={showAddMore
              ? { borderColor: "var(--purple)", color: "var(--purple)", background: "rgba(139,92,246,0.06)" }
              : { borderColor: "var(--border-3)", color: "var(--text-2)", background: "transparent" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add more tasks
          </button>

          {showAddMore && (
            <div className="rounded-2xl border p-4 space-y-3 mb-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              {/* New task input */}
              <div className="flex gap-2 items-center">
                <div className="flex-1 relative rounded-xl"
                  style={{ background: "var(--bg)", border: `2px solid ${addMoreText ? "var(--purple)" : "rgba(139,92,246,0.35)"}` }}>
                  {!addMoreText && (
                    <span className="absolute inset-0 flex items-center px-3 text-sm pointer-events-none font-medium" style={{ color: "var(--purple)", opacity: 0.6 }}>New task…</span>
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
              {/* My List */}
              {unassigned.length > 0 && (
                <>
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
                      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input type="text" value={addMoreSearch} onChange={e => setAddMoreSearch(e.target.value)} placeholder="Search My List…"
                      className="w-full text-sm rounded-xl pl-8 pr-3 py-2 focus:outline-none border"
                      style={{ background: "var(--bg)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }} />
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {(addMoreSearch ? unassigned.filter(t => t.text.toLowerCase().includes(addMoreSearch.toLowerCase())) : unassigned).map(t => (
                      <button key={t.id} onClick={() => importTask(t.id, t.text)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:opacity-80"
                        style={{ background: "var(--bg)", border: "1px solid var(--border-2)" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--purple)", flexShrink: 0 }}>
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span className="text-sm text-charcoal">{t.text}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Add a block — behavior TBD */}
          <button className="w-full text-sm font-medium py-3 rounded-2xl border border-dashed flex items-center justify-center gap-1.5 opacity-50"
            style={{ borderColor: "var(--border-3)", color: "var(--text-2)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add a block
          </button>
        </div>
      )}
    </div>
  );
}
