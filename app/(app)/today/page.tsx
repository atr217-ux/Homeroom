"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type Friend = { id: string; name: string; initials: string; color: string };

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

type DraftBlock = {
  tempId: string;
  name: string;
  startTime: string;
  endTime: string;
  visibility: "private" | "shared" | "public";
  taskIds: string[];
  invitedFriends: string[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_COLORS = ["#7C3AED", "#0891B2", "#059669", "#D97706", "#DC2626", "#DB2777", "#65A30D", "#0284C7", "#BE185D"];

function colorFromUsername(u: string): string {
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) & 0xffffffff;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TodayPage() {
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);

  // Setup flow
  const [setupPhase, setSetupPhase] = useState<"loading" | "tasks" | "blocks" | null>("loading");
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
  const [draftBlocks, setDraftBlocks] = useState<DraftBlock[]>([]);
  const [addingDraftBlock, setAddingDraftBlock] = useState(false);
  const [newDraftName, setNewDraftName] = useState("");
  const [newDraftStartTime, setNewDraftStartTime] = useState("");
  const [newDraftEndTime, setNewDraftEndTime] = useState("");
  const [newDraftVisibility, setNewDraftVisibility] = useState<"private" | "shared" | "public">("private");
  const [newDraftTaskIds, setNewDraftTaskIds] = useState<Set<string>>(new Set());
  const [newDraftFriends, setNewDraftFriends] = useState<Set<string>>(new Set());
  const [showDraftFriendPicker, setShowDraftFriendPicker] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Regular view
  const [todayBlocks, setTodayBlocks] = useState<Block[]>([]);
  const [blockTasks, setBlockTasks] = useState<Record<string, BlockTask[]>>({});
  const [blockInputs, setBlockInputs] = useState<Record<string, string>>({});
  const blockInputRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showImportFor, setShowImportFor] = useState<string | null>(null);
  const [importableTasks, setImportableTasks] = useState<{ id: string; text: string }[]>([]);
  const [selectedImport, setSelectedImport] = useState<Set<string>>(new Set());
  const [addingBlock, setAddingBlock] = useState(false);
  const [newBlockName, setNewBlockName] = useState("");
  const [newBlockVisibility, setNewBlockVisibility] = useState<"private" | "shared" | "public">("private");
  const [newBlockFriends, setNewBlockFriends] = useState<Set<string>>(new Set());
  const [showNewBlockFriendPicker, setShowNewBlockFriendPicker] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editBlockName, setEditBlockName] = useState("");
  const [editBlockStart, setEditBlockStart] = useState("");
  const [editBlockEnd, setEditBlockEnd] = useState("");
  const [liveBlockInviteFor, setLiveBlockInviteFor] = useState<string | null>(null);
  const [selectedInviteFriends, setSelectedInviteFriends] = useState<Set<string>>(new Set());
  const [unassignedTasks, setUnassignedTasks] = useState<{ id: string; text: string }[]>([]);
  const [unassignedSearch, setUnassignedSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // ── Init ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const a = localStorage.getItem("homeroom-avatar");
    if (a) setAvatar(a);

    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMyUserId(user.id);

      // Load friends
      const myUsername = localStorage.getItem("homeroom-username") ?? "";
      if (myUsername) {
        const { data: frData } = await supabase
          .from("friend_requests")
          .select("*")
          .eq("status", "accepted")
          .or(`from_username.eq.${myUsername},to_username.eq.${myUsername}`);
        if (frData) {
          setFriends(frData.map(r => {
            const uname = r.from_username === myUsername ? r.to_username : r.from_username;
            return { id: uname.toLowerCase(), name: uname, initials: uname.slice(0, 2).toUpperCase(), color: colorFromUsername(uname) };
          }));
        }
      }

      // Check if setup is needed today
      const todayDate = dateKey(new Date());
      const setupDate = localStorage.getItem("homeroom-today-setup-date");
      if (setupDate !== todayDate) {
        // Need setup
        await loadSetupTasks(user.id);
        setSetupPhase("tasks");
      } else {
        // Already set up today
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

    // Simple query — no optional columns so it can't fail due to missing migrations
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

    // Load tags and task→tag mappings in parallel (best-effort)
    const [tagsResult, taskTagsResult] = await Promise.allSettled([
      supabase.from("tags").select("id, name").eq("user_id", userId),
      taskIds.length > 0 ? supabase.from("task_tags").select("task_id, tag_id").in("task_id", taskIds) : Promise.resolve({ data: [] }),
    ]);
    const tagsData = tagsResult.status === "fulfilled" ? (tagsResult.value.data ?? []) : [];
    const taskTagsData = taskTagsResult.status === "fulfilled" ? ((taskTagsResult.value as { data: { task_id: string; tag_id: string }[] | null }).data ?? []) : [];
    setAllTags(tagsData as Tag[]);
    const taskTagMap: Record<string, string[]> = {};
    for (const r of taskTagsData) {
      if (!taskTagMap[r.task_id]) taskTagMap[r.task_id] = [];
      taskTagMap[r.task_id].push(r.tag_id);
    }

    // Optionally label tasks from prior-day blocks (best-effort)
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
    } catch { /* silently ignore if blocks haven't been migrated yet */ }

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

  // ── Setup: finish ──────────────────────────────────────────────────────────

  async function finishSetup() {
    if (!myUserId) return;
    setFinishing(true);
    const supabase = createClient();
    const todayDate = dateKey(new Date());

    // Find tasks committed but not assigned to any draft block
    const assignedTaskIds = new Set(draftBlocks.flatMap(db => db.taskIds));
    const unassigned = [...committedIds].filter(id => !assignedTaskIds.has(id));

    // Always create a "Today" block at position 0 if there are any committed tasks OR no draft blocks
    if (committedIds.size > 0 || draftBlocks.length === 0) {
      const { data: todayBlock } = await supabase
        .from("blocks")
        .insert({ user_id: myUserId, date: todayDate, name: "Today", position: 0, visibility: "private" })
        .select("id")
        .single();
      if (todayBlock && unassigned.length > 0) {
        await supabase.from("tasks").update({ block_id: todayBlock.id }).in("id", unassigned);
      }
    }

    // Create draft blocks (position 1, 2, 3…)
    for (let i = 0; i < draftBlocks.length; i++) {
      const db = draftBlocks[i];
      const { data: newBlock } = await supabase
        .from("blocks")
        .insert({
          user_id: myUserId,
          date: todayDate,
          name: db.name,
          start_time: db.startTime || null,
          end_time: db.endTime || null,
          visibility: db.visibility,
          position: i + 1,
        })
        .select("id")
        .single();
      if (newBlock) {
        if (db.taskIds.length > 0) {
          await supabase.from("tasks").update({ block_id: newBlock.id }).in("id", db.taskIds);
        }
        if (db.visibility === "shared" && db.invitedFriends.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, username")
            .in("username", db.invitedFriends);
          if (profiles && profiles.length > 0) {
            await Promise.all(profiles.map(p =>
              supabase.from("block_invites").upsert(
                { block_id: newBlock.id, invited_user_id: p.id, status: "invited" },
                { onConflict: "block_id,invited_user_id", ignoreDuplicates: true }
              )
            ));
          }
        }
      }
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

    let { data: blocks } = await supabase
      .from("blocks")
      .select("id, name, date, start_time, end_time, position, is_live, visibility")
      .eq("user_id", userId)
      .eq("date", todayDate)
      .order("position", { ascending: true });

    if (!blocks || blocks.length === 0) {
      const { data: created } = await supabase
        .from("blocks")
        .insert({ user_id: userId, date: todayDate, name: "Today", position: 0, visibility: "private" })
        .select("id, name, date, start_time, end_time, position, is_live, visibility")
        .single();
      blocks = created ? [created] : [];
    }

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

    // My List tasks not yet assigned to any block (best-effort if block_id column exists)
    try {
      const { data: loose } = await supabase
        .from("tasks")
        .select("id, text")
        .eq("user_id", userId)
        .eq("done", false)
        .is("block_id", null)
        .order("created_at", { ascending: true })
        .limit(100);
      setUnassignedTasks(loose ?? []);
    } catch { setUnassignedTasks([]); }
  }

  // ── Block task management ──────────────────────────────────────────────────

  async function addBlockTask(blockId: string) {
    const text = (blockInputs[blockId] ?? "").trim();
    if (!text || !myUserId) return;
    setBlockInputs(prev => ({ ...prev, [blockId]: "" }));
    if (blockInputRefs.current[blockId]) blockInputRefs.current[blockId]!.innerHTML = "";
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({ user_id: myUserId, text, done: false, block_id: blockId, sort_order: (blockTasks[blockId]?.length ?? 0) })
      .select("id, text, done, completed_at")
      .single();
    if (data) {
      setBlockTasks(prev => ({ ...prev, [blockId]: [...(prev[blockId] ?? []), { id: data.id, text: data.text, done: data.done, completed_at: data.completed_at }] }));
    }
  }

  async function toggleBlockTask(blockId: string, taskId: string, currentDone: boolean) {
    const nowDone = !currentDone;
    setBlockTasks(prev => ({
      ...prev,
      [blockId]: (prev[blockId] ?? []).map(t => t.id === taskId ? { ...t, done: nowDone, completed_at: nowDone ? new Date().toISOString() : null } : t),
    }));
    await createClient().from("tasks").update({ done: nowDone, completed_at: nowDone ? new Date().toISOString() : null }).eq("id", taskId);
  }

  async function addBlock() {
    const name = newBlockName.trim() || "New block";
    if (!myUserId) return;
    const supabase = createClient();
    const todayDate = dateKey(new Date());
    const { data } = await supabase
      .from("blocks")
      .insert({ user_id: myUserId, date: todayDate, name, position: todayBlocks.length, visibility: newBlockVisibility })
      .select("id, name, date, start_time, end_time, position, is_live, visibility")
      .single();
    if (data) {
      setTodayBlocks(prev => [...prev, data as Block]);
      setBlockTasks(prev => ({ ...prev, [data.id]: [] }));
      // If shared visibility and friends selected, send invites
      if (newBlockVisibility === "shared" && newBlockFriends.size > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, username")
          .in("username", [...newBlockFriends]);
        if (profiles && profiles.length > 0) {
          await Promise.all(profiles.map(p =>
            supabase.from("block_invites").upsert(
              { block_id: data.id, invited_user_id: p.id, status: "invited" },
              { onConflict: "block_id,invited_user_id", ignoreDuplicates: true }
            )
          ));
        }
      }
    }
    setAddingBlock(false);
    setNewBlockName("");
    setNewBlockVisibility("private");
    setNewBlockFriends(new Set());
    setShowNewBlockFriendPicker(false);
  }

  function startEditBlock(block: Block) {
    setEditingBlockId(block.id);
    setEditBlockName(block.name);
    setEditBlockStart(block.start_time ? block.start_time.slice(0, 5) : "");
    setEditBlockEnd(block.end_time ? block.end_time.slice(0, 5) : "");
  }

  async function saveBlockEdit(blockId: string) {
    const name = editBlockName.trim() || "Block";
    const start_time = editBlockStart || null;
    const end_time = editBlockEnd || null;
    setTodayBlocks(prev => prev.map(b => b.id === blockId ? { ...b, name, start_time, end_time } : b));
    setEditingBlockId(null);
    await createClient().from("blocks").update({ name, start_time, end_time }).eq("id", blockId);
  }

  async function deleteBlock(blockId: string) {
    setTodayBlocks(prev => prev.filter(b => b.id !== blockId));
    setBlockTasks(prev => { const n = { ...prev }; delete n[blockId]; return n; });
    setEditingBlockId(null);
    await createClient().from("blocks").delete().eq("id", blockId);
  }

  async function toggleBlockLive(blockId: string, currentIsLive: boolean) {
    const is_live = !currentIsLive;
    const visibility = is_live ? "shared" : "private";
    setTodayBlocks(prev => prev.map(b => b.id === blockId ? { ...b, is_live, visibility } : b));
    await createClient().from("blocks").update({ is_live, visibility }).eq("id", blockId);
  }

  async function inviteFriendsToBlock() {
    if (!liveBlockInviteFor || selectedInviteFriends.size === 0) { setLiveBlockInviteFor(null); return; }
    const supabase = createClient();
    const usernames = [...selectedInviteFriends];
    const { data: profiles } = await supabase.from("profiles").select("id, username").in("username", usernames);
    if (profiles && profiles.length > 0) {
      await Promise.all(profiles.map(p =>
        supabase.from("block_invites").upsert(
          { block_id: liveBlockInviteFor, invited_user_id: p.id, status: "invited" },
          { onConflict: "block_id,invited_user_id", ignoreDuplicates: true }
        )
      ));
    }
    setLiveBlockInviteFor(null);
    setSelectedInviteFriends(new Set());
    showToast("Invites sent");
  }

  async function openImport(blockId: string) {
    if (!myUserId) return;
    const { data } = await createClient()
      .from("tasks")
      .select("id, text")
      .eq("user_id", myUserId)
      .eq("done", false)
      .is("block_id", null)
      .order("sort_order", { ascending: true })
      .limit(50);
    setImportableTasks(data ?? []);
    setSelectedImport(new Set());
    setShowImportFor(blockId);
  }

  async function confirmImport() {
    if (!showImportFor || selectedImport.size === 0) { setShowImportFor(null); return; }
    await createClient().from("tasks").update({ block_id: showImportFor }).in("id", [...selectedImport]);
    const added = importableTasks.filter(t => selectedImport.has(t.id)).map(t => ({ id: t.id, text: t.text, done: false, completed_at: null }));
    setBlockTasks(prev => ({ ...prev, [showImportFor!]: [...(prev[showImportFor!] ?? []), ...added] }));
    setShowImportFor(null);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // ── Draft block helpers ────────────────────────────────────────────────────

  function addDraftBlock() {
    const name = newDraftName.trim() || "New block";
    const db: DraftBlock = {
      tempId: crypto.randomUUID(),
      name,
      startTime: newDraftStartTime,
      endTime: newDraftEndTime,
      visibility: newDraftVisibility,
      taskIds: [...newDraftTaskIds],
      invitedFriends: [...newDraftFriends],
    };
    setDraftBlocks(prev => [...prev, db]);
    setNewDraftName("");
    setNewDraftStartTime("");
    setNewDraftEndTime("");
    setNewDraftVisibility("private");
    setNewDraftTaskIds(new Set());
    setNewDraftFriends(new Set());
    setShowDraftFriendPicker(false);
    setAddingDraftBlock(false);
  }

  function removeDraftBlock(tempId: string) {
    setDraftBlocks(prev => prev.filter(db => db.tempId !== tempId));
  }

  // ── JSX ────────────────────────────────────────────────────────────────────

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

  return (
    <div className="max-w-2xl mx-auto px-4 pb-24">

      {/* Loading */}
      {setupPhase === "loading" && (
        <div className="flex items-center justify-center pt-32">
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }} />
        </div>
      )}

      {/* ── Setup Step 1: Tasks ──────────────────────────────────────────────── */}
      {setupPhase === "tasks" && (
        <div>
          <div className="pt-10 pb-6">
            <h1 className="text-2xl font-bold text-charcoal">What are your tasks for today?</h1>
            <p className="text-sm text-warm-gray mt-1">Pick what you want to focus on.</p>
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
              <button
                onClick={() => setSetupPhase("blocks")}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: "var(--purple)" }}
              >
                Continue
              </button>
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
                  <span className="text-xs ml-auto" style={{ color: "var(--text-2)" }}>{filteredSetupTasks.length} result{filteredSetupTasks.length !== 1 ? "s" : ""}</span>
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

          {/* Sticky continue button */}
          <div className="fixed bottom-20 left-0 right-0 px-4 max-w-2xl mx-auto">
            <button
              onClick={() => setSetupPhase("blocks")}
              className="w-full py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg"
              style={{ background: "var(--purple)" }}
            >
              Continue {committedIds.size > 0 ? `(${committedIds.size} selected)` : ""} →
            </button>
          </div>
        </div>
      )}

      {/* ── Setup Step 2: Blocks ─────────────────────────────────────────────── */}
      {setupPhase === "blocks" && (
        <div>
          <div className="pt-10 pb-6">
            <h1 className="text-2xl font-bold text-charcoal">Schedule your day</h1>
            <p className="text-sm text-warm-gray mt-1">Group tasks into named blocks. Invite friends or make them public.</p>
          </div>

          {/* Draft blocks summary */}
          {draftBlocks.length > 0 && (
            <div className="space-y-2 mb-4">
              {draftBlocks.map(db => (
                <div
                  key={db.tempId}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl border"
                  style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-charcoal">{db.name}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: db.visibility === "public" ? "rgba(5,150,105,0.1)" : db.visibility === "shared" ? "rgba(139,92,246,0.1)" : "var(--bg)",
                          color: db.visibility === "public" ? "#059669" : db.visibility === "shared" ? "var(--purple)" : "var(--text-2)",
                        }}
                      >
                        {db.visibility === "public" ? "Everyone" : db.visibility === "shared" ? "Friends" : "Private"}
                      </span>
                    </div>
                    <p className="text-xs text-warm-gray mt-0.5">
                      {db.taskIds.length} task{db.taskIds.length !== 1 ? "s" : ""}
                      {db.startTime ? ` · ${db.startTime}${db.endTime ? `–${db.endTime}` : ""}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => removeDraftBlock(db.tempId)}
                    className="text-warm-gray hover:text-red-400 transition-colors p-1"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add a block form */}
          {addingDraftBlock ? (
            <div className="rounded-2xl border p-4 space-y-3 mb-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <input
                autoFocus
                value={newDraftName}
                onChange={e => setNewDraftName(e.target.value)}
                placeholder="Morning focus…"
                className="w-full text-sm font-semibold bg-transparent focus:outline-none text-charcoal placeholder:text-warm-gray"
                style={{ fontSize: "16px" }}
              />
              {/* Time inputs */}
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={newDraftStartTime}
                  onChange={e => setNewDraftStartTime(e.target.value)}
                  className="text-xs bg-transparent focus:outline-none text-charcoal"
                  style={{ fontSize: "16px" }}
                />
                <span className="text-xs text-warm-gray">–</span>
                <input
                  type="time"
                  value={newDraftEndTime}
                  onChange={e => setNewDraftEndTime(e.target.value)}
                  className="text-xs bg-transparent focus:outline-none text-charcoal"
                  style={{ fontSize: "16px" }}
                />
                <span className="text-xs text-warm-gray ml-1">(optional)</span>
              </div>

              {/* Visibility pills */}
              <div className="flex items-center gap-2">
                {(["private", "shared", "public"] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => {
                      setNewDraftVisibility(v);
                      if (v === "shared") setShowDraftFriendPicker(true);
                      else { setShowDraftFriendPicker(false); setNewDraftFriends(new Set()); }
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors"
                    style={newDraftVisibility === v
                      ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                      : { background: "var(--bg)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
                  >
                    {v === "private" ? "Private" : v === "shared" ? "Friends" : "Everyone"}
                  </button>
                ))}
              </div>

              {/* Friend list if "shared" */}
              {newDraftVisibility === "shared" && showDraftFriendPicker && friends.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {friends.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setNewDraftFriends(prev => { const s = new Set(prev); s.has(f.name) ? s.delete(f.name) : s.add(f.name); return s; })}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors text-left"
                      style={{
                        background: newDraftFriends.has(f.name) ? "var(--purple-bg-2)" : "var(--bg)",
                        border: `1px solid ${newDraftFriends.has(f.name) ? "var(--purple)" : "var(--border-2)"}`,
                      }}
                    >
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: f.color }}>{f.initials}</div>
                      <span className="text-sm text-charcoal flex-1">{f.name}</span>
                      {newDraftFriends.has(f.name) && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Task assignment */}
              {committedIds.size > 0 && (
                <div>
                  <p className="text-xs font-medium text-warm-gray mb-2">Assign tasks to this block:</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {setupTasks.filter(t => committedIds.has(t.id)).map(task => (
                      <button
                        key={task.id}
                        onClick={() => setNewDraftTaskIds(prev => { const s = new Set(prev); s.has(task.id) ? s.delete(task.id) : s.add(task.id); return s; })}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-colors text-left"
                        style={{
                          background: newDraftTaskIds.has(task.id) ? "var(--purple-bg-2)" : "var(--bg)",
                          border: `1px solid ${newDraftTaskIds.has(task.id) ? "var(--purple)" : "var(--border-2)"}`,
                        }}
                      >
                        <div
                          className="w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center"
                          style={newDraftTaskIds.has(task.id) ? { background: "var(--purple)", borderColor: "var(--purple)" } : { borderColor: "#D1D5DB" }}
                        >
                          {newDraftTaskIds.has(task.id) && (
                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="2,6 5,9 10,3" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm text-charcoal truncate">{task.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={addDraftBlock}
                  className="text-xs font-semibold px-3 py-2 rounded-xl text-white"
                  style={{ background: "var(--purple)" }}
                >
                  Add block
                </button>
                <button
                  onClick={() => {
                    setAddingDraftBlock(false);
                    setNewDraftName("");
                    setNewDraftStartTime("");
                    setNewDraftEndTime("");
                    setNewDraftVisibility("private");
                    setNewDraftTaskIds(new Set());
                    setNewDraftFriends(new Set());
                    setShowDraftFriendPicker(false);
                  }}
                  className="text-xs text-warm-gray hover:text-charcoal transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingDraftBlock(true)}
              className="w-full text-xs font-medium py-2.5 rounded-2xl border border-dashed transition-colors hover:opacity-70 flex items-center justify-center gap-1.5 mb-6"
              style={{ borderColor: "var(--border-3)", color: "var(--text-2)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add a block
            </button>
          )}

          {/* Bottom action buttons */}
          <div className="fixed bottom-20 left-0 right-0 px-4 max-w-2xl mx-auto flex gap-3">
            <button
              onClick={() => {
                setCommittedIds(new Set());
                setDraftBlocks([]);
                finishSetup();
              }}
              className="flex-shrink-0 px-5 py-3 rounded-xl text-sm font-medium text-warm-gray"
              style={{ background: "var(--bg)" }}
            >
              Skip
            </button>
            <button
              onClick={finishSetup}
              disabled={finishing}
              className="flex-1 py-3 rounded-xl text-sm font-semibold text-white shadow-lg flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
              style={{ background: "var(--purple)" }}
            >
              {finishing && (
                <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "white", borderTopColor: "transparent" }} />
              )}
              Done →
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

          {/* Today blocks */}
          <div className="mb-6 space-y-4">
            {todayBlocks.map(block => {
              const tasks = blockTasks[block.id] ?? [];
              const doneCount = tasks.filter(t => t.done).length;
              const inputVal = blockInputs[block.id] ?? "";
              return (
                <div key={block.id} className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                  {/* Block header — edit mode */}
                  {editingBlockId === block.id ? (
                    <div className="mb-3 space-y-2">
                      <input
                        autoFocus
                        value={editBlockName}
                        onChange={e => setEditBlockName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveBlockEdit(block.id); if (e.key === "Escape") setEditingBlockId(null); }}
                        placeholder="Block name"
                        className="w-full text-sm font-semibold bg-transparent focus:outline-none text-charcoal placeholder:text-warm-gray border-b pb-1"
                        style={{ borderColor: "var(--border-3)", fontSize: "16px" }}
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={editBlockStart}
                          onChange={e => setEditBlockStart(e.target.value)}
                          className="text-xs bg-transparent focus:outline-none text-charcoal"
                          style={{ fontSize: "16px" }}
                        />
                        <span className="text-xs text-warm-gray">–</span>
                        <input
                          type="time"
                          value={editBlockEnd}
                          onChange={e => setEditBlockEnd(e.target.value)}
                          className="text-xs bg-transparent focus:outline-none text-charcoal"
                          style={{ fontSize: "16px" }}
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-0.5">
                        <button onClick={() => saveBlockEdit(block.id)} className="text-xs font-semibold px-3 py-1 rounded-lg text-white" style={{ background: "var(--purple)" }}>Save</button>
                        <button onClick={() => setEditingBlockId(null)} className="text-xs text-warm-gray hover:text-charcoal transition-colors">Cancel</button>
                        {todayBlocks.length > 1 && (
                          <button onClick={() => deleteBlock(block.id)} className="ml-auto text-xs text-red-400 hover:text-red-600 transition-colors">Delete block</button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {block.is_live && (
                            <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--red)" }} />
                          )}
                          <h2 className="text-sm font-bold text-charcoal">{block.name}</h2>
                        </div>
                        <div className="flex items-center gap-2">
                          {tasks.length > 0 && (
                            <span className="text-xs text-warm-gray">{doneCount}/{tasks.length} done</span>
                          )}
                          <button onClick={() => startEditBlock(block)} className="text-warm-gray hover:text-charcoal transition-colors" aria-label="Edit block">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {block.start_time && (
                        <p className="text-xs text-warm-gray mt-0.5 ml-4">
                          {block.start_time.slice(0, 5)}{block.end_time ? ` – ${block.end_time.slice(0, 5)}` : ""}
                        </p>
                      )}
                      {/* Go Live / Invite */}
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => toggleBlockLive(block.id, block.is_live)}
                          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors"
                          style={block.is_live
                            ? { background: "rgba(239,68,68,0.1)", color: "var(--red)" }
                            : { background: "rgba(139,92,246,0.1)", color: "var(--purple)" }}
                        >
                          {block.is_live ? (
                            <>
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                              End session
                            </>
                          ) : (
                            <>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5,3 19,12 5,21" /></svg>
                              Go Live
                            </>
                          )}
                        </button>
                        {block.is_live && (
                          <button
                            onClick={() => { setLiveBlockInviteFor(block.id); setSelectedInviteFriends(new Set()); }}
                            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors"
                            style={{ background: "var(--bg)", color: "var(--text-2)", border: "1px solid var(--border-2)" }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                              <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
                            </svg>
                            Invite
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Task list */}
                  {tasks.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {tasks.map(task => (
                        <div
                          key={task.id}
                          className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
                          style={{ background: "var(--bg)", border: "1px solid var(--border-2)" }}
                        >
                          <button
                            onClick={() => toggleBlockTask(block.id, task.id, task.done)}
                            className="w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors"
                            style={task.done ? { background: "var(--sage)", borderColor: "var(--sage)" } : { borderColor: "#D1D5DB" }}
                          >
                            {task.done && (
                              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="2,6 5,9 10,3" />
                              </svg>
                            )}
                          </button>
                          <span className={`text-sm flex-1 ${task.done ? "line-through text-warm-gray" : "text-charcoal"}`}>
                            {task.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add task input */}
                  <div className="flex gap-2">
                    <div
                      className="flex-1 relative rounded-xl transition-colors"
                      style={{ background: "var(--bg)", border: `2px solid ${inputVal ? "var(--purple)" : "rgba(139,92,246,0.35)"}` }}
                    >
                      {!inputVal && (
                        <span className="absolute inset-0 flex items-center px-3 text-sm pointer-events-none font-medium" style={{ color: "var(--purple)", opacity: 0.6 }}>
                          Add a task…
                        </span>
                      )}
                      <div
                        ref={el => { blockInputRefs.current[block.id] = el; }}
                        contentEditable
                        suppressContentEditableWarning
                        role="textbox"
                        onInput={() => {
                          const el = blockInputRefs.current[block.id];
                          if (!el) return;
                          const text = el.innerText.replace(/\n/g, "");
                          setBlockInputs(prev => ({ ...prev, [block.id]: text }));
                        }}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addBlockTask(block.id); } }}
                        onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }} // eslint-disable-line
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        className="w-full px-3 py-2.5 focus:outline-none"
                        style={{ color: "var(--text)", outline: "none", fontSize: "16px" } as React.CSSProperties}
                      />
                    </div>
                    <button
                      onClick={() => addBlockTask(block.id)}
                      style={{ color: "var(--purple)" }}
                      className="flex-shrink-0 hover:opacity-70 transition-opacity"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
                      </svg>
                    </button>
                  </div>

                  {/* Import from list */}
                  <button
                    onClick={() => openImport(block.id)}
                    className="mt-2 text-xs font-medium transition-opacity hover:opacity-70"
                    style={{ color: "var(--text-2)" }}
                  >
                    + Add from My List
                  </button>
                </div>
              );
            })}

            {/* Add a block */}
            {addingBlock ? (
              <div className="rounded-2xl border p-4 space-y-3" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <input
                  autoFocus
                  value={newBlockName}
                  onChange={e => setNewBlockName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") { setAddingBlock(false); setNewBlockName(""); } }}
                  placeholder="Block name…"
                  className="w-full text-sm bg-transparent focus:outline-none text-charcoal placeholder:text-warm-gray"
                  style={{ fontSize: "16px" }}
                />
                {/* Visibility pills */}
                <div className="flex items-center gap-2">
                  {(["private", "shared", "public"] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => {
                        setNewBlockVisibility(v);
                        if (v === "shared") setShowNewBlockFriendPicker(true);
                        else { setShowNewBlockFriendPicker(false); setNewBlockFriends(new Set()); }
                      }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors"
                      style={newBlockVisibility === v
                        ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
                        : { background: "var(--bg)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
                    >
                      {v === "private" ? "Private" : v === "shared" ? "Friends" : "Everyone"}
                    </button>
                  ))}
                </div>
                {/* Friend picker if shared */}
                {newBlockVisibility === "shared" && showNewBlockFriendPicker && friends.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {friends.map(f => (
                      <button
                        key={f.id}
                        onClick={() => setNewBlockFriends(prev => { const s = new Set(prev); s.has(f.name) ? s.delete(f.name) : s.add(f.name); return s; })}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors text-left"
                        style={{
                          background: newBlockFriends.has(f.name) ? "var(--purple-bg-2)" : "var(--bg)",
                          border: `1px solid ${newBlockFriends.has(f.name) ? "var(--purple)" : "var(--border-2)"}`,
                        }}
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: f.color }}>{f.initials}</div>
                        <span className="text-sm text-charcoal flex-1">{f.name}</span>
                        {newBlockFriends.has(f.name) && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={addBlock} className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white" style={{ background: "var(--purple)" }}>Add</button>
                  <button onClick={() => { setAddingBlock(false); setNewBlockName(""); setNewBlockVisibility("private"); setNewBlockFriends(new Set()); setShowNewBlockFriendPicker(false); }} className="text-xs text-warm-gray hover:text-charcoal transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingBlock(true)}
                className="w-full text-xs font-medium py-2.5 rounded-2xl border border-dashed transition-colors hover:opacity-70 flex items-center justify-center gap-1.5"
                style={{ borderColor: "var(--border-3)", color: "var(--text-2)" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add a block
              </button>
            )}
          </div>

          {/* ── My List (unassigned tasks) ──────────────────────────────────── */}
          {unassignedTasks.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-charcoal">My List</h2>
                <span className="text-xs" style={{ color: "var(--text-2)" }}>{unassignedTasks.length} task{unassignedTasks.length !== 1 ? "s" : ""} not in a block</span>
              </div>
              {/* Search */}
              <div className="mb-3 relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-2)" }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={unassignedSearch}
                  onChange={e => setUnassignedSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-8 pr-4 py-2 rounded-xl text-sm focus:outline-none"
                  style={{ background: "var(--surface)", border: "1px solid var(--border-2)", color: "var(--text)", fontSize: "16px" }}
                />
              </div>
              <div className="space-y-1.5">
                {(unassignedSearch
                  ? unassignedTasks.filter(t => t.text.toLowerCase().includes(unassignedSearch.toLowerCase()))
                  : unassignedTasks
                ).map(task => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}
                  >
                    <span className="text-sm flex-1 text-charcoal">{task.text}</span>
                    {todayBlocks.length > 0 && (
                      <select
                        defaultValue=""
                        onChange={async e => {
                          const blockId = e.target.value;
                          if (!blockId) return;
                          await createClient().from("tasks").update({ block_id: blockId }).eq("id", task.id);
                          setUnassignedTasks(prev => prev.filter(t => t.id !== task.id));
                          setBlockTasks(prev => ({ ...prev, [blockId]: [...(prev[blockId] ?? []), { id: task.id, text: task.text, done: false, completed_at: null }] }));
                        }}
                        className="text-xs rounded-lg px-2 py-1 focus:outline-none"
                        style={{ background: "var(--bg)", border: "1px solid var(--border-3)", color: "var(--text-2)", fontSize: "14px" }}
                      >
                        <option value="">Add to block…</option>
                        {todayBlocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                {unassignedSearch && unassignedTasks.filter(t => t.text.toLowerCase().includes(unassignedSearch.toLowerCase())).length === 0 && (
                  <p className="text-sm text-center py-4" style={{ color: "var(--text-2)" }}>No results for "{unassignedSearch}"</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────────── */}

      {/* Import from list modal */}
      {showImportFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowImportFor(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl p-5 max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-charcoal">Add from My List</h2>
              <button onClick={() => setShowImportFor(null)} className="text-warm-gray hover:text-charcoal p-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 mb-4">
              {importableTasks.length === 0 && <p className="text-sm text-warm-gray text-center py-6">No tasks in My List.</p>}
              {importableTasks.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedImport(prev => { const s = new Set(prev); s.has(t.id) ? s.delete(t.id) : s.add(t.id); return s; })}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                  style={{ background: selectedImport.has(t.id) ? "var(--purple-bg-2)" : "var(--bg)", border: `1px solid ${selectedImport.has(t.id) ? "var(--purple)" : "var(--border-2)"}` }}
                >
                  <div className="w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors" style={selectedImport.has(t.id) ? { background: "var(--purple)", borderColor: "var(--purple)" } : { borderColor: "#D1D5DB" }}>
                    {selectedImport.has(t.id) && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 5,9 10,3" /></svg>}
                  </div>
                  <span className="text-sm text-charcoal">{t.text}</span>
                </button>
              ))}
            </div>
            <button
              onClick={confirmImport}
              disabled={selectedImport.size === 0}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: "var(--purple)" }}
            >
              Add {selectedImport.size > 0 ? `${selectedImport.size} task${selectedImport.size !== 1 ? "s" : ""}` : "tasks"}
            </button>
          </div>
        </div>
      )}

      {/* Invite friends to live block modal */}
      {liveBlockInviteFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setLiveBlockInviteFor(null)} />
          <div className="relative w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl p-5 max-h-[70vh] flex flex-col" style={{ background: "var(--surface)" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-charcoal">Invite to this block</h2>
              <button onClick={() => setLiveBlockInviteFor(null)} className="text-warm-gray hover:text-charcoal p-1">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 mb-4">
              {friends.length === 0 && <p className="text-sm text-warm-gray text-center py-6">No friends yet.</p>}
              {friends.map(f => (
                <button
                  key={f.id}
                  onClick={() => setSelectedInviteFriends(prev => { const s = new Set(prev); s.has(f.name) ? s.delete(f.name) : s.add(f.name); return s; })}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                  style={{ background: selectedInviteFriends.has(f.name) ? "var(--purple-bg-2)" : "var(--bg)", border: `1px solid ${selectedInviteFriends.has(f.name) ? "var(--purple)" : "var(--border-2)"}` }}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style={{ background: f.color }}>{f.initials}</div>
                  <span className="text-sm text-charcoal">{f.name}</span>
                  {selectedInviteFriends.has(f.name) && (
                    <svg className="ml-auto" width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="var(--purple)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,6 5,9 10,3" /></svg>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={inviteFriendsToBlock}
              disabled={selectedInviteFriends.size === 0}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: "var(--purple)" }}
            >
              Invite {selectedInviteFriends.size > 0 ? selectedInviteFriends.size : ""}
            </button>
          </div>
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
