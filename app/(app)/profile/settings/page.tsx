"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SettingToggle from "@/components/SettingToggle";

type Settings = {
  autoPrivateTasks: boolean;
  searchable: boolean;
};

export default function SettingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase
        .from("profiles")
        .select("auto_private_tasks, searchable")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        setSettings({
          autoPrivateTasks: (data.auto_private_tasks as boolean) ?? false,
          searchable: (data.searchable as boolean) ?? true,
        });
      }
    }
    load();
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!userId || !settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    await createClient()
      .from("profiles")
      .update({
        auto_private_tasks: next.autoPrivateTasks,
        searchable: next.searchable,
      })
      .eq("id", userId);
  }

  if (!settings) {
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
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-24">
      {/* Back */}
      <Link href="/profile" className="inline-flex items-center gap-1 text-sm mb-4" style={{ color: "var(--text-2)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Profile
      </Link>

      <h1
        className="font-display italic leading-none mb-6"
        style={{ color: "var(--text)", fontSize: "clamp(2.5rem, 10vw, 3.5rem)" }}
      >
        Settings
      </h1>

      {/* Tasks section */}
      <section className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--purple)" }}>
          Tasks
        </div>
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Auto-set tasks to private
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>
                New tasks are private by default. Private tasks never appear on friends&apos; feeds.
              </div>
            </div>
            <SettingToggle
              value={settings.autoPrivateTasks}
              onChange={(v) => update({ autoPrivateTasks: v })}
              ariaLabel="Auto-set tasks to private"
            />
          </div>
        </div>
      </section>

      {/* Friends & Squads section */}
      <section className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--purple)" }}>
          Friends & Squads
        </div>
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Discoverable by others
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>
                When on, others can find you in the friend search and send you requests. Turn off to stay invisible; existing friends are unaffected.
              </div>
            </div>
            <SettingToggle
              value={settings.searchable}
              onChange={(v) => update({ searchable: v })}
              ariaLabel="Discoverable by others"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
