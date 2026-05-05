"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
const AVATAR_EMOJIS = [
  "😊","😎","🤓","🧑‍💻","👨‍🎨","👩‍🎨","🦊","🐼","🐸","🦁",
  "🐯","🦋","🌟","⚡","🔥","💎","🎯","🚀","🌙","☀️",
  "🎸","🎨","🏋️","🧘","🌊","🏔️","🌿","🍀","🦄","👾",
];

const ALL_USERS: { id: string; name: string; initials: string; color: string; username: string }[] = [];

const ALL_SQUADS: { id: string; name: string; members: number; description: string; emoji: string; isPublic: boolean }[] = [];

const FRIEND_SQUAD_MEMBERSHIPS: Record<string, string[]> = {};

type Friend = { id: string; name: string; initials: string; color: string; username: string };
type Squad  = typeof ALL_SQUADS[number];

const LockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-3xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <h2 className="font-bold text-charcoal text-base">{title}</h2>
          <button onClick={onClose} className="text-warm-gray hover:text-charcoal p-1"><XIcon /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [avatar, setAvatar]                 = useState<string | null>(null);
  const [hoveringAvatar, setHoveringAvatar] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const [username, setUsername]           = useState("your_username");
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameError, setUsernameError] = useState("");

  const [friends, setFriends]             = useState<Friend[]>([]);
  const [pendingFriends, setPendingFriends] = useState<Friend[]>([]);
  const [joinedSquads, setJoinedSquads]   = useState<string[]>([]);
  const [mySquads, setMySquads]           = useState<Squad[]>([]);

  const [showFindFriends, setShowFindFriends] = useState(false);
  const [friendSearch, setFriendSearch]       = useState("");

  const [showSquads, setShowSquads]         = useState(false);
  const [squadSearch, setSquadSearch]       = useState("");
  const [showCreateSquad, setShowCreateSquad] = useState(false);
  const [newSquadName, setNewSquadName]       = useState("");
  const [newSquadNameError, setNewSquadNameError] = useState("");
  const [newSquadDesc, setNewSquadDesc]       = useState("");
  const [newSquadEmoji, setNewSquadEmoji]     = useState("🏆");
  const [newSquadPrivate, setNewSquadPrivate] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);

  const [inviteSquadId, setInviteSquadId]         = useState<string | null>(null);
  const [inviteSearch, setInviteSearch]             = useState("");
  const [inviteSquadFilter, setInviteSquadFilter]   = useState<string[]>([]);
  const [invitedToSquad, setInvitedToSquad]         = useState<Record<string, string[]>>({});

  useEffect(() => {
    try {
      const a = localStorage.getItem("homeroom-avatar");
      if (a) setAvatar(a);
      const u = localStorage.getItem("homeroom-username");
      if (u) setUsername(u);
      const f = localStorage.getItem("homeroom-friends");
      setFriends(f ? JSON.parse(f) : []);
      const pf = localStorage.getItem("homeroom-pending-friends");
      if (pf) setPendingFriends(JSON.parse(pf));
      const js = localStorage.getItem("homeroom-joined-squads");
      setJoinedSquads(js ? JSON.parse(js) : []);
      const ms = localStorage.getItem("homeroom-my-squads");
      setMySquads(ms ? JSON.parse(ms) : []);
    } catch { /* ignore */ }
  }, []);

  function handleUsernameInput(raw: string) {
    const cleaned = raw.replace(/\s/g, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15);
    setUsernameInput(cleaned);
    if (/[^a-zA-Z0-9_]/.test(raw.replace(/\s/g, ""))) {
      setUsernameError("Only letters, numbers, and underscores allowed");
    } else {
      setUsernameError("");
    }
  }

  function saveUsername() {
    const val = usernameInput.trim();
    if (!val || usernameError) return;
    setUsername(val);
    localStorage.setItem("homeroom-username", val);
    setEditingUsername(false);
    setUsernameInput("");
    setUsernameError("");
  }

  function saveAvatar(emoji: string) {
    setAvatar(emoji);
    localStorage.setItem("homeroom-avatar", emoji);
    setShowAvatarPicker(false);
  }

  function saveFriends(updated: Friend[]) {
    setFriends(updated);
    localStorage.setItem("homeroom-friends", JSON.stringify(updated));
  }

  function saveJoinedSquads(updated: string[]) {
    setJoinedSquads(updated);
    localStorage.setItem("homeroom-joined-squads", JSON.stringify(updated));
  }

  function saveMySquads(updated: Squad[]) {
    setMySquads(updated);
    localStorage.setItem("homeroom-my-squads", JSON.stringify(updated));
  }

  function requestFriend(user: Friend) {
    if (friends.some((f) => f.id === user.id)) return;
    if (pendingFriends.some((f) => f.id === user.id)) return;
    const updated = [...pendingFriends, user];
    setPendingFriends(updated);
    localStorage.setItem("homeroom-pending-friends", JSON.stringify(updated));
  }

  function cancelRequest(id: string) {
    const updated = pendingFriends.filter((f) => f.id !== id);
    setPendingFriends(updated);
    localStorage.setItem("homeroom-pending-friends", JSON.stringify(updated));
  }

  function removeFriend(id: string) {
    saveFriends(friends.filter((f) => f.id !== id));
    setRemovingId(null);
  }

  function toggleSquad(squadId: string) {
    const updated = joinedSquads.includes(squadId)
      ? joinedSquads.filter((id) => id !== squadId)
      : [...joinedSquads, squadId];
    saveJoinedSquads(updated);
  }

  function handleSquadNameChange(raw: string) {
    const noSpaces = raw.replace(/\s/g, "").slice(0, 20);
    if (/[^a-zA-Z0-9]/.test(noSpaces)) {
      setNewSquadNameError("Only letters and numbers allowed");
      setNewSquadName(noSpaces.replace(/[^a-zA-Z0-9]/g, ""));
    } else {
      setNewSquadNameError("");
      setNewSquadName(noSpaces);
    }
  }

  function createSquad() {
    const name = newSquadName.trim();
    if (!name || newSquadNameError) return;
    const squad: Squad = {
      id: `custom-${Date.now()}`,
      name: `#${name}`,
      description: newSquadDesc.trim(),
      emoji: newSquadEmoji,
      members: 1,
      isPublic: !newSquadPrivate,
    };
    const updatedMySquads = [...mySquads, squad];
    saveMySquads(updatedMySquads);
    saveJoinedSquads([...joinedSquads, squad.id]);
    setNewSquadName("");
    setNewSquadNameError("");
    setNewSquadDesc("");
    setNewSquadEmoji("🏆");
    setNewSquadPrivate(false);
    setShowCreateSquad(false);
  }

  const friendResults = ALL_USERS.filter((u) =>
    !friends.some((f) => f.id === u.id) &&
    !pendingFriends.some((f) => f.id === u.id) &&
    (u.name.toLowerCase().includes(friendSearch.toLowerCase()) ||
     u.username.toLowerCase().includes(friendSearch.toLowerCase()))
  );

  const allSquads = [...ALL_SQUADS, ...mySquads];
  const squadResults = allSquads.filter((s) =>
    s.name.toLowerCase().includes(squadSearch.toLowerCase()) ||
    s.description.toLowerCase().includes(squadSearch.toLowerCase())
  );

  return (
    <div className="max-w-2xl mx-auto px-4 pb-24">
      <div className="pt-8 pb-4 flex items-center justify-between">
        <Link href="/home" className="flex items-center gap-1 text-warm-gray hover:text-charcoal">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span className="text-sm">Home</span>
        </Link>
        <span className="text-xs font-semibold tracking-widest text-sage uppercase">Profile</span>
        <div className="w-12" />
      </div>

      {/* Avatar */}
      <div className="text-center mb-8">
        <div
          className="relative w-20 h-20 mx-auto mb-3 cursor-pointer"
          onMouseEnter={() => setHoveringAvatar(true)}
          onMouseLeave={() => setHoveringAvatar(false)}
          onClick={() => setShowAvatarPicker(true)}
        >
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl"
            style={{ background: avatar ? "#F3F4F6" : "#7C9E87" }}
          >
            {avatar ?? <span className="text-white text-2xl font-bold">?</span>}
          </div>
          {hoveringAvatar && (
            <div className="absolute inset-0 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
          )}
        </div>
        {editingUsername ? (
          <div className="mt-1">
            <div className="flex items-center justify-center gap-2">
              <div
                className="flex items-center border rounded-xl px-3 py-1.5 bg-white"
                style={{ borderColor: usernameError ? "#F87171" : "#7C3AED" }}
              >
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => handleUsernameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveUsername(); if (e.key === "Escape") { setEditingUsername(false); setUsernameError(""); } }}
                  placeholder={username}
                  maxLength={15}
                  autoFocus
                  className="text-base font-bold text-charcoal bg-transparent focus:outline-none w-36 text-center"
                />
                <span className="text-xs text-warm-gray ml-1 flex-shrink-0">{usernameInput.length}/15</span>
              </div>
              <button onClick={saveUsername} disabled={!usernameInput.trim() || !!usernameError} className="text-xs font-semibold px-3 py-1.5 rounded-xl transition-opacity" style={{ background: "#7C3AED", color: "white", opacity: usernameInput.trim() && !usernameError ? 1 : 0.4 }}>
                Save
              </button>
              <button onClick={() => { setEditingUsername(false); setUsernameError(""); }} className="text-xs text-warm-gray hover:text-charcoal">
                Cancel
              </button>
            </div>
            {usernameError && <p className="text-xs text-red-400 mt-1">{usernameError}</p>}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <h1 className="text-xl font-bold text-charcoal">{username}</h1>
            <button onClick={() => { setEditingUsername(true); setUsernameInput(username); }} className="text-warm-gray hover:text-charcoal transition-colors mt-0.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
        )}
        <p className="text-sm text-warm-gray mt-0.5">Stats will appear as you use the app.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { label: "Sessions",   value: "0" },
          { label: "Tasks done", value: "0" },
          { label: "Hours in",   value: "0" },
          { label: "Day streak", value: "0" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 text-center">
            <div className="text-2xl font-bold text-charcoal">{s.value}</div>
            <div className="text-xs text-warm-gray mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Social buttons */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setShowFindFriends(true)}
          className="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-2xl py-3 text-sm font-semibold text-charcoal hover:border-sage hover:text-sage transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
          Find friends
        </button>
        <button
          onClick={() => setShowSquads(true)}
          className="flex-1 flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-2xl py-3 text-sm font-semibold text-charcoal hover:border-sage hover:text-sage transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          Explore squads
        </button>
      </div>

      {/* My squads */}
      {(joinedSquads.length > 0) && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-charcoal mb-3">My Squads</h2>
          <div className="space-y-2">
            {allSquads.filter((s) => joinedSquads.includes(s.id)).map((squad) => (
              <div key={squad.id} className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 px-4 py-3">
                <span className="text-xl flex-shrink-0">{squad.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-charcoal truncate">{squad.name}</p>
                    <span className="text-warm-gray flex-shrink-0">
                      {squad.isPublic ? <GlobeIcon /> : <LockIcon />}
                    </span>
                  </div>
                  <p className="text-xs text-warm-gray">{squad.members} member{squad.members !== 1 ? "s" : ""}</p>
                </div>
                <button
                  onClick={() => { setInviteSquadId(squad.id); setInviteSearch(""); setInviteSquadFilter([]); }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-gray-200 text-charcoal hover:border-sage hover:text-sage transition-colors flex-shrink-0"
                >
                  Invite
                </button>
                <button
                  onClick={() => toggleSquad(squad.id)}
                  className="text-xs text-warm-gray hover:text-red-400 transition-colors flex-shrink-0"
                >
                  Leave
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending requests */}
      {pendingFriends.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-charcoal mb-3">Pending · {pendingFriends.length}</h2>
          <div className="space-y-2">
            {pendingFriends.map((f) => (
              <div key={f.id} className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 px-4 py-3 group">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                  style={{ background: f.color }}
                >
                  {f.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-charcoal">{f.name}</p>
                  <p className="text-xs text-warm-gray">@{f.username}</p>
                </div>
                <span className="text-xs text-warm-gray border border-gray-200 rounded-full px-2.5 py-1 flex-shrink-0">Requested</span>
                <button
                  onClick={() => cancelRequest(f.id)}
                  className="opacity-0 group-hover:opacity-100 text-xs text-warm-gray hover:text-red-400 transition-all flex-shrink-0"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friends */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-charcoal">Friends · {friends.length}</h2>
        </div>
        {friends.length === 0 ? (
          <div className="text-center py-6 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">
            No friends yet. Find some above!
          </div>
        ) : (
          <div className="space-y-2">
            {friends.map((f) => (
              <div key={f.id} className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 px-4 py-3 group">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                  style={{ background: f.color }}
                >
                  {f.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-charcoal">{f.name}</p>
                  <p className="text-xs text-warm-gray">@{f.username}</p>
                </div>
                {removingId === f.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-warm-gray">Remove?</span>
                    <button onClick={() => removeFriend(f.id)} className="text-xs font-semibold text-red-500 hover:text-red-600">Yes</button>
                    <button onClick={() => setRemovingId(null)} className="text-xs text-warm-gray hover:text-charcoal">No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRemovingId(f.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs text-warm-gray hover:text-red-400 transition-all"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Session history */}
      <h2 className="text-sm font-semibold text-charcoal mb-3">Session History</h2>
      <div className="text-center py-8 text-warm-gray text-sm bg-white rounded-2xl border border-gray-100">
        No sessions yet.
      </div>

      {/* Avatar picker modal */}
      {showAvatarPicker && (
        <Modal title="Choose your avatar" onClose={() => setShowAvatarPicker(false)}>
          <div className="px-5 pb-5 overflow-y-auto">
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => saveAvatar(emoji)}
                  className="text-2xl h-12 w-full rounded-xl flex items-center justify-center transition-colors hover:bg-gray-100"
                  style={avatar === emoji ? { background: "#EDE9FE" } : {}}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* Find friends modal */}
      {showFindFriends && (
        <Modal title="Find friends" onClose={() => { setShowFindFriends(false); setFriendSearch(""); }}>
          <div className="px-5 pb-2 flex-shrink-0">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <span className="text-warm-gray"><SearchIcon /></span>
              <input
                type="text"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                placeholder="Search by name or username…"
                className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
                autoFocus
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-5 mt-2 space-y-2">
            {friendResults.length === 0 ? (
              <p className="text-sm text-warm-gray text-center py-6">
                {friendSearch ? "No results found." : "You're already friends with everyone!"}
              </p>
            ) : friendResults.map((user) => (
              <div key={user.id} className="flex items-center gap-3 py-2">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                  style={{ background: user.color }}
                >
                  {user.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-charcoal">{user.name}</p>
                  <p className="text-xs text-warm-gray">@{user.username}</p>
                </div>
                <button
                  onClick={() => requestFriend(user)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors"
                  style={{ background: "#7C3AED", color: "white" }}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Explore squads modal */}
      {showSquads && (
        <Modal title="Explore squads" onClose={() => { setShowSquads(false); setSquadSearch(""); setShowCreateSquad(false); }}>
          <div className="px-5 pb-2 flex-shrink-0">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 mb-3">
              <span className="text-warm-gray"><SearchIcon /></span>
              <input
                type="text"
                value={squadSearch}
                onChange={(e) => setSquadSearch(e.target.value)}
                placeholder="Search squads…"
                className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
                autoFocus
              />
            </div>
            <button
              onClick={() => setShowCreateSquad((v) => !v)}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-xl py-2.5 text-sm font-semibold text-warm-gray hover:border-sage hover:text-sage transition-colors mb-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
              </svg>
              Create a squad
            </button>
            {showCreateSquad && (
              <div className="bg-gray-50 rounded-2xl p-4 mb-2 space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const emojis = ["🏆","⚡","🔥","🌟","💎","🎯","🚀","🌊","🧠","💡"];
                      const i = emojis.indexOf(newSquadEmoji);
                      setNewSquadEmoji(emojis[(i + 1) % emojis.length]);
                    }}
                    className="text-2xl w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0"
                  >
                    {newSquadEmoji}
                  </button>
                  <div className="flex-1">
                    <div className="flex items-center border rounded-xl px-3 py-2 bg-white" style={{ borderColor: newSquadNameError ? "#F87171" : "#E5E7EB" }}>
                      <span className="text-sm text-warm-gray mr-0.5">#</span>
                      <input
                        type="text"
                        value={newSquadName}
                        onChange={(e) => handleSquadNameChange(e.target.value)}
                        placeholder="squadname"
                        maxLength={20}
                        className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
                      />
                      <span className="text-xs text-warm-gray ml-1 flex-shrink-0">{newSquadName.length}/20</span>
                    </div>
                    {newSquadNameError && (
                      <p className="text-xs text-red-400 mt-1 pl-1">{newSquadNameError}</p>
                    )}
                  </div>
                </div>
                <div>
                  <input
                    type="text"
                    value={newSquadDesc}
                    onChange={(e) => setNewSquadDesc(e.target.value.slice(0, 100))}
                    placeholder="Short description (optional)"
                    maxLength={100}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage"
                  />
                  {newSquadDesc.length > 0 && (
                    <p className="text-xs text-warm-gray mt-1 pl-1 text-right">{newSquadDesc.length}/100</p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-charcoal cursor-pointer">
                    <button
                      onClick={() => setNewSquadPrivate((v) => !v)}
                      className="inline-flex items-center w-9 h-5 rounded-full p-0.5 transition-colors"
                      style={{ background: newSquadPrivate ? "#7C3AED" : "#D1D5DB" }}
                    >
                      <span
                        className="w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"
                        style={{ transform: newSquadPrivate ? "translateX(16px)" : "translateX(0px)" }}
                      />
                    </button>
                    <span className="text-xs text-warm-gray">Private squad</span>
                  </label>
                  <button
                    onClick={createSquad}
                    disabled={!newSquadName.trim()}
                    className="text-xs font-semibold px-4 py-1.5 rounded-xl transition-opacity"
                    style={{ background: "#7C3AED", color: "white", opacity: newSquadName.trim() ? 1 : 0.4 }}
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
            {squadResults.map((squad) => {
              const joined = joinedSquads.includes(squad.id);
              return (
                <div key={squad.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <span className="text-2xl flex-shrink-0">{squad.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-charcoal">{squad.name}</p>
                    <p className="text-xs text-warm-gray truncate">{squad.description}</p>
                    <p className="text-xs text-warm-gray mt-0.5">{squad.members} member{squad.members !== 1 ? "s" : ""}</p>
                  </div>
                  <button
                    onClick={() => toggleSquad(squad.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors flex-shrink-0"
                    style={joined
                      ? { border: "1px solid #D1D5DB", color: "#78716C" }
                      : { background: "#7C3AED", color: "white", border: "1px solid #7C3AED" }}
                  >
                    {joined ? "Joined" : "Join"}
                  </button>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* Invite to squad modal */}
      {inviteSquadId && (() => {
        const squad = allSquads.find((s) => s.id === inviteSquadId)!;
        const alreadyInvited = invitedToSquad[inviteSquadId] ?? [];

        // Squads that at least one friend belongs to — used for filter pills
        const filterableSquads = allSquads.filter((s) =>
          friends.some((f) => (FRIEND_SQUAD_MEMBERSHIPS[f.id] ?? []).includes(s.id))
        );

        const visibleFriends = friends.filter((f) => {
          const matchesSearch =
            !inviteSearch ||
            f.name.toLowerCase().includes(inviteSearch.toLowerCase()) ||
            f.username.toLowerCase().includes(inviteSearch.toLowerCase());
          const matchesSquad =
            inviteSquadFilter.length === 0 ||
            inviteSquadFilter.some((sid) => (FRIEND_SQUAD_MEMBERSHIPS[f.id] ?? []).includes(sid));
          return matchesSearch && matchesSquad;
        });

        function inviteFriend(friendId: string) {
          if (alreadyInvited.includes(friendId)) return;
          setInvitedToSquad((prev) => ({
            ...prev,
            [inviteSquadId!]: [...(prev[inviteSquadId!] ?? []), friendId],
          }));
        }

        function toggleSquadFilter(sid: string) {
          setInviteSquadFilter((prev) =>
            prev.includes(sid) ? prev.filter((id) => id !== sid) : [...prev, sid]
          );
        }

        return (
          <Modal
            title={`Invite to ${squad.name}`}
            onClose={() => { setInviteSquadId(null); setInviteSearch(""); setInviteSquadFilter([]); }}
          >
            <div className="px-5 pb-2 flex-shrink-0 space-y-2">
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                <span className="text-warm-gray"><SearchIcon /></span>
                <input
                  type="text"
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder="Search friends by name…"
                  className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
                  autoFocus
                />
              </div>
              {filterableSquads.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {filterableSquads.map((s) => {
                    const active = inviteSquadFilter.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSquadFilter(s.id)}
                        className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                        style={active
                          ? { background: "#7C3AED", color: "white", borderColor: "#7C3AED" }
                          : { background: "white", color: "#78716C", borderColor: "#E5E7EB" }}
                      >
                        {s.emoji} {s.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 mt-1 space-y-1">
              {friends.length === 0 ? (
                <p className="text-sm text-warm-gray text-center py-6">No friends to invite yet.</p>
              ) : visibleFriends.length === 0 ? (
                <p className="text-sm text-warm-gray text-center py-6">No friends match this filter.</p>
              ) : visibleFriends.map((f) => {
                const invited = alreadyInvited.includes(f.id);
                const friendSquads = (FRIEND_SQUAD_MEMBERSHIPS[f.id] ?? [])
                  .map((sid) => allSquads.find((s) => s.id === sid))
                  .filter(Boolean) as typeof ALL_SQUADS;
                return (
                  <div key={f.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                      style={{ background: f.color }}
                    >
                      {f.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-charcoal">{f.name}</p>
                      {friendSquads.length > 0 ? (
                        <p className="text-xs text-warm-gray truncate">
                          {friendSquads.map((s) => s.name).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <button
                      onClick={() => inviteFriend(f.id)}
                      disabled={invited}
                      className="text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors flex-shrink-0"
                      style={invited
                        ? { border: "1px solid #D1D5DB", color: "#78716C" }
                        : { background: "#7C3AED", color: "white", border: "1px solid #7C3AED" }}
                    >
                      {invited ? "Invited" : "Invite"}
                    </button>
                  </div>
                );
              })}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
