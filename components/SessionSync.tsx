"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SessionSync() {
  const router = useRouter();

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
        // Refresh if the username changed so all components pick up the correct value
        if (storedUsername !== profile.username) {
          router.refresh();
        }
      } else {
        // Authenticated but no profile row — send back to register
        await supabase.auth.signOut();
        router.replace("/welcome");
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
