"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Friend = { id: string; username: string; avatar: string | null };
type PendingRequest = { id: string; username: string; avatar: string | null };

type Props = {
  userId: string;
  username: string;
};

export default function FriendsPanel({ userId, username }: Props) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<PendingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
  const [addUsername, setAddUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !username) return;
    load();
    const supabase = createClient();
    const channel = supabase
      .channel(`friends-panel-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, username]);

  async function load() {
    const supabase = createClient();

    // Friendships table (canonical, uuid-based)
    const { data: fr } = await supabase
      .from("friendships")
      .select("user_a, user_b")
      .or(`user_a.eq.${userId},user_b.eq.${userId}`);
    const friendIds = (fr ?? []).map((f) => (f.user_a === userId ? f.user_b : f.user_a)) as string[];

    let friendProfiles: Friend[] = [];
    if (friendIds.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, avatar")
        .in("id", friendIds);
      friendProfiles = ((data as Friend[] | null) ?? []).sort((a, b) => a.username.localeCompare(b.username));
    }
    setFriends(friendProfiles);

    // Pending friend_requests (username-based)
    const { data: reqs } = await supabase
      .from("friend_requests")
      .select("id, from_username, to_username, status")
      .or(`from_username.eq.${username},to_username.eq.${username}`)
      .eq("status", "pending");

    const inc = (reqs ?? []).filter((r) => r.to_username === username);
    const out = (reqs ?? []).filter((r) => r.from_username === username);

    const otherUsernames = Array.from(new Set([
      ...inc.map((r) => r.from_username as string),
      ...out.map((r) => r.to_username as string),
    ]));

    let profileByUsername: Record<string, { avatar: string | null }> = {};
    if (otherUsernames.length > 0) {
      const { data: ps } = await supabase
        .from("profiles")
        .select("username, avatar")
        .in("username", otherUsernames);
      profileByUsername = Object.fromEntries(
        ((ps as { username: string; avatar: string | null }[] | null) ?? []).map((p) => [p.username, { avatar: p.avatar }]),
      );
    }

    setIncoming(inc.map((r) => ({
      id: r.id as string,
      username: r.from_username as string,
      avatar: profileByUsername[r.from_username as string]?.avatar ?? null,
    })));
    setOutgoing(out.map((r) => ({
      id: r.id as string,
      username: r.to_username as string,
      avatar: profileByUsername[r.to_username as string]?.avatar ?? null,
    })));
  }

  function showMsg(m: string, ms = 3500) {
    setMsg(m);
    setTimeout(() => setMsg(null), ms);
  }

  async function sendRequest() {
    const target = addUsername.trim().toLowerCase();
    if (!target) return;
    if (target === username.toLowerCase()) {
      showMsg("Can't add yourself");
      return;
    }
    setBusy(true);
    const supabase = createClient();

    // Verify the target user exists
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("username", target)
      .maybeSingle();
    if (!targetProfile) {
      setBusy(false);
      showMsg(`No user named "${target}"`);
      return;
    }

    // Already friends?
    if (friends.some((f) => f.username.toLowerCase() === target)) {
      setBusy(false);
      showMsg("Already friends");
      return;
    }

    // Any existing request between us?
    const { data: existing } = await supabase
      .from("friend_requests")
      .select("id, status")
      .or(
        `and(from_username.eq.${username},to_username.eq.${targetProfile.username}),` +
        `and(from_username.eq.${targetProfile.username},to_username.eq.${username})`,
      )
      .maybeSingle();
    if (existing) {
      setBusy(false);
      showMsg("A request is already open");
      return;
    }

    const { error } = await supabase.from("friend_requests").insert({
      from_username: username,
      to_username: targetProfile.username,
      status: "pending",
    });
    setBusy(false);
    if (error) {
      showMsg(error.message);
      return;
    }
    setAddUsername("");
    showMsg(`Request sent to ${targetProfile.username}`);
    load();
  }

  async function accept(req: PendingRequest) {
    setBusy(true);
    const supabase = createClient();

    // Look up the requester's user_id so we can write a canonical friendships row
    const { data: theirProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", req.username)
      .maybeSingle();

    await supabase
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("id", req.id);

    if (theirProfile) {
      const theirId = theirProfile.id as string;
      const [a, b] = userId < theirId ? [userId, theirId] : [theirId, userId];
      await supabase.from("friendships").insert({ user_a: a, user_b: b });
    }

    setBusy(false);
    load();
  }

  async function decline(req: PendingRequest) {
    setBusy(true);
    await createClient().from("friend_requests").delete().eq("id", req.id);
    setBusy(false);
    load();
  }

  async function cancel(req: PendingRequest) {
    setBusy(true);
    await createClient().from("friend_requests").delete().eq("id", req.id);
    setBusy(false);
    load();
  }

  async function remove(friend: Friend) {
    setBusy(true);
    const supabase = createClient();
    const [a, b] = userId < friend.id ? [userId, friend.id] : [friend.id, userId];
    await Promise.all([
      supabase.from("friendships").delete().eq("user_a", a).eq("user_b", b),
      supabase
        .from("friend_requests")
        .delete()
        .or(`and(from_username.eq.${username},to_username.eq.${friend.username}),and(from_username.eq.${friend.username},to_username.eq.${username})`),
    ]);
    setBusy(false);
    load();
  }

  return (
    <section
      className="rounded-2xl border p-4 mb-4"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>
          Friends
        </h2>
        <span className="text-xs" style={{ color: "var(--text-2)" }}>
          {friends.length}
        </span>
      </div>

      {/* Add by username */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={addUsername}
          onChange={(e) => setAddUsername(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendRequest(); } }}
          placeholder="Add by username…"
          className="flex-1 text-sm rounded-xl px-3 py-2 focus:outline-none border"
          style={{ background: "var(--bg)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
        />
        <button
          onClick={sendRequest}
          disabled={busy || !addUsername.trim()}
          className="text-sm font-semibold px-3 py-2 rounded-xl text-white disabled:opacity-50"
          style={{ background: "var(--purple)" }}
        >
          Add
        </button>
      </div>
      {msg && (
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>{msg}</p>
      )}

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--purple)" }}>
            Incoming ({incoming.length})
          </div>
          <div className="space-y-1.5">
            {incoming.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5">
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: "var(--surface-2)" }}>
                  {r.avatar || r.username[0]?.toUpperCase()}
                </span>
                <span className="flex-1 text-sm font-medium" style={{ color: "var(--text)" }}>{r.username}</span>
                <button
                  onClick={() => accept(r)}
                  disabled={busy}
                  className="text-xs font-semibold px-2.5 py-1 rounded-full text-white disabled:opacity-50"
                  style={{ background: "var(--purple)" }}
                >
                  Accept
                </button>
                <button
                  onClick={() => decline(r)}
                  disabled={busy}
                  className="text-xs font-medium px-2.5 py-1 rounded-full border disabled:opacity-50"
                  style={{ color: "var(--text-2)", borderColor: "var(--border-2)" }}
                >
                  Decline
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outgoing requests */}
      {outgoing.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-2)" }}>
            Pending ({outgoing.length})
          </div>
          <div className="space-y-1.5">
            {outgoing.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5">
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: "var(--surface-2)" }}>
                  {r.avatar || r.username[0]?.toUpperCase()}
                </span>
                <span className="flex-1 text-sm" style={{ color: "var(--text-2)" }}>{r.username}</span>
                <button
                  onClick={() => cancel(r)}
                  disabled={busy}
                  className="text-xs font-medium px-2.5 py-1 rounded-full border disabled:opacity-50"
                  style={{ color: "var(--text-2)", borderColor: "var(--border-2)" }}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friends list */}
      {friends.length > 0 ? (
        <div className="space-y-1.5">
          {friends.map((f) => (
            <div key={f.id} className="group flex items-center gap-2 py-1.5">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: "var(--surface-2)" }}>
                {f.avatar || f.username[0]?.toUpperCase()}
              </span>
              <span className="flex-1 text-sm font-medium" style={{ color: "var(--text)" }}>{f.username}</span>
              <button
                onClick={() => remove(f)}
                disabled={busy}
                className="text-xs font-medium px-2.5 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "var(--red)" }}
                title="Remove friend"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : incoming.length === 0 && outgoing.length === 0 ? (
        <p className="text-sm text-center py-4" style={{ color: "var(--text-2)" }}>
          No friends yet — send a request above.
        </p>
      ) : null}
    </section>
  );
}
