"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BlockInvites from "@/components/BlockInvites";

export default function HomePage() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    }
    init();
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 pt-10 pb-32">
      <div className="pb-6">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-3 uppercase tracking-wide"
          style={{ background: "rgba(124,58,237,0.12)", color: "var(--purple)" }}
        >
          Home
        </span>
        <h1
          className="font-display italic leading-none"
          style={{ color: "var(--text)", fontSize: "clamp(3rem, 12vw, 4.5rem)" }}
        >
          Homeroom
        </h1>
      </div>

      {userId && <BlockInvites userId={userId} />}
    </div>
  );
}
