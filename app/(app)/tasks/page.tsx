"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/utils/date";
import { getOrCreateTag, parseHashtags, stripHashtags, tagColor } from "@/lib/utils/tags";
import TaskInput from "@/components/TaskInput";
import TaskRow from "@/components/TaskRow";
import type { Tag } from "@/lib/db/types";

type Task = {
  id: string;
  text: string;
  done: boolean;
  isPrivate: boolean;
  inToday: boolean;
  tagIds: string[];
  createdAt: string;
};

export default function TasksPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [privacyFilter, setPrivacyFilter] = useState<"all" | "private" | "public">("all");
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // ── Initial load ───────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const today = dateKey(new Date());
      const [tasksRes, tagsRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, text, done, is_private, committed_for_date, created_at, task_tags(tag_id)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("tags")
          .select("id, name")
          .eq("user_id", user.id)
          .order("name", { ascending: true }),
      ]);

      const rows = tasksRes.data ?? [];
      setTasks(rows.map(r => ({
        id: r.id as string,
        text: r.text as string,
        done: r.done as boolean,
        isPrivate: (r.is_private as boolean) ?? false,
        inToday: (r.committed_for_date as string | null) === today,
        tagIds: ((r.task_tags as { tag_id: string }[] | null) ?? []).map(tt => tt.tag_id),
        createdAt: r.created_at as string,
      })));
      setAllTags((tagsRes.data ?? []) as Tag[]);
      setLoading(false);
    }
    init();

    function onOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // ── Add a task ─────────────────────────────────────────────────────────
  async function addTask() {
    const raw = input.trim();
    if (!raw || !userId) return;
    const tagNames = parseHashtags(raw);
    const text = stripHashtags(raw);
    if (!text) return;
    setInput("");

    const supabase = createClient();
    const { data: row } = await supabase
      .from("tasks")
      .insert({ user_id: userId, text, done: false })
      .select("id, created_at")
      .single();
    if (!row) return;

    const tagObjs = (await Promise.all(tagNames.map(n => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
    if (tagObjs.length > 0) {
      await supabase.from("task_tags").insert(tagObjs.map(t => ({ task_id: row.id, tag_id: t.id })));
    }

    setTasks(prev => [{
      id: row.id as string,
      text,
      done: false,
      isPrivate: false,
      inToday: false,
      tagIds: tagObjs.map(t => t.id),
      createdAt: row.created_at as string,
    }, ...prev]);
    setAllTags(prev => {
      const map = new Map(prev.map(t => [t.id, t]));
      for (const t of tagObjs) map.set(t.id, t);
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  // ── Mutations ──────────────────────────────────────────────────────────
  async function toggleDone(id: string) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const nowDone = !task.done;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: nowDone } : t));
    await createClient().from("tasks").update({
      done: nowDone,
      completed_at: nowDone ? new Date().toISOString() : null,
    }).eq("id", id);
  }

  async function togglePrivate(id: string) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const next = !task.isPrivate;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, isPrivate: next } : t));
    await createClient().from("tasks").update({ is_private: next }).eq("id", id);
  }

  async function toggleToday(id: string) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const next = !task.inToday;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, inToday: next } : t));
    await createClient()
      .from("tasks")
      .update({ committed_for_date: next ? dateKey(new Date()) : null })
      .eq("id", id);
  }

  async function saveTaskEdit(id: string, raw: string) {
    if (!userId) return;
    const tagNames = parseHashtags(raw);
    const text = stripHashtags(raw);
    if (!text) return;

    const supabase = createClient();
    setTasks(prev => prev.map(t => t.id === id ? { ...t, text } : t));
    await supabase.from("tasks").update({ text }).eq("id", id);

    if (tagNames.length > 0) {
      const tagObjs = (await Promise.all(tagNames.map(n => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
      const existing = tasks.find(t => t.id === id)?.tagIds ?? [];
      const newOnes = tagObjs.filter(t => !existing.includes(t.id));
      if (newOnes.length > 0) {
        await supabase.from("task_tags").insert(newOnes.map(t => ({ task_id: id, tag_id: t.id })));
        setTasks(prev => prev.map(t => t.id === id ? { ...t, tagIds: [...t.tagIds, ...newOnes.map(n => n.id)] } : t));
        setAllTags(prev => {
          const map = new Map(prev.map(t => [t.id, t]));
          for (const t of tagObjs) map.set(t.id, t);
          return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
      }
    }
  }

  async function deleteTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    await createClient().from("tasks").delete().eq("id", id);
  }

  async function removeTagFromTask(taskId: string, tagId: string) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, tagIds: t.tagIds.filter(id => id !== tagId) } : t));
    await createClient().from("task_tags").delete().eq("task_id", taskId).eq("tag_id", tagId);
  }

  // ── Filtering ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = tasks;
    if (privacyFilter !== "all") {
      list = list.filter(t => (privacyFilter === "private") === t.isPrivate);
    }
    if (tagFilters.length > 0) {
      list = list.filter(t => tagFilters.every(id => t.tagIds.includes(id)));
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(t => t.text.toLowerCase().includes(q));
    }
    return list;
  }, [tasks, privacyFilter, tagFilters, search]);

  const undoneFiltered = filtered.filter(t => !t.done);
  const doneFiltered = filtered.filter(t => t.done);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 pt-10 pb-32">
      {/* Header */}
      <div className="pb-6">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-3"
          style={{ background: "rgba(124,58,237,0.12)", color: "var(--purple)" }}
        >
          My List
        </span>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
          Tasks
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-2)" }}>
          Tip: type <span className="font-mono">#category</span> to tag a task. Lock icon = private.
        </p>
      </div>

      {/* Add task input */}
      <div className="mb-4">
        <TaskInput
          value={input}
          onChange={setInput}
          onSubmit={addTask}
          allTags={allTags}
        />
      </div>

      {/* Search */}
      <div className="mb-3 relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          className="w-full text-sm rounded-xl pl-8 pr-3 py-2.5 focus:outline-none border transition-colors"
          style={{
            background: "var(--surface)",
            borderColor: search ? "var(--purple)" : "var(--border-2)",
            color: "var(--text)",
            fontSize: "16px",
          }}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {allTags.length > 0 && (
          <div ref={tagDropdownRef} className="relative">
            <button
              onClick={() => setTagDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-colors"
              style={tagFilters.length > 0
                ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="8" y1="12" x2="16" y2="12" />
                <line x1="11" y1="18" x2="13" y2="18" />
              </svg>
              {tagFilters.length > 0 ? `${tagFilters.length} tag${tagFilters.length > 1 ? "s" : ""}` : "Filter by tag"}
              {tagFilters.length > 0 && (
                <span
                  onClick={(e) => { e.stopPropagation(); setTagFilters([]); }}
                  className="ml-1 opacity-70"
                >
                  ×
                </span>
              )}
            </button>
            {tagDropdownOpen && (
              <div
                className="absolute left-0 top-full mt-1 z-20 border rounded-xl shadow-md overflow-hidden min-w-[180px] max-h-72 overflow-y-auto"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                {allTags.map((tag) => {
                  const { bg, fg } = tagColor(tag.name);
                  const checked = tagFilters.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() =>
                        setTagFilters(prev =>
                          checked ? prev.filter(i => i !== tag.id) : [...prev, tag.id]
                        )
                      }
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                      style={{ background: "var(--surface)" }}
                    >
                      <span
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2"
                        style={checked
                          ? { background: "var(--purple)", borderColor: "var(--purple)" }
                          : { borderColor: "var(--border-3)" }}
                      >
                        {checked && (
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5">
                            <polyline points="2 6 5 9 10 3" />
                          </svg>
                        )}
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: bg, color: fg }}
                      >
                        #{tag.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button
          onClick={() =>
            setPrivacyFilter((p) => (p === "all" ? "private" : p === "private" ? "public" : "all"))
          }
          className="text-xs px-3 py-1.5 rounded-full border font-medium transition-colors"
          style={privacyFilter !== "all"
            ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
            : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
        >
          {privacyFilter === "all" ? "All" : privacyFilter === "private" ? "Private only" : "Public only"}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center pt-12">
          <div
            className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && tasks.length === 0 && (
        <p className="text-sm text-center py-12" style={{ color: "var(--text-2)" }}>
          Your list is empty — add a task above
        </p>
      )}

      {/* Undone tasks */}
      {!loading && undoneFiltered.length > 0 && (
        <div className="space-y-2 mb-6">
          {undoneFiltered.map((task) => (
            <TaskRow
              key={task.id}
              text={task.text}
              done={task.done}
              isPrivate={task.isPrivate}
              tags={task.tagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean) as Tag[]}
              onToggle={() => toggleDone(task.id)}
              onSave={(t) => saveTaskEdit(task.id, t)}
              onDelete={() => deleteTask(task.id)}
              onTogglePrivate={() => togglePrivate(task.id)}
              onToggleToday={() => toggleToday(task.id)}
              inToday={task.inToday}
              onRemoveTag={(tagId) => removeTagFromTask(task.id, tagId)}
            />
          ))}
        </div>
      )}

      {/* No filtered results */}
      {!loading && tasks.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: "var(--text-2)" }}>
          No tasks match your filters
        </p>
      )}

      {/* Done section toggle */}
      {!loading && doneFiltered.length > 0 && (
        <div>
          <button
            onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold mb-2"
            style={{ color: "var(--text-2)" }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              style={{ transform: showDone ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Done ({doneFiltered.length})
          </button>

          {showDone && (
            <div className="space-y-2">
              {doneFiltered.map((task) => (
                <TaskRow
                  key={task.id}
                  text={task.text}
                  done={task.done}
                  isPrivate={task.isPrivate}
                  tags={task.tagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean) as Tag[]}
                  onToggle={() => toggleDone(task.id)}
                  onSave={(t) => saveTaskEdit(task.id, t)}
                  onDelete={() => deleteTask(task.id)}
                  onTogglePrivate={() => togglePrivate(task.id)}
                  onToggleToday={() => toggleToday(task.id)}
                  inToday={task.inToday}
                  onRemoveTag={(tagId) => removeTagFromTask(task.id, tagId)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
