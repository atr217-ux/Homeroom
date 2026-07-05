"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useHasHover } from "@/lib/hooks/useHasHover";

type Friend = { id: string; username: string; avatar: string | null };
type PendingRequest = { id: string; username: string; avatar: string | null };
type Suggestion = { id: string; username: string; avatar: string | null };

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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const addWrapRef = useRef<HTMLDivElement>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const hasHover = useHasHover();

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

  // Autocomplete: query profiles matching the current input, debounced
  useEffect(() => {
    const term = addUsername.trim().toLowerCase();
    if (!term) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      const excluded = new Set<string>([
        username.toLowerCase(),
        ...friends.map((f) => f.username.toLowerCase()),
        ...incoming.map((r) => r.username.toLowerCase()),
        ...outgoing.map((r) => r.username.toLowerCase()),
      ]);
      const { data } = await createClient()
        .from("profiles")
        .select("id, username, avatar")
        .ilike("username", `${term}%`)
        .eq("searchable", true)
        .limit(8);
      const filtered = ((data as Suggestion[] | null) ?? []).filter(
        (u) => !excluded.has(u.username.toLowerCase()),
      );
      setSuggestions(filtered);
    }, 180);
    return () => clearTimeout(timer);
  }, [addUsername, friends, incoming, outgoing, username]);

  // Close suggestions on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (addWrapRef.current && !addWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

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
      .or(`from_username.eq.${username},to_username.eq.${username}`);

    const inc = (reqs ?? []).filter((r) => r.to_username === username && r.status === "pending");
    const out = (reqs ?? []).filter((r) => r.from_username === username && r.status === "pending");

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

  async function sendRequest(prefilled?: Suggestion) {
    setBusy(true);
    const supabase = createClient();
    let targetProfile: { id: string; username: string } | null = prefilled
      ? { id: prefilled.id, username: prefilled.username }
      : null;

    if (!targetProfile) {
      const target = addUsername.trim().toLowerCase();
      if (!target) { setBusy(false); return; }
      if (target === username.toLowerCase()) {
        setBusy(false);
        showMsg("Can't add yourself");
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("id, username, searchable")
        .eq("username", target)
        .maybeSingle();
      if (!data) {
        setBusy(false);
        showMsg(`No user named "${target}"`);
        return;
      }
      if ((data as { searchable: boolean | null }).searchable === false) {
        setBusy(false);
        showMsg(`${(data as { username: string }).username} isn't accepting new friends`);
        return;
      }
      targetProfile = data as { id: string; username: string };
    }

    // Already friends?
    if (friends.some((f) => f.username.toLowerCase() === targetProfile!.username.toLowerCase())) {
      setBusy(false);
      showMsg("Already friends");
      return;
    }

    // Any existing rows between us? Only 'pending' should block; sweep stale rows.
    const { data: existingRows } = await supabase
      .from("friend_requests")
      .select("id, status")
      .or(
        `and(from_username.eq.${username},to_username.eq.${targetProfile.username}),` +
        `and(from_username.eq.${targetProfile.username},to_username.eq.${username})`,
      );
    const stillPending = (existingRows ?? []).find((r) => r.status === "pending");
    if (stillPending) {
      setBusy(false);
      showMsg("A request is already open");
      return;
    }
    // Clean up stale accepted/declined rows so the fresh insert doesn't collide
    const staleIds = (existingRows ?? []).map((r) => r.id as string);
    if (staleIds.length > 0) {
      await supabase.from("friend_requests").delete().in("id", staleIds);
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
    setSuggestions([]);
    setShowSuggestions(false);
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
      <div ref={addWrapRef} className="relative mb-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={addUsername}
            onChange={(e) => { setAddUsername(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (suggestions[0]) sendRequest(suggestions[0]);
                else sendRequest();
              }
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            placeholder="Add by username…"
            className="flex-1 text-sm rounded-xl px-3 py-2 focus:outline-none border"
            style={{ background: "var(--bg)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
          />
          <button
            onClick={() => sendRequest()}
            disabled={busy || !addUsername.trim()}
            className="text-sm font-semibold px-3 py-2 rounded-xl text-white disabled:opacity-50"
            style={{ background: "var(--purple)" }}
          >
            Add
          </button>
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full mt-1 z-20 border rounded-xl shadow-md overflow-hidden max-h-64 overflow-y-auto"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          >
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  sendRequest(s);
                }}
                disabled={busy}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:opacity-80 disabled:opacity-50"
                style={{ background: "var(--surface)" }}
              >
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ background: "var(--surface-2)" }}>
                  {s.avatar || s.username[0]?.toUpperCase()}
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.username}</span>
              </button>
            ))}
          </div>
        )}
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

      {/* Friends list */}
      {friends.length > 0 ? (
        <div className="space-y-1.5">
          {friends.map((f) => {
            const confirming = confirmRemoveId === f.id;
            return (
              <div key={f.id} className="group flex items-center gap-2 py-1.5">
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: "var(--surface-2)" }}>
                  {f.avatar || f.username[0]?.toUpperCase()}
                </span>
                {confirming ? (
                  <>
                    <span className="flex-1 text-xs" style={{ color: "var(--text-2)" }}>
                      Remove {f.username}?
                    </span>
                    <button
                      onClick={() => setConfirmRemoveId(null)}
                      disabled={busy}
                      className="text-xs font-medium px-2.5 py-1 rounded-full border disabled:opacity-50"
                      style={{ color: "var(--text-2)", borderColor: "var(--border-2)" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => { await remove(f); setConfirmRemoveId(null); }}
                      disabled={busy}
                      className="text-xs font-semibold px-2.5 py-1 rounded-full text-white disabled:opacity-50"
                      style={{ background: "var(--red)" }}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium" style={{ color: "var(--text)" }}>{f.username}</span>
                    <button
                      onClick={() => setConfirmRemoveId(f.id)}
                      disabled={busy}
                      className={hasHover
                        ? "text-xs font-medium px-2.5 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        : "text-xs font-medium px-2.5 py-1 rounded-full transition-opacity"}
                      style={{ color: "var(--red)", opacity: hasHover ? undefined : 0.7 }}
                      title="Remove friend"
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : incoming.length === 0 && outgoing.length === 0 ? (
        <p className="text-sm text-center py-4" style={{ color: "var(--text-2)" }}>
          No friends yet — send a request above.
        </p>
      ) : null}

      {/* Outgoing / pending requests — collapsible, sits at the bottom */}
      {outgoing.length > 0 && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--border-2)" }}>
          <button
            type="button"
            onClick={() => setPendingOpen((v) => !v)}
            className="w-full flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-1.5"
            style={{ color: "var(--text-2)" }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: pendingOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>Pending sent ({outgoing.length})</span>
          </button>
          {pendingOpen && (
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
          )}
        </div>
      )}
    </section>
  );
}
