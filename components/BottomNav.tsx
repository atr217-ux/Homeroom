"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export default function BottomNav() {
  const pathname = usePathname();
  const roomActive = pathname.startsWith("/room");
  const [roomHref, setRoomHref] = useState("/start");
  const [homeNotif, setHomeNotif] = useState(false);
  const [profileNotif, setProfileNotif] = useState(false);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const activeId = localStorage.getItem("homeroom-active-id");
    if (activeId) { setRoomHref(`/room?id=${activeId}`); return; }
    // No localStorage — check DB for an active session on this account
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: rows } = await supabase
        .from("homeroom_participants")
        .select("homeroom_id")
        .eq("user_id", user.id);
      const ids = (rows ?? []).map(r => r.homeroom_id as string);
      if (!ids.length) return;
      const { data: h } = await supabase
        .from("homerooms")
        .select("id")
        .in("id", ids)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (h) {
        localStorage.setItem("homeroom-active-id", h.id);
        setRoomHref(`/room?id=${h.id}`);
      }
    })();
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();

    async function fetchCounts(userId: string, username: string) {
      // Fetch pending invites with homeroom status so we can exclude completed rooms
      const { data: inviteRows } = await supabase
        .from("homeroom_invites")
        .select("id, homerooms(status)")
        .eq("to_user", userId)
        .eq("status", "pending");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const validInviteCount = (inviteRows ?? []).filter(r => {
        const h = Array.isArray((r as any).homerooms) ? (r as any).homerooms[0] : (r as any).homerooms;
        return h && h.status !== "completed";
      }).length;
      setHomeNotif(validInviteCount > 0);

      if (username) {
        const [{ count: frCount }, { count: sqCount }] = await Promise.all([
          supabase.from("friend_requests").select("id", { count: "exact", head: true }).eq("to_username", username).eq("status", "pending"),
          supabase.from("squad_invites").select("id", { count: "exact", head: true }).eq("to_username", username).eq("status", "pending"),
        ]);
        setProfileNotif((frCount ?? 0) + (sqCount ?? 0) > 0);
      }
    }

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const username = localStorage.getItem("homeroom-username") ?? "";

      // Presence heartbeat
      const pingPresence = () =>
        supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", user.id).then(() => {});
      pingPresence();
      heartbeatRef.current = setInterval(pingPresence, 90_000);

      await fetchCounts(user.id, username);

      let ch = supabase
        .channel("bottom-nav-notifs")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "homeroom_invites", filter: `to_user=eq.${user.id}` }, () => fetchCounts(user.id, username))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "homeroom_invites", filter: `to_user=eq.${user.id}` }, () => fetchCounts(user.id, username));

      if (username) {
        ch = ch
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "friend_requests", filter: `to_username=eq.${username}` }, () => fetchCounts(user.id, username))
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "friend_requests", filter: `to_username=eq.${username}` }, () => fetchCounts(user.id, username))
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "squad_invites", filter: `to_username=eq.${username}` }, () => fetchCounts(user.id, username))
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "squad_invites", filter: `to_username=eq.${username}` }, () => fetchCounts(user.id, username));
      }

      channelRef.current = ch.subscribe();

      const userId = user.id;
      function onVisibility() {
        if (document.visibilityState === "visible") fetchCounts(userId, username);
      }
      document.addEventListener("visibilitychange", onVisibility);
    });

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leftTabs = [
    {
      href: "/home",
      label: "Home",
      notif: homeNotif,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
    },
    {
      href: "/list",
      label: "My List",
      notif: false,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      ),
    },
  ];

  const rightTabs = [
    {
      href: "/progress",
      label: "Progress",
      notif: false,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19a9 9 0 1 1 14 0" />
          <line x1="12" y1="19" x2="16.5" y2="10" />
          <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
    {
      href: "/profile",
      label: "Profile",
      notif: profileNotif,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 flex items-end">
      {leftTabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors relative"
            style={{ color: active ? "#7C3AED" : "#78716C" }}
          >
            <div className="relative">
              {tab.icon}
              {tab.notif && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white" style={{ background: "#DC2626" }} />
              )}
            </div>
            {tab.label}
          </Link>
        );
      })}

      {/* Centre Room button */}
      <div className="flex-1 flex flex-col items-center pb-3" style={{ marginTop: "-22px" }}>
        <Link href={roomHref} className="flex flex-col items-center gap-1">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
            style={{
              background: roomActive ? "#6D28D9" : "#7C3AED",
              boxShadow: "0 4px 14px rgba(124,58,237,0.45)",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <span className="text-xs font-medium" style={{ color: roomActive ? "#7C3AED" : "#78716C" }}>
            Room
          </span>
        </Link>
      </div>

      {rightTabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors"
            style={{ color: active ? "#7C3AED" : "#78716C" }}
          >
            <div className="relative">
              {tab.icon}
              {tab.notif && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white" style={{ background: "#DC2626" }} />
              )}
            </div>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
