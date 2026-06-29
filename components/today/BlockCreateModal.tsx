"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/utils/date";
import { getOrCreateTag, parseHashtags, stripHashtags, tagColor } from "@/lib/utils/tags";
import type { Tag } from "@/lib/db/types";

type FriendOption = { id: string; username: string; avatar: string | null };
type TaskOption = { id: string; text: string; isPrivate: boolean; tagIds: string[]; committedToday: boolean };

type Props = {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
};

export default function BlockCreateModal({ userId, onClose, onCreated }: Props) {
  const today = dateKey(new Date());
  // Default times: next hour rounded up to :00, +1h
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }, []);
  const defaultEnd = useMemo(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 2);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }, []);

  const [name, setName] = useState("Focus block");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);

  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [taskSearch, setTaskSearch] = useState("");

  const [newTaskInput, setNewTaskInput] = useState("");
  const [extraTasks, setExtraTasks] = useState<{ text: string; tagNames: string[] }[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load friends + tasks ───────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      // Friends
      const { data: fr } = await supabase
        .from("friendships")
        .select("user_a, user_b")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`);
      const friendIds = (fr ?? []).map((f) => (f.user_a === userId ? f.user_b : f.user_a)) as string[];
      let friendProfiles: FriendOption[] = [];
      if (friendIds.length > 0) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, username, avatar")
          .in("id", friendIds);
        friendProfiles = ((ps as FriendOption[] | null) ?? []);
      }
      setFriends(friendProfiles);

      // Tasks: open tasks (not done) + tags
      const [taskRes, tagsRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, text, is_private, committed_for_date, task_tags(tag_id)")
          .eq("user_id", userId)
          .eq("done", false)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("tags").select("id, name").eq("user_id", userId).order("name"),
      ]);
      setTasks(((taskRes.data ?? []) as { id: string; text: string; is_private: boolean; committed_for_date: string | null; task_tags: { tag_id: string }[] | null }[]).map((r) => ({
        id: r.id,
        text: r.text,
        isPrivate: r.is_private ?? false,
        tagIds: (r.task_tags ?? []).map((tt) => tt.tag_id),
        committedToday: r.committed_for_date === today,
      })));
      setAllTags((tagsRes.data ?? []) as Tag[]);
    }
    load();
  }, [userId, today]);

  function toggleFriend(id: string) {
    setInvitedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePick(id: string) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addExtra() {
    const raw = newTaskInput.trim();
    if (!raw) return;
    const text = stripHashtags(raw);
    const tagNames = parseHashtags(raw);
    if (!text) return;
    setExtraTasks((prev) => [...prev, { text, tagNames }]);
    setNewTaskInput("");
  }

  function removeExtra(idx: number) {
    setExtraTasks((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Save ───────────────────────────────────────────────────────────────
  async function save() {
    setError(null);
    if (!name.trim()) { setError("Give the block a name"); return; }
    if (!startTime || !endTime) { setError("Pick start and end times"); return; }
    if (startTime >= endTime) { setError("End time must be after start time"); return; }
    setSaving(true);

    const supabase = createClient();
    const visibility = invitedIds.size > 0 ? "shared" : "private";

    const { data: block, error: blockErr } = await supabase
      .from("blocks")
      .insert({
        user_id: userId,
        date,
        name: name.trim(),
        start_time: startTime,
        end_time: endTime,
        visibility,
        position: 0,
      })
      .select("id")
      .single();

    if (blockErr || !block) {
      setError(blockErr?.message ?? "Could not create block");
      setSaving(false);
      return;
    }

    // Invite friends
    if (invitedIds.size > 0) {
      await supabase.from("block_invites").insert(
        Array.from(invitedIds).map((id) => ({ block_id: block.id, invited_user_id: id, status: "invited" as const })),
      );
    }

    // Attach picked existing tasks
    const pickedArr = Array.from(pickedIds);
    if (pickedArr.length > 0) {
      await supabase
        .from("tasks")
        .update({ block_id: block.id, committed_for_date: date })
        .in("id", pickedArr);
    }

    // Create extra new tasks under this block
    for (const extra of extraTasks) {
      const { data: t } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          text: extra.text,
          done: false,
          block_id: block.id,
          committed_for_date: date,
        })
        .select("id")
        .single();
      if (t && extra.tagNames.length > 0) {
        const tagObjs = (await Promise.all(extra.tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
        if (tagObjs.length > 0) {
          await supabase.from("task_tags").insert(tagObjs.map((tg) => ({ task_id: t.id, tag_id: tg.id })));
        }
      }
    }

    setSaving(false);
    onCreated();
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const filteredTasks = taskSearch.trim()
    ? tasks.filter((t) => t.text.toLowerCase().includes(taskSearch.toLowerCase().trim()))
    : tasks;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Sticky header */}
      <header
        className="flex items-center justify-between px-4 py-3 border-b sticky top-0 z-10"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <button
          onClick={onClose}
          className="text-sm font-medium px-3 py-1.5 rounded-lg"
          style={{ color: "var(--text-2)" }}
        >
          Cancel
        </button>
        <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Schedule block</h2>
        <button
          onClick={save}
          disabled={saving}
          className="text-sm font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
          style={{ background: "var(--purple)" }}
        >
          {saving ? "…" : "Create"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>
              Block name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none border"
              style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
            />
          </div>

          {/* Date + times */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none border"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>Start</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none border"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>End</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none border"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
              />
            </div>
          </div>

          {/* Friends */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>
              Invite friends {invitedIds.size > 0 && `(${invitedIds.size})`}
            </label>
            {friends.length === 0 ? (
              <div className="text-sm rounded-xl px-3 py-3 border text-center" style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}>
                You don&apos;t have any friends yet — add them on the Profile tab.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {friends.map((f) => {
                  const sel = invitedIds.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleFriend(f.id)}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border font-medium transition-colors"
                      style={sel
                        ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                        : { background: "var(--surface)", color: "var(--text)", borderColor: "var(--border-2)" }}
                    >
                      <span>{f.avatar ?? "🙂"}</span>
                      <span>{f.username}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pick existing tasks */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>
              Pick tasks for this block {pickedIds.size > 0 && `(${pickedIds.size})`}
            </label>

            <div className="relative mb-2">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--text-2)" }}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                placeholder="Search your tasks…"
                className="w-full text-sm rounded-xl pl-8 pr-3 py-2 focus:outline-none border"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
              />
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {filteredTasks.length === 0 && (
                <p className="text-xs text-center py-2" style={{ color: "var(--text-2)" }}>
                  {tasks.length === 0 ? "No open tasks yet" : "No tasks match"}
                </p>
              )}
              {filteredTasks.map((t) => {
                const sel = pickedIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => togglePick(t.id)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                    style={{
                      background: sel ? "rgba(124,58,237,0.06)" : "var(--surface)",
                      border: `1.5px solid ${sel ? "var(--purple)" : "var(--border-2)"}`,
                    }}
                  >
                    <div
                      className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-0.5"
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
                      <span className="text-sm" style={{ color: "var(--text)" }}>{t.text}</span>
                      {t.tagIds.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {t.tagIds.map((tid) => {
                            const tag = allTags.find((tg) => tg.id === tid);
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
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add brand-new tasks */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--text-2)" }}>
              Add new tasks
            </label>

            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={newTaskInput}
                onChange={(e) => setNewTaskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }}
                placeholder="New task… (try #category)"
                className="flex-1 text-sm rounded-xl px-3 py-2.5 focus:outline-none border"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
              />
              <button
                onClick={addExtra}
                className="px-3 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "var(--purple)", color: "white" }}
              >
                Add
              </button>
            </div>

            {extraTasks.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {extraTasks.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(124,58,237,0.06)", border: "1px solid var(--purple)" }}
                  >
                    <span className="text-sm flex-1" style={{ color: "var(--text)" }}>
                      {t.text}
                      {t.tagNames.map((n) => ` #${n}`).join("")}
                    </span>
                    <button
                      onClick={() => removeExtra(i)}
                      className="p-1 rounded transition-opacity hover:opacity-100"
                      style={{ color: "var(--text-2)", opacity: 0.7 }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div
              className="text-sm rounded-xl px-3 py-2.5 border"
              style={{ background: "rgba(220,38,38,0.08)", borderColor: "rgba(220,38,38,0.3)", color: "var(--red)" }}
            >
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
