"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Friend = { id: string; username: string; avatar: string | null };

type Props = {
  userId: string;
  blockId: string;
  onClose: () => void;
  onChanged?: () => void;
};

// Lightweight "Invite friends" popup for a running/upcoming block. Shows
// the user's friends with an Invite / Invited toggle per row — tapping
// flips the state and writes to block_invites.
export default function BlockInviteModal({ userId, blockId, onClose, onChanged }: Props) {
  const [friends, setFriends] = useState<Friend[]>([]);
  // Set of friend ids currently invited (status = 'invited' or 'joined').
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [invitedStatus, setInvitedStatus] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [frRes, inviteRes] = await Promise.all([
        supabase
          .from("friendships")
          .select("user_a, user_b")
          .or(`user_a.eq.${userId},user_b.eq.${userId}`),
        supabase
          .from("block_invites")
          .select("invited_user_id, status")
          .eq("block_id", blockId),
      ]);
      const friendIds = ((frRes.data ?? []) as { user_a: string; user_b: string }[])
        .map((f) => (f.user_a === userId ? f.user_b : f.user_a));
      let friendProfiles: Friend[] = [];
      if (friendIds.length > 0) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, username, avatar")
          .in("id", friendIds);
        friendProfiles = ((ps as Friend[] | null) ?? []).sort((a, b) => a.username.localeCompare(b.username));
      }
      setFriends(friendProfiles);
      const alive = new Set<string>();
      const statuses = new Map<string, string>();
      for (const r of (inviteRes.data ?? []) as { invited_user_id: string; status: string }[]) {
        statuses.set(r.invited_user_id, r.status);
        if (r.status === "invited" || r.status === "joined") alive.add(r.invited_user_id);
      }
      setInvitedIds(alive);
      setInvitedStatus(statuses);
      setLoading(false);
    }
    load();
  }, [userId, blockId]);

  async function toggle(friendId: string) {
    if (busy) return;
    const wasInvited = invitedIds.has(friendId);
    setBusy(friendId);
    // Optimistic
    setInvitedIds((prev) => {
      const next = new Set(prev);
      if (wasInvited) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
    const supabase = createClient();
    if (wasInvited) {
      await supabase
        .from("block_invites")
        .delete()
        .eq("block_id", blockId)
        .eq("invited_user_id", friendId);
      setInvitedStatus((prev) => { const n = new Map(prev); n.delete(friendId); return n; });
    } else {
      // Upsert to handle the case where a prior invite row lingers (e.g.
      // declined then re-invited).
      await supabase
        .from("block_invites")
        .upsert(
          { block_id: blockId, invited_user_id: friendId, status: "invited" },
          { onConflict: "block_id,invited_user_id" },
        );
      setInvitedStatus((prev) => { const n = new Map(prev); n.set(friendId, "invited"); return n; });
    }
    setBusy(null);
    onChanged?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[85vh] flex flex-col sm:rounded-3xl overflow-hidden animate-notes-slide sm:animate-none shadow-2xl"
        style={{ background: "var(--surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b" style={{ borderColor: "var(--border-2)" }}>
          <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Invite friends</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full"
            style={{ color: "var(--text-2)" }}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <div
                className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
              />
            </div>
          ) : friends.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--text-2)" }}>
              You don&apos;t have any friends yet — add some on the Profile tab.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {friends.map((f) => {
                const isInvited = invitedIds.has(f.id);
                const status = invitedStatus.get(f.id);
                const isJoined = status === "joined";
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                      style={{ background: "var(--surface)", border: "1px solid var(--border-2)" }}
                    >
                      {f.avatar ?? "🙂"}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                      {f.username}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(f.id)}
                      disabled={busy === f.id}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-60"
                      style={isInvited
                        ? { background: isJoined ? "var(--purple)" : "rgba(124,58,237,0.15)", color: isJoined ? "white" : "var(--purple)" }
                        : { background: "var(--purple)", color: "white" }}
                    >
                      {busy === f.id ? "…" : isJoined ? "Joined" : isInvited ? "Invited" : "Invite"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: "var(--border-2)" }}>
          <button
            type="button"
            onClick={onClose}
            className="w-full text-sm font-semibold py-2.5 rounded-2xl border"
            style={{ background: "var(--surface)", borderColor: "var(--border-2)", color: "var(--text-2)" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
