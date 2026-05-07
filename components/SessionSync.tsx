"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SessionSync() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/welcome");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (profile) {
        const storedUsername = localStorage.getItem("homeroom-username");
        localStorage.setItem("homeroom-username", profile.username);
        localStorage.setItem("homeroom-avatar", profile.avatar ?? "");
        if (storedUsername !== profile.username) {
          router.refresh();
        }
      } else {
        await supabase.auth.signOut();
        router.replace("/welcome");
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch the active room for completion when the user has navigated away from it
  useEffect(() => {
    const onRoomPage = pathname.startsWith("/room");
    if (onRoomPage) return; // Room page handles its own end detection

    const activeId = localStorage.getItem("homeroom-active-id");
    if (!activeId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`session-sync-room-${activeId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "homerooms", filter: `id=eq.${activeId}` },
        (payload) => {
          if ((payload.new as { status: string }).status === "completed") {
            router.push(`/room?id=${activeId}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
