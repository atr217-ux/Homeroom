"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type FriendOption = { id: string; username: string; avatar: string | null };

type Props = {
  userId: string;
  block: {
    id: string;
    name: string;
    startTime: string; // HH:MM[:SS]
    endTime: string;
    invitedIds: string[]; // currently invited/joined users (excluding host)
  };
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
};

// Trim "HH:MM:SS" -> "HH:MM" so <input type="time"> is happy
function toHHMM(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export default function BlockEditModal({ userId, block, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState(block.name);
  const [startTime, setStartTime] = useState(toHHMM(block.startTime));
  const [endTime, setEndTime] = useState(toHHMM(block.endTime));
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set(block.invitedIds));

  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadFriends() {
      const supabase = createClient();
      const { data: fr } = await supabase
        .from("friendships")
        .select("user_a, user_b")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`);
      const friendIds = (fr ?? []).map((f) => (f.user_a === userId ? f.user_b : f.user_a)) as string[];
      if (friendIds.length === 0) { setFriends([]); return; }
      const { data: ps } = await supabase
        .from("profiles")
        .select("id, username, avatar")
        .in("id", friendIds);
      setFriends(((ps as FriendOption[] | null) ?? []));
    }
    loadFriends();
  }, [userId]);

  function toggleFriend(id: string) {
    setInvitedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    setError(null);
    if (!name.trim()) { setError("Give the block a name"); return; }
    if (!startTime || !endTime) { setError("Pick start and end times"); return; }
    if (startTime >= endTime) { setError("End time must be after start time"); return; }
    setSaving(true);

    const supabase = createClient();

    // Reconcile invites: figure out which to add and which to remove
    const originalIds = new Set(block.invitedIds);
    const toAdd = Array.from(invitedIds).filter((id) => !originalIds.has(id));
    const toRemove = Array.from(originalIds).filter((id) => !invitedIds.has(id));

    const visibility = invitedIds.size > 0 ? "shared" : "private";

    const [{ error: updErr }] = await Promise.all([
      supabase
        .from("blocks")
        .update({ name: name.trim(), start_time: startTime, end_time: endTime, visibility })
        .eq("id", block.id),
      toAdd.length > 0
        ? supabase.from("block_invites").insert(
            toAdd.map((id) => ({ block_id: block.id, invited_user_id: id, status: "invited" as const })),
          )
        : Promise.resolve({ error: null }),
      toRemove.length > 0
        ? supabase
            .from("block_invites")
            .delete()
            .eq("block_id", block.id)
            .in("invited_user_id", toRemove)
        : Promise.resolve({ error: null }),
    ]);

    setSaving(false);
    if (updErr) { setError(updErr.message ?? "Could not save"); return; }
    onSaved();
  }

  async function del() {
    setSaving(true);
    const supabase = createClient();
    // block_invites cascade on block delete
    const { error: e } = await supabase.from("blocks").delete().eq("id", block.id);
    setSaving(false);
    if (e) { setError(e.message ?? "Could not delete"); return; }
    onDeleted();
  }

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
        <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Edit block</h2>
        <button
          onClick={save}
          disabled={saving}
          className="text-sm font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
          style={{ background: "var(--purple)" }}
        >
          {saving ? "…" : "Save"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto pb-16">
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

          {/* Times */}
          <div className="grid grid-cols-2 gap-2">
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
              <div
                className="text-sm rounded-xl px-3 py-3 border text-center"
                style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}
              >
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

          {error && (
            <div
              className="text-sm rounded-xl px-3 py-2.5 border"
              style={{ background: "rgba(220,38,38,0.08)", borderColor: "rgba(220,38,38,0.3)", color: "var(--red)" }}
            >
              {error}
            </div>
          )}

          {/* Save (bottom mirror) */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 text-sm font-semibold py-3 rounded-2xl border transition-colors"
              style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 text-sm font-bold py-3 rounded-2xl text-white disabled:opacity-50"
              style={{ background: "var(--purple)" }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>

          {/* Delete — separated at the bottom, two-step confirm */}
          <div className="pt-2 border-t" style={{ borderColor: "var(--border-2)" }}>
            {confirmDelete ? (
              <div className="flex gap-2 pt-3">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 text-sm font-medium py-2.5 rounded-xl border"
                  style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}
                >
                  Keep block
                </button>
                <button
                  onClick={del}
                  disabled={saving}
                  className="flex-1 text-sm font-bold py-2.5 rounded-xl text-white disabled:opacity-50"
                  style={{ background: "var(--red)" }}
                >
                  Delete block
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full text-sm font-medium py-2.5 rounded-xl border transition-colors mt-3"
                style={{ background: "transparent", borderColor: "rgba(220,38,38,0.3)", color: "var(--red)" }}
              >
                Delete block
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
