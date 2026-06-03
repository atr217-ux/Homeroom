"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type Block = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  position: number;
  is_live: boolean;
  visibility: string;
};

type BlockTask = { id: string; text: string; done: boolean; completed_at: string | null };

type Tag = { id: string; name: string };
type SetupTask = { id: string; text: string; fromBlock?: string; tagIds: string[]; created_at: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAG_COLORS = ["#7C3AED","#0891B2","#059669","#D97706","#DC2626","#DB2777","#65A30D","#0284C7"];
function tagColor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const c = TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
  return { bg: c + "22", fg: c };
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TodayPage() {
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);

  // Setup flow
  const [setupPhase, setSetupPhase] = useState<"loading" | "tasks" | null>("loading");
  const [setupTasks, setSetupTasks] = useState<SetupTask[]>([]);
  const [setupSearch, setSetupSearch] = useState("");
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [taskSortDir, setTaskSortDir] = useState<"none" | "asc" | "desc">("none");
  const [showAllTasks, setShowAllTasks] = useState(false);
  const TASK_LIMIT = 10;
  const [committedIds, setCommittedIds] = useState<Set<string>>(new Set());
  const [finishing, setFinishing] = useState(false);

  // Regular view
  const [todayBlocks, setTodayBlocks] = useState<Block[]>([]);
  const [blockTasks, setBlockTasks] = useState<Record<string, BlockTask[]>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [showAddMore, setShowAddMore] = useState(false);
  const [addMoreSearch, setAddMoreSearch] = useState("");
  const [unassignedTasks, setUnassignedTasks] = useState<{ id: string; text: string }[]>([]);
  const [newTaskInput, setNewTaskInput] = useState("");
  const newTaskInputRef = useRef<HTMLDivElement | null>(null);

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const a = localStorage.getItem("homeroom-avatar");
    if (a) setAvatar(a);

    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMyUserId(user.id);

      const todayDate = dateKey(new Date());
      const setupDate = localStorage.getItem("homeroom-today-setup-date");
      if (setupDate !== todayDate) {
        await loadSetupTasks(user.id);
        setSetupPhase("tasks");
      } else {
        await loadTodayBlocksData(user.id);
        setSetupPhase(null);
      }
    }

    init();

    function onClickOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Setup: load tasks ──────────────────────────────────────────────────────

  async function loadSetupTasks(userId: string) {
    const supabase = createClient();
    const todayDate = dateKey(new Date());

    const { data: allTasks, error } = await supabase
      .from("tasks")
      .select("id, text, created_at")
      .eq("user_id", userId)
      .eq("done", false)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error || !allTasks) {
      setSetupTasks([]);
      setCommittedIds(new Set());
      return;
    }

    const taskIds = allTasks.map(t => t.id);

    const [tagsResult, taskTagsResult] = await Promise.allSettled([
      supabase.from("tags").select("id, name").eq("user_id", userId),
      taskIds.length > 0
        ? supabase.from("task_tags").select("task_id, tag_id").in("task_id", taskIds)
        : Promise.resolve({ data: [] }),
    ]);
    const tagsData = tagsResult.status === "fulfilled" ? (tagsResult.value.data ?? []) : [];
    const taskTagsData = taskTagsResult.status === "fulfilled"
      ? ((taskTagsResult.value as { data: { task_id: string; tag_id: string }[] | null }).data ?? [])
      : [];
    setAllTags(tagsData as Tag[]);
    const taskTagMap: Record<string, string[]> = {};
    for (const r of taskTagsData) {
      if (!taskTagMap[r.task_id]) taskTagMap[r.task_id] = [];
      taskTagMap[r.task_id].push(r.tag_id);
    }

    const blockLabels: Record<string, string> = {};
    try {
      const { data: priorBlocks } = await supabase
        .from("blocks")
        .select("id, name")
        .eq("user_id", userId)
        .lt("date", todayDate)
        .order("date", { ascending: false })
        .limit(5);
      if (priorBlocks && priorBlocks.length > 0) {
        const nameMap = Object.fromEntries(priorBlocks.map(b => [b.id, b.name as string]));
        const { data: priorTasks } = await supabase
          .from("tasks")
          .select("id, block_id")
          .in("block_id", priorBlocks.map(b => b.id))
          .eq("done", false);
        for (const t of (priorTasks ?? [])) {
          blockLabels[t.id] = `From: ${nameMap[t.block_id] ?? "Block"}`;
        }
      }
    } catch { /* blocks migration may not exist yet */ }

    const combined: SetupTask[] = allTasks.map(t => ({
      id: t.id,
      text: t.text,
      created_at: t.created_at as string,
      tagIds: taskTagMap[t.id] ?? [],
      fromBlock: blockLabels[t.id],
    }));
    setSetupTasks(combined);
    setCommittedIds(new Set(combined.map(t => t.id)));
  }

  // ── Setup: commit ─────────────────────────────────────────────────────────

  async function finishSetup() {
    if (!myUserId) return;
    setFinishing(true);
    const supabase = createClient();
    const todayDate = dateKey(new Date());

    const { data: todayBlock } = await supabase
      .from("blocks")
      .insert({ user_id: myUserId, date: todayDate, name: "Today", position: 0, visibility: "private" })
      .select("id")
      .single();

    if (todayBlock && committedIds.size > 0) {
      await supabase.from("tasks").update({ block_id: todayBlock.id }).in("id", [...committedIds]);
    }

    localStorage.setItem("homeroom-today-setup-date", todayDate);
    await loadTodayBlocksData(myUserId);
    setSetupPhase(null);
    setFinishing(false);
  }

  // ── Regular view: load blocks ──────────────────────────────────────────────

  async function loadTodayBlocksData(userId: string) {
    const supabase = createClient();
    const todayDate = dateKey(new Date());

    const { data: blocks } = await supabase
      .from("blocks")
      .select("id, name, date, start_time, end_time, position, is_live, visibility")
      .eq("user_id", userId)
      .eq("date", todayDate)
      .order("position", { ascending: true });

    setTodayBlocks((blocks ?? []) as Block[]);

    const blockIds = (blocks ?? []).map(b => b.id);
    if (blockIds.length > 0) {
      const { data: tasksWithBlock } = await supabase
        .from("tasks")
        .select("id, text, done, completed_at, block_id")
        .in("block_id", blockIds)
        .order("created_at", { ascending: true });
      const grouped: Record<string, BlockTask[]> = {};
      for (const b of blockIds) grouped[b] = [];
      for (const t of (tasksWithBlock ?? [])) {
        if (t.block_id && grouped[t.block_id]) {
          grouped[t.block_id].push({ id: t.id, text: t.text, done: t.done, completed_at: t.completed_at });
        }
      }
      setBlockTasks(grouped);
    }
  }

  // ── Task toggle ────────────────────────────────────────────────────────────

  async function toggleTask(taskId: string, currentDone: boolean) {
    const nowDone = !currentDone;
    setBlockTasks(prev => {
      const next = { ...prev };
      for (const blockId of Object.keys(next)) {
        next[blockId] = next[blockId].map(t =>
          t.id === taskId ? { ...t, done: nowDone, completed_at: nowDone ? new Date().toISOString() : null } : t
        );
      }
      return next;
    });
    await createClient()
      .from("tasks")
      .update({ done: nowDone, completed_at: nowDone ? new Date().toISOString() : null })
      .eq("id", taskId);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function loadUnassignedTasks() {
    if (!myUserId) return;
    const alreadyInToday = new Set(
      todayBlocks.flatMap(b => (blockTasks[b.id] ?? []).map(t => t.id))
    );
    const { data } = await createClient()
      .from("tasks")
      .select("id, text")
      .eq("user_id", myUserId)
      .eq("done", false)
      .order("created_at", { ascending: false })
      .limit(100);
    setUnassignedTasks((data ?? []).filter(t => !alreadyInToday.has(t.id)));
  }

  async function addNewTask(text: string) {
    if (!text.trim() || !myUserId || todayBlocks.length === 0) return;
    const blockId = todayBlocks[0].id;
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({ user_id: myUserId, text: text.trim(), done: false, block_id: blockId })
      .select("id, text, done, completed_at")
      .single();
    if (data) {
      setBlockTasks(prev => ({
        ...prev,
        [blockId]: [...(prev[blockId] ?? []), { id: data.id, text: data.text, done: data.done, completed_at: data.completed_at }],
      }));
      setNewTaskInput("");
      if (newTaskInputRef.current) newTaskInputRef.current.innerHTML = "";
    }
  }

  async function importTask(taskId: string, text: string) {
    if (todayBlocks.length === 0) return;
    const blockId = todayBlocks[0].id;
    await createClient().from("tasks").update({ block_id: blockId }).eq("id", taskId);
    setBlockTasks(prev => ({
      ...prev,
      [blockId]: [...(prev[blockId] ?? []), { id: taskId, text, done: false, completed_at: null }],
    }));
    setUnassignedTasks(prev => prev.filter(t => t.id !== taskId));
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  const tagFilteredSetupTasks = tagFilters.length > 0
    ? setupTasks.filter(t => tagFilters.every(id => t.tagIds.includes(id)))
    : setupTasks;
  const searchedSetupTasks = setupSearch.trim()
    ? tagFilteredSetupTasks.filter(t => t.text.toLowerCase().includes(setupSearch.toLowerCase().trim()))
    : tagFilteredSetupTasks;
  const filteredSetupTasks = taskSortDir === "none"
    ? searchedSetupTasks
    : [...searchedSetupTasks].sort((a, b) => {
        const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return taskSortDir === "asc" ? diff : -diff;
      });

  const allTodayTasks = todayBlocks.flatMap(b => blockTasks[b.id] ?? []);

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 pb-24">

      {/* Loading */}
      {setupPhase === "loading" && (
        <div className="flex items-center justify-center pt-32">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }} />
        </div>
      )}

      {/* ── Setup: Task Selection ──────────────────────────────────────────── */}
      {setupPhase === "tasks" && (
        <div>
          <div className="pt-10 pb-6">
            <h1 className="text-2xl font-bold text-charcoal">What tasks are you committing to today?</h1>
          </div>

          {/* Search bar */}
          <div className="mb-3 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-2)" }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={setupSearch}
              onChange={e => setSetupSearch(e.target.value)}
              placeholder="Search tasks…"
              className="w-full text-sm rounded-xl pl-8 pr-3 py-2 focus:outline-none border"
              style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
            />
          </div>

          {/* Tag filter + sort row */}
          <div className="flex items-center gap-2 mb-4">
            {allTags.length > 0 && (
              <div ref={tagDropdownRef} className="relative">
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
                    <span onClick={e => { e.stopPropagation(); setTagFilters([]); }} className="ml-1 opacity-70 hover:opacity-100">×</span>
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
                          <span className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 transition-colors"
                            style={checked ? { background: "var(--purple)", borderColor: "var(--purple)" } : { borderColor: "#D1D5DB" }}>
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
            <button
              onClick={() => setTaskSortDir(d => d === "none" ? "desc" : d === "desc" ? "asc" : "none")}
              className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border font-medium transition-colors flex-shrink-0"
              style={taskSortDir !== "none"
                ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
            >
              Date added {taskSortDir === "asc" ? "↑" : taskSortDir === "desc" ? "↓" : ""}
            </button>
          </div>

          {setupTasks.length === 0 ? (
            <div className="mb-8">
              <p className="text-sm text-warm-gray mb-4">Your list is empty — add tasks in My List first.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={() => setCommittedIds(new Set(setupTasks.map(t => t.id)))}
                  className="text-xs font-semibold"
                  style={{ color: "var(--purple)" }}
                >
                  Select all
                </button>
                <button
                  onClick={() => setCommittedIds(new Set())}
                  className="text-xs font-semibold"
                  style={{ color: "var(--text-2)" }}
                >
                  Clear
                </button>
                {setupSearch && (
                  <span className="text-xs ml-auto" style={{ color: "var(--text-2)" }}>
                    {filteredSetupTasks.length} result{filteredSetupTasks.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="space-y-2 mb-8">
                {(showAllTasks ? filteredSetupTasks : filteredSetupTasks.slice(0, TASK_LIMIT)).map(task => {
                  const checked = committedIds.has(task.id);
                  return (
                    <button
                      key={task.id}
                      onClick={() => setCommittedIds(prev => {
                        const s = new Set(prev);
                        s.has(task.id) ? s.delete(task.id) : s.add(task.id);
                        return s;
                      })}
                      className="w-full flex items-start gap-2 px-3 py-2.5 rounded-xl text-left transition-all"
                      style={{
                        background: "var(--surface)",
                        border: `1px solid ${checked ? "var(--purple)" : "var(--border-2)"}`,
                      }}
                    >
                      <div
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-0.5 transition-colors"
                        style={checked ? { background: "var(--purple)", border: "2px solid var(--purple)" } : { border: "2px solid var(--border-3)" }}
                      >
                        {checked && (
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-charcoal leading-snug">{task.text}</span>
                        {task.created_at && (
                          <span className="block text-xs mt-0.5" style={{ color: "var(--text-2)" }}>
                            {new Date(task.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        )}
                        {(task.fromBlock || task.tagIds.length > 0) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {task.fromBlock && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--border-2)", color: "var(--text-2)" }}>{task.fromBlock}</span>
                            )}
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
                {filteredSetupTasks.length > TASK_LIMIT && (
                  <button
                    onClick={() => setShowAllTasks(v => !v)}
                    className="w-full text-xs font-medium py-2 rounded-xl border transition-colors"
                    style={{ color: "var(--text-2)", borderColor: "var(--border-2)", background: "var(--surface)" }}
                  >
                    {showAllTasks ? "Show less" : `Show all ${filteredSetupTasks.length} tasks`}
                  </button>
                )}
                {filteredSetupTasks.length === 0 && (setupSearch || tagFilters.length > 0) && (
                  <p className="text-sm text-center py-6" style={{ color: "var(--text-2)" }}>No tasks match your filters</p>
                )}
              </div>
            </>
          )}

          {/* Sticky Commit button */}
          <div className="fixed bottom-20 left-0 right-0 px-4 max-w-2xl mx-auto">
            <button
              onClick={finishSetup}
              disabled={finishing}
              className="w-full py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
              style={{ background: "var(--purple)" }}
            >
              {finishing && (
                <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "white", borderTopColor: "transparent" }} />
              )}
              Commit{committedIds.size > 0 ? ` (${committedIds.size})` : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Regular view ─────────────────────────────────────────────────────── */}
      {setupPhase === null && (
        <div>
          {/* Header */}
          <div className="pt-8 pb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
              <Link href="/profile" className="w-8 h-8 rounded-full flex items-center justify-center text-lg overflow-hidden" style={{ background: avatar ? "var(--border)" : "#7C9E87" }}>
                {avatar ?? <span className="text-white text-xs font-semibold">?</span>}
              </Link>
            </div>
            <h1 className="text-2xl font-bold text-charcoal leading-snug">
              {new Date().toLocaleDateString(undefined, { weekday: "long" })}
            </h1>
            <p className="text-sm text-warm-gray">
              {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" })}
            </p>
          </div>

          {/* Committed task list */}
          {allTodayTasks.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: "var(--text-2)" }}>No tasks committed for today.</p>
          ) : (
            <div className="space-y-2 mb-6">
              {allTodayTasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}
                >
                  <button
                    onClick={() => toggleTask(task.id, task.done)}
                    className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center transition-colors"
                    style={task.done
                      ? { background: "var(--purple)", border: "2px solid var(--purple)" }
                      : { border: "2px solid var(--border-3)" }}
                  >
                    {task.done && (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                  <span className={`text-sm flex-1 break-words min-w-0 ${task.done ? "line-through text-warm-gray" : "text-charcoal"}`}>
                    {task.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Add more tasks */}
          <div className="mb-4">
            <button
              onClick={() => {
                if (!showAddMore) loadUnassignedTasks();
                setShowAddMore(v => !v);
                setAddMoreSearch("");
                setNewTaskInput("");
                if (newTaskInputRef.current) newTaskInputRef.current.innerHTML = "";
              }}
              className="w-full text-sm font-medium py-3 rounded-2xl border transition-colors hover:opacity-80 flex items-center justify-center gap-1.5"
              style={showAddMore
                ? { borderColor: "var(--purple)", color: "var(--purple)", background: "rgba(139,92,246,0.06)" }
                : { borderColor: "var(--border-3)", color: "var(--text-2)", background: "transparent" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add more tasks
            </button>

            {showAddMore && (
              <div className="mt-2 rounded-2xl border p-4 space-y-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                {/* New task input */}
                <div className="flex gap-2 items-center">
                  <div
                    className="flex-1 relative rounded-xl"
                    style={{ background: "var(--bg)", border: `2px solid ${newTaskInput ? "var(--purple)" : "rgba(139,92,246,0.35)"}` }}
                  >
                    {!newTaskInput && (
                      <span className="absolute inset-0 flex items-center px-3 text-sm pointer-events-none font-medium" style={{ color: "var(--purple)", opacity: 0.6 }}>
                        New task…
                      </span>
                    )}
                    <div
                      ref={newTaskInputRef}
                      contentEditable
                      suppressContentEditableWarning
                      role="textbox"
                      onInput={() => {
                        const el = newTaskInputRef.current;
                        if (!el) return;
                        setNewTaskInput(el.innerText.replace(/\n/g, ""));
                      }}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNewTask(newTaskInput); } }}
                      onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }} // eslint-disable-line
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      className="w-full px-3 py-2.5 focus:outline-none"
                      style={{ color: "var(--text)", outline: "none", fontSize: "16px" } as React.CSSProperties}
                    />
                  </div>
                  <button
                    onClick={() => addNewTask(newTaskInput)}
                    style={{ color: "var(--purple)" }}
                    className="flex-shrink-0 hover:opacity-70 transition-opacity"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
                    </svg>
                  </button>
                </div>

                {/* My List tasks to pull from */}
                {unassignedTasks.length > 0 && (
                  <>
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-2)" }}>
                        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                      </svg>
                      <input
                        type="text"
                        value={addMoreSearch}
                        onChange={e => setAddMoreSearch(e.target.value)}
                        placeholder="Search My List…"
                        className="w-full text-sm rounded-xl pl-8 pr-3 py-2 focus:outline-none border"
                        style={{ background: "var(--bg)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
                      />
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {(addMoreSearch
                        ? unassignedTasks.filter(t => t.text.toLowerCase().includes(addMoreSearch.toLowerCase()))
                        : unassignedTasks
                      ).map(task => (
                        <button
                          key={task.id}
                          onClick={() => importTask(task.id, task.text)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors hover:opacity-80"
                          style={{ background: "var(--bg)", border: "1px solid var(--border-2)" }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--purple)", flexShrink: 0 }}>
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                          <span className="text-sm text-charcoal">{task.text}</span>
                        </button>
                      ))}
                      {addMoreSearch && unassignedTasks.filter(t => t.text.toLowerCase().includes(addMoreSearch.toLowerCase())).length === 0 && (
                        <p className="text-xs text-center py-3" style={{ color: "var(--text-2)" }}>No results</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Add a block */}
          <button
            onClick={() => showToast("Coming soon")}
            className="w-full text-sm font-medium py-3 rounded-2xl border border-dashed transition-colors hover:opacity-70 flex items-center justify-center gap-1.5"
            style={{ borderColor: "var(--border-3)", color: "var(--text-2)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add a block
          </button>
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
