"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SessionSync() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace("/welcome"); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, avatar")
        .eq("id", session.user.id)
        .single();
      if (profile) {
        const storedUsername = localStorage.getItem("homeroom-username");
        localStorage.setItem("homeroom-username", profile.username);
        localStorage.setItem("homeroom-avatar", profile.avatar ?? "");
        if (storedUsername !== profile.username) router.refresh();
      } else {
        await supabase.auth.signOut();
        router.replace("/welcome");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
