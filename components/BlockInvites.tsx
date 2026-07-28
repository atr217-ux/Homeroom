"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrCreateTag, parseHashtags, stripHashtags } from "@/lib/utils/tags";
import type { Tag } from "@/lib/db/types";

type Participant = { id: string; username: string; avatar: string | null };

type InviteRow = {
  inviteId: string; // synthetic key: `${blockId}:${userId}`
  blockId: string;
  blockName: string;
  date: string;   // YYYY-MM-DD
  startTime: string; // HH:MM[:SS]
  endTime: string;
  hostId: string;
  myStatus: "invited" | "joined" | "declined";
  invitees: { profile: Participant; status: string }[]; // excludes host
  host: Participant | null;
};

type Props = { userId: string };

type AvailableTask = { id: string; text: string; tagIds: string[]; isPrivate: boolean };

function formatTime12h(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatDatePill(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function BlockInvites({ userId }: Props) {
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Per-block toggles that apply to whatever the user adds next (typed
  // task or one pulled from the list).
  const [taskFlags, setTaskFlags] = useState<Record<string, { priv: boolean; shared: boolean }>>({});
  // Per-block: whether the "Add from my list" panel is expanded, the loaded
  // available tasks, and the current search query.
  const [listOpen, setListOpen] = useState<Set<string>>(new Set());
  const [available, setAvailable] = useState<Record<string, AvailableTask[]>>({});
  const [listSearch, setListSearch] = useState<Record<string, string>>({});

  function flagsFor(blockId: string) {
    return taskFlags[blockId] ?? { priv: false, shared: false };
  }
  function toggleFlag(blockId: string, key: "priv" | "shared") {
    setTaskFlags((prev) => {
      const cur = prev[blockId] ?? { priv: false, shared: false };
      return { ...prev, [blockId]: { ...cur, [key]: !cur[key] } };
    });
  }

  async function openList(blockId: string) {
    setListOpen((prev) => { const n = new Set(prev); n.add(blockId); return n; });
    // Load only the user's own undone tasks that aren't already attached
    // to a block — those are the ones eligible to be pulled in.
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .select("id, text, is_private, block_id, task_tags(tag_id)")
      .eq("user_id", userId)
      .eq("done", false)
      .order("created_at", { ascending: false })
      .limit(200);
    const rowsData = ((data ?? []) as { id: string; text: string; is_private: boolean | null; block_id: string | null; task_tags: { tag_id: string }[] | null }[])
      .filter((r) => !r.block_id)
      .map((r) => ({
        id: r.id,
        text: r.text,
        isPrivate: r.is_private ?? false,
        tagIds: (r.task_tags ?? []).map((tt) => tt.tag_id),
      }));
    setAvailable((prev) => ({ ...prev, [blockId]: rowsData }));
  }
  function closeList(blockId: string) {
    setListOpen((prev) => { const n = new Set(prev); n.delete(blockId); return n; });
  }

  async function load() {
    const supabase = createClient();
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Show pending or already-joined invites for upcoming (today or future)
    // blocks. Declined invites drop off the list.
    const { data: myInvites } = await supabase
      .from("block_invites")
      .select("block_id, status, blocks(id, name, date, start_time, end_time, user_id)")
      .eq("invited_user_id", userId)
      .in("status", ["invited", "joined"])
      .order("block_id", { ascending: false });

    type BlockRel = { id: string; name: string; date: string; start_time: string; end_time: string; user_id: string };
    const invites = ((myInvites ?? []) as { block_id: string; status: string; blocks: BlockRel | BlockRel[] | null }[])
      .map((r) => {
        const b = Array.isArray(r.blocks) ? r.blocks[0] : r.blocks;
        return b ? { blockId: r.block_id, status: r.status, block: b } : null;
      })
      .filter((x): x is { blockId: string; status: string; block: BlockRel } => x !== null && x.block.date >= todayKey);

    if (invites.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    // Fetch every invite row for these blocks so we can render the full
    // attendee list with each person's status.
    const blockIds = invites.map((i) => i.blockId);
    const { data: allInvitesData } = await supabase
      .from("block_invites")
      .select("block_id, invited_user_id, status")
      .in("block_id", blockIds);
    const allInvites = (allInvitesData ?? []) as { block_id: string; invited_user_id: string; status: string }[];

    const userIdSet = new Set<string>();
    invites.forEach((i) => userIdSet.add(i.block.user_id));
    allInvites.forEach((i) => userIdSet.add(i.invited_user_id));
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username, avatar")
      .in("id", Array.from(userIdSet));
    const profByUser = new Map<string, Participant>();
    for (const p of (profs ?? []) as Participant[]) profByUser.set(p.id, p);

    const nextRows: InviteRow[] = invites.map((i) => {
      const b = i.block;
      const inviteesForBlock = allInvites
        .filter((x) => x.block_id === i.blockId)
        .map((x) => ({ profile: profByUser.get(x.invited_user_id) ?? { id: x.invited_user_id, username: "Someone", avatar: null }, status: x.status }));
      return {
        inviteId: `${i.blockId}:${userId}`,
        blockId: i.blockId,
        blockName: b.name,
        date: b.date,
        startTime: b.start_time,
        endTime: b.end_time,
        hostId: b.user_id,
        myStatus: i.status as "invited" | "joined" | "declined",
        invitees: inviteesForBlock,
        host: profByUser.get(b.user_id) ?? null,
      };
    });
    setRows(nextRows);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Realtime: react to invite status changes for me.
    const supabase = createClient();
    const chan = supabase
      .channel(`block_invites_${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "block_invites", filter: `invited_user_id=eq.${userId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(chan); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function respond(blockId: string, next: "joined" | "declined") {
    setBusy(blockId + ":" + next);
    // Optimistic: for decline drop the row; for accept flip local state.
    if (next === "declined") {
      setRows((prev) => prev.filter((r) => r.blockId !== blockId));
    } else {
      setRows((prev) => prev.map((r) => r.blockId === blockId
        ? { ...r, myStatus: "joined", invitees: r.invitees.map((x) => x.profile.id === userId ? { ...x, status: "joined" } : x) }
        : r));
    }
    await createClient()
      .from("block_invites")
      .update({ status: next })
      .eq("block_id", blockId)
      .eq("invited_user_id", userId);
    setBusy(null);
  }

  async function addTask(blockId: string) {
    const raw = (drafts[blockId] ?? "").trim();
    if (!raw || busy === "add:" + blockId) return;
    setBusy("add:" + blockId);
    const text = stripHashtags(raw);
    const tagNames = parseHashtags(raw);
    if (!text) { setBusy(null); return; }
    const flags = flagsFor(blockId);
    const supabase = createClient();
    const row = rows.find((r) => r.blockId === blockId);
    const { data: t } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        text,
        done: false,
        block_id: blockId,
        committed_for_date: row?.date ?? null,
        is_private: flags.priv,
        is_shared: flags.shared,
      })
      .select("id")
      .single();
    if (t && tagNames.length > 0) {
      const tagObjs = (await Promise.all(tagNames.map((n) => getOrCreateTag(n, supabase, userId)))).filter(Boolean) as Tag[];
      if (tagObjs.length > 0) {
        await supabase.from("task_tags").insert(tagObjs.map((tg) => ({ task_id: t.id, tag_id: tg.id })));
      }
    }
    setDrafts((prev) => ({ ...prev, [blockId]: "" }));
    setBusy(null);
  }

  async function importFromList(blockId: string, taskId: string) {
    if (busy === "import:" + taskId) return;
    setBusy("import:" + taskId);
    // Optimistically drop the row from the available list so it doesn't
    // linger after being pulled into the block.
    setAvailable((prev) => ({
      ...prev,
      [blockId]: (prev[blockId] ?? []).filter((t) => t.id !== taskId),
    }));
    const flags = flagsFor(blockId);
    const row = rows.find((r) => r.blockId === blockId);
    await createClient()
      .from("tasks")
      .update({
        block_id: blockId,
        committed_for_date: row?.date ?? null,
        is_private: flags.priv,
        is_shared: flags.shared,
      })
      .eq("id", taskId);
    setBusy(null);
  }

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] px-1 mb-2" style={{ color: "var(--text-2)" }}>
        Block invites ({rows.length})
      </h3>
      <div className="space-y-3">
        {rows.map((r) => {
          const isPending = r.myStatus === "invited";
          const startLabel = formatTime12h(r.startTime);
          const endLabel = formatTime12h(r.endTime);
          const draft = drafts[r.blockId] ?? "";
          return (
            <div
              key={r.inviteId}
              className="rounded-2xl border overflow-hidden"
              style={{
                background: "var(--purple-bg)",
                borderColor: "var(--purple-border)",
              }}
            >
              <div className="px-4 py-3">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--purple)" }}>
                    {r.host?.username ?? "A friend"}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-2)" }}>
                    invited you
                  </span>
                </div>
                <div className="text-lg font-semibold leading-tight mb-1" style={{ color: "var(--text)" }}>
                  {r.blockName}
                </div>
                <div className="text-xs tabular-nums" style={{ color: "var(--text-2)" }}>
                  {formatDatePill(r.date)} · {startLabel} – {endLabel}
                </div>
              </div>

              {/* Attendee list */}
              <div
                className="px-4 py-2.5"
                style={{ borderTop: "1px solid var(--purple-border)", background: "rgba(255,255,255,0.4)" }}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-2)" }}>
                  Who&apos;s in
                </div>
                <ul className="space-y-1">
                  {/* Host row */}
                  <li className="flex items-center gap-2 text-xs">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                      style={{ background: "var(--surface)", border: "1px solid var(--purple-border)" }}
                    >
                      {r.host?.avatar ?? "🙂"}
                    </span>
                    <span className="flex-1 truncate" style={{ color: "var(--text)" }}>
                      {r.host?.username ?? "Host"}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "var(--purple)", color: "white" }}>
                      host
                    </span>
                  </li>
                  {/* Invitees */}
                  {r.invitees.map((iv) => {
                    const isMe = iv.profile.id === userId;
                    const statusLabel = iv.status === "joined"
                      ? "accepted"
                      : iv.status === "declined"
                        ? "declined"
                        : "pending";
                    const statusColor = iv.status === "joined"
                      ? { bg: "rgba(124,58,237,0.18)", fg: "var(--purple)" }
                      : iv.status === "declined"
                        ? { bg: "rgba(220,38,38,0.12)", fg: "var(--red)" }
                        : { bg: "var(--surface)", fg: "var(--text-2)" };
                    return (
                      <li key={iv.profile.id} className="flex items-center gap-2 text-xs">
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                          style={{ background: "var(--surface)", border: "1px solid var(--purple-border)" }}
                        >
                          {iv.profile.avatar ?? "🙂"}
                        </span>
                        <span className="flex-1 truncate" style={{ color: "var(--text)" }}>
                          {isMe ? "You" : iv.profile.username}
                        </span>
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: statusColor.bg, color: statusColor.fg }}
                        >
                          {statusLabel}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Actions */}
              <div className="px-4 pt-3 pb-3.5" style={{ borderTop: "1px solid var(--purple-border)" }}>
                {isPending ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => respond(r.blockId, "declined")}
                      disabled={busy?.startsWith(r.blockId)}
                      className="flex-1 text-sm font-semibold py-2 rounded-xl border transition-colors disabled:opacity-50"
                      style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(r.blockId, "joined")}
                      disabled={busy?.startsWith(r.blockId)}
                      className="flex-1 text-sm font-semibold py-2 rounded-xl text-white transition-colors disabled:opacity-50"
                      style={{ background: "var(--purple)" }}
                    >
                      Accept
                    </button>
                  </div>
                ) : (() => {
                  const flags = flagsFor(r.blockId);
                  const isListOpen = listOpen.has(r.blockId);
                  const listItems = available[r.blockId] ?? [];
                  const searchQ = (listSearch[r.blockId] ?? "").trim().toLowerCase();
                  const filteredList = searchQ
                    ? listItems.filter((t) => t.text.toLowerCase().includes(searchQ))
                    : listItems;
                  return (
                  <div>
                    <div className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--purple)" }}>
                      ✓ You&apos;re in. Add your tasks for this block:
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={draft}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [r.blockId]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTask(r.blockId); } }}
                        placeholder="Add a task… (try #category)"
                        className="flex-1 text-sm rounded-xl px-3 py-2 focus:outline-none border"
                        style={{
                          background: "var(--surface)",
                          borderColor: draft ? "var(--purple)" : "var(--border-2)",
                          color: "var(--text)",
                          fontSize: "16px",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => addTask(r.blockId)}
                        disabled={!draft.trim() || busy === "add:" + r.blockId}
                        className="text-sm font-semibold px-3 py-2 rounded-xl text-white disabled:opacity-40"
                        style={{ background: "var(--purple)" }}
                      >
                        Add
                      </button>
                    </div>

                    {/* Flags row — apply to whatever gets added next */}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => toggleFlag(r.blockId, "priv")}
                        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border"
                        style={flags.priv
                          ? { background: "var(--purple)", borderColor: "var(--purple)", color: "white" }
                          : { background: "var(--surface)", borderColor: "var(--purple-border)", color: "var(--purple)" }}
                        title={flags.priv ? "Adds will be private" : "Adds will be public"}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Private
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFlag(r.blockId, "shared")}
                        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border"
                        style={flags.shared
                          ? { background: "var(--purple)", borderColor: "var(--purple)", color: "white" }
                          : { background: "var(--surface)", borderColor: "var(--purple-border)", color: "var(--purple)" }}
                        title={flags.shared ? "Adds will be shared (claimable)" : "Adds stay just yours"}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                        Shared
                      </button>
                      <button
                        type="button"
                        onClick={() => isListOpen ? closeList(r.blockId) : openList(r.blockId)}
                        className="ml-auto text-[11px] font-semibold flex items-center gap-1"
                        style={{ color: "var(--purple)" }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isListOpen ? "rotate(45deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        {isListOpen ? "Close" : "Add from my list"}
                      </button>
                    </div>

                    {/* Add from my list — search + eligible tasks */}
                    {isListOpen && (
                      <div className="mt-2 rounded-xl border p-2" style={{ background: "var(--surface)", borderColor: "var(--purple-border)" }}>
                        <input
                          type="text"
                          value={listSearch[r.blockId] ?? ""}
                          onChange={(e) => setListSearch((prev) => ({ ...prev, [r.blockId]: e.target.value }))}
                          placeholder="Search your tasks…"
                          className="w-full text-sm rounded-lg px-2.5 py-1.5 focus:outline-none border mb-2"
                          style={{ background: "var(--surface-2)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
                        />
                        {filteredList.length === 0 ? (
                          <p className="text-xs text-center py-3" style={{ color: "var(--text-3)" }}>
                            {listItems.length === 0 ? "No unassigned tasks in your list" : "No matches"}
                          </p>
                        ) : (
                          <ul className="space-y-1 max-h-60 overflow-y-auto">
                            {filteredList.map((t) => (
                              <li key={t.id}>
                                <button
                                  type="button"
                                  onClick={() => importFromList(r.blockId, t.id)}
                                  disabled={busy === "import:" + t.id}
                                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors disabled:opacity-40"
                                  style={{ background: "var(--surface-2)" }}
                                >
                                  <span className="flex-1 text-sm truncate" style={{ color: "var(--text)" }}>
                                    {t.text}
                                  </span>
                                  <span className="text-[11px] font-semibold" style={{ color: "var(--purple)" }}>
                                    Add
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => respond(r.blockId, "declined")}
                      className="w-full text-[11px] font-medium mt-2 py-1"
                      style={{ color: "var(--text-3)" }}
                    >
                      Change my mind — decline
                    </button>
                  </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
