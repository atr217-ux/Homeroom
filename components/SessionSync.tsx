"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SessionSync() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const username = localStorage.getItem("homeroom-username");
    if (username) return; // Already have local state, nothing to do

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
        localStorage.setItem("homeroom-username", profile.username);
        localStorage.setItem("homeroom-avatar", profile.avatar ?? "");
        // Force re-render of current page to pick up new localStorage values
        router.refresh();
      } else {
        // Authenticated but no profile row — send back to register
        await supabase.auth.signOut();
        router.replace("/welcome");
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
