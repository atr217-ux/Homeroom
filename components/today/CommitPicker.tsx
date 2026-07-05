"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/utils/date";
import { getOrCreateTag, parseHashtags, stripHashtags, tagColor } from "@/lib/utils/tags";
import TaskInput from "@/components/TaskInput";
import type { Tag } from "@/lib/db/types";

type PickerTask = {
  id: string;
  text: string;
  isPrivate: boolean;
  tagIds: string[];
};

type Props = {
  userId: string;
  onCommitted: () => void; // re-fetch today's tasks after commit
};

export default function CommitPicker({ userId, onCommitted }: Props) {
  const [tasks, setTasks] = useState<PickerTask[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [commitment, setCommitment] = useState("");
  const [newTaskInput, setNewTaskInput] = useState("");
  const [showAll, setShowAll] = useState(false);

  const LIMIT = 10;
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const today = dateKey(new Date());
      const [tasksRes, tagsRes, commitmentRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, text, is_private, task_tags(tag_id)")
          .eq("user_id", userId)
          .eq("done", false)
          .order("created_at", { ascending: false })
          .limit(300),
        supabase.from("tags").select("id, name").eq("user_id", userId).order("name"),
        supabase
          .from("daily_commitments")
          .select("commitment")
          .eq("user_id", userId)
          .eq("date", today)
          .maybeSingle(),
      ]);
      setTasks((tasksRes.data ?? []).map((r) => ({
        id: r.id as string,
        text: r.text as string,
        isPrivate: (r.is_private as boolean) ?? false,
        tagIds: ((r.task_tags as { tag_id: string }[] | null) ?? []).map((tt) => tt.tag_id),
      })));
      setAllTags((tagsRes.data ?? []) as Tag[]);
      setCommitment((commitmentRes.data as { commitment: string } | null)?.commitment ?? "");
      setLoading(false);
    }
    load();

    function onOutside(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [userId]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (tagFilters.length > 0) {
      // OR semantics: a task matches if it has ANY of the selected tags
      list = list.filter((t) => tagFilters.some((id) => t.tagIds.includes(id)));
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((t) => t.text.toLowerCase().includes(q));
    }
    return list;
  }, [tasks, tagFilters, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addQuickTask() {
    const raw = newTaskInput.trim();
    if (!raw) return;
    const tagNames = parseHashtags(raw);
    const text = stripHashtags(raw);
    if (!text) return;
    setNewTaskInput("");

    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({ user_id: userId, text, done: false })
      .select("id")
      .single();
    if (!data) return;

    const tagObjs = (await Promise.all(tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
    if (tagObjs.length > 0) {
      await supabase.from("task_tags").insert(tagObjs.map((t) => ({ task_id: data.id, tag_id: t.id })));
    }

    const newId = data.id as string;
    setTasks((prev) => [
      { id: newId, text, isPrivate: false, tagIds: tagObjs.map((t) => t.id) },
      ...prev,
    ]);
    setSelected((prev) => new Set([newId, ...prev]));
    setAllTags((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      for (const t of tagObjs) map.set(t.id, t);
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function togglePrivate(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const next = !task.isPrivate;
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, isPrivate: next } : t));
    await createClient().from("tasks").update({ is_private: next }).eq("id", id);
  }

  async function saveCommitment(next: string) {
    const trimmed = next.trim();
    const today = dateKey(new Date());
    const supabase = createClient();
    await supabase.from("daily_commitments").upsert({
      user_id: userId,
      date: today,
      commitment: trimmed,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,date" });
  }

  async function commit() {
    if (selected.size === 0) {
      setToast("Pick at least one task to commit to");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setCommitting(true);
    const today = dateKey(new Date());
    const ids = Array.from(selected);
    const supabase = createClient();
    const [tasksRes] = await Promise.all([
      supabase.from("tasks").update({ committed_for_date: today }).in("id", ids),
      saveCommitment(commitment),
    ]);
    setCommitting(false);
    if (tasksRes.error) {
      setToast(tasksRes.error.message ?? "Could not save — try again");
      setTimeout(() => setToast(null), 4000);
      return;
    }
    onCommitted();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-10 pb-32">
      {/* Header */}
      <div className="pb-4">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-3 uppercase tracking-wide"
          style={{ background: "rgba(124,58,237,0.12)", color: "var(--purple)" }}
        >
          Today&apos;s Commitment
        </span>
        <h1
          className="font-display italic leading-tight"
          style={{ color: "var(--text)", fontSize: "clamp(2rem, 8vw, 3rem)" }}
        >
          What are you committing to accomplish today?
        </h1>
      </div>

      {/* Focus / intention */}
      <div className="mb-5">
        <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--purple)" }}>
          Today&apos;s focus <span className="font-normal opacity-70">(optional)</span>
        </label>
        <input
          type="text"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          onBlur={() => saveCommitment(commitment)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
          placeholder="e.g. Ship the launch email, rest and recharge…"
          maxLength={140}
          className="focus-input-purple w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none border transition-colors"
          style={{
            background: "var(--surface)",
            borderColor: commitment ? "var(--purple)" : "var(--border-2)",
            color: "var(--text)",
            fontSize: "16px",
          }}
        />
      </div>

      {/* Add a new task inline — commits when submitted, selected by default */}
      <div className="mb-2">
        <TaskInput
          value={newTaskInput}
          onChange={setNewTaskInput}
          onSubmit={addQuickTask}
          allTags={allTags}
          placeholder="Add a new task… (try #category)"
        />
      </div>

      {/* Search (compact) */}
      <div className="mb-3 relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          className="w-full rounded-full pl-7 pr-3 py-1 focus:outline-none border transition-colors"
          style={{
            background: "var(--surface)",
            borderColor: search ? "var(--purple)" : "var(--border-2)",
            color: "var(--text)",
            fontSize: "13px",
          }}
        />
      </div>

      {/* Tag filter */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {allTags.length > 0 && (
          <div ref={tagDropdownRef} className="relative">
            <button
              onClick={() => setTagDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-colors"
              style={tagFilters.length > 0
                ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
              </svg>
              {tagFilters.length > 0 ? `${tagFilters.length} tag${tagFilters.length > 1 ? "s" : ""}` : "Filter by category"}
              {tagFilters.length > 0 && (
                <span onClick={(e) => { e.stopPropagation(); setTagFilters([]); }} className="ml-1 opacity-70">
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
                      onClick={() => setTagFilters((prev) => checked ? prev.filter((i) => i !== tag.id) : [...prev, tag.id])}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
                      style={{ background: "var(--surface)" }}
                    >
                      <span
                        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2"
                        style={checked ? { background: "var(--purple)", borderColor: "var(--purple)" } : { borderColor: "var(--border-3)" }}
                      >
                        {checked && (
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5">
                            <polyline points="2 6 5 9 10 3" />
                          </svg>
                        )}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>
                        #{tag.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {selected.size > 0 && (
          <span
            className="text-xs font-medium px-2 py-1 rounded-full ml-auto"
            style={{ background: "rgba(124,58,237,0.1)", color: "var(--purple)" }}
          >
            {selected.size} selected
          </span>
        )}
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

      {/* Task list */}
      {!loading && (() => {
        // Auto-expand when searching or filtering so nothing hides behind the cap
        const isFiltering = !!search.trim() || tagFilters.length > 0;
        const visible = (showAll || isFiltering) ? filtered : filtered.slice(0, LIMIT);
        const hidden = filtered.length - visible.length;
        return (
        <div className="space-y-2 mb-4">
          {filtered.length === 0 && tasks.length === 0 && (
            <p className="text-sm text-center py-12" style={{ color: "var(--text-2)" }}>
              You don&apos;t have any open tasks yet — add some on the Tasks tab first.
            </p>
          )}
          {filtered.length === 0 && tasks.length > 0 && (
            <p className="text-sm text-center py-8" style={{ color: "var(--text-2)" }}>
              No tasks match your filters
            </p>
          )}
          {visible.map((task) => {
            const sel = selected.has(task.id);
            return (
              <div
                key={task.id}
                onClick={() => toggle(task.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(task.id); } }}
                className="w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left transition-all cursor-pointer"
                style={{
                  background: sel ? "rgba(124,58,237,0.06)" : "var(--surface)",
                  border: `1.5px solid ${sel ? "var(--purple)" : "var(--border-2)"}`,
                }}
              >
                <div
                  className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-0.5 transition-all"
                  style={sel
                    ? { background: "var(--purple)", border: "2px solid var(--purple)" }
                    : { border: "2px solid var(--border-3)" }}
                >
                  {sel && (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm leading-snug" style={{ color: sel ? "var(--text)" : "var(--text-2)" }}>
                    {task.text}
                  </span>
                  {task.tagIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {task.tagIds.map((tid) => {
                        const tag = allTags.find((t) => t.id === tid);
                        if (!tag) return null;
                        const { bg, fg } = tagColor(tag.name);
                        return (
                          <span key={tid} className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: bg, color: fg }}>
                            #{tag.name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Privacy toggle — tap to flip without changing selection */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); togglePrivate(task.id); }}
                  className="p-1 rounded flex-shrink-0 mt-0.5 transition-opacity hover:opacity-100"
                  style={{ color: task.isPrivate ? "var(--purple)" : "var(--text-3)", opacity: task.isPrivate ? 1 : 0.5 }}
                  title={task.isPrivate ? "Private — tap to make public" : "Public — tap to make private"}
                  aria-label={task.isPrivate ? "Make public" : "Make private"}
                >
                  {task.isPrivate ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
          {!isFiltering && hidden > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full text-xs font-medium py-2 rounded-xl border transition-colors"
              style={{ color: "var(--text-2)", borderColor: "var(--border-2)", background: "var(--surface)" }}
            >
              See all {filtered.length} tasks
            </button>
          )}
          {!isFiltering && showAll && filtered.length > LIMIT && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full text-xs font-medium py-2 rounded-xl border transition-colors"
              style={{ color: "var(--text-2)", borderColor: "var(--border-2)", background: "var(--surface)" }}
            >
              Show less
            </button>
          )}
        </div>
        );
      })()}

      {/* Commit button — fixed above bottom nav */}
      <div className="fixed bottom-24 left-0 right-0 px-4 max-w-2xl mx-auto z-30 pointer-events-none">
        <button
          onClick={commit}
          disabled={committing}
          className="w-full py-4 rounded-2xl text-base font-bold text-white shadow-lg flex items-center justify-center gap-2 disabled:opacity-60 pointer-events-auto"
          style={{ background: "var(--purple)" }}
        >
          {committing && (
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "white", borderTopColor: "transparent" }} />
          )}
          Commit{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg" style={{ background: "var(--text)" }}>
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
