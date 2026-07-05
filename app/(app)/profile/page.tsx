"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/auth/actions";
import ThemeToggle from "@/components/ThemeToggle";
import FriendsPanel from "@/components/profile/FriendsPanel";
import SquadsPanel from "@/components/profile/SquadsPanel";

type Me = {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
};

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, email, avatar")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        setMe({
          id: user.id,
          username: profile.username as string,
          email: (profile.email as string) ?? user.email ?? "",
          avatar: (profile.avatar as string | null) ?? null,
        });
      }
    }
    load();
  }, []);

  if (!me) {
    return (
      <div className="flex items-center justify-center pt-32">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-10 pb-24">
      <h1
        className="font-display italic leading-none mb-1"
        style={{ color: "var(--text)", fontSize: "clamp(3rem, 12vw, 4.5rem)" }}
      >
        Profile
      </h1>

      {/* Account header */}
      <section
        className="rounded-2xl border p-4 mb-4 flex items-center gap-3"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <span
          className="w-14 h-14 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
          style={{ background: "var(--surface-2)" }}
        >
          {me.avatar || me.username[0]?.toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold truncate" style={{ color: "var(--text)" }}>
            {me.username}
          </div>
          <div className="text-xs truncate" style={{ color: "var(--text-2)" }}>
            {me.email}
          </div>
        </div>
        <Link
          href="/profile/settings"
          className="p-2 rounded-full transition-opacity hover:opacity-100"
          style={{ color: "var(--text-2)", opacity: 0.7 }}
          aria-label="Settings"
          title="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </Link>
      </section>

      <FriendsPanel userId={me.id} username={me.username} />
      <SquadsPanel username={me.username} />

      {/* Appearance */}
      <section
        className="rounded-2xl border p-4 mb-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Dark mode
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>
              Toggle between light and dark themes
            </div>
          </div>
          <ThemeToggle />
        </div>
      </section>

      {/* Sign out */}
      <form action={signOut}>
        <button
          type="submit"
          className="w-full text-sm font-semibold py-3 rounded-2xl border transition-colors"
          style={{ borderColor: "var(--border-2)", color: "var(--red)", background: "var(--surface)" }}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
