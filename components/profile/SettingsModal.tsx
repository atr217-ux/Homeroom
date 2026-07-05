"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SettingToggle from "@/components/SettingToggle";

type Settings = {
  autoPrivateTasks: boolean;
  searchable: boolean;
};

type Props = {
  userId: string;
  onClose: () => void;
};

export default function SettingsModal({ userId, onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await createClient()
        .from("profiles")
        .select("auto_private_tasks, searchable")
        .eq("id", userId)
        .maybeSingle();
      if (data) {
        setSettings({
          autoPrivateTasks: (data.auto_private_tasks as boolean) ?? false,
          searchable: (data.searchable as boolean) ?? true,
        });
      }
    }
    load();
  }, [userId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>Settings</h2>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--text-2)" }}>Close</button>
        </div>

        {!settings ? (
          <div className="flex items-center justify-center py-8">
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
            />
          </div>
        ) : (
          <>
            {/* Tasks */}
            <div className="mb-5">
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--purple)" }}>
                Tasks
              </div>
              <div
                className="rounded-2xl border"
                style={{ background: "var(--bg)", borderColor: "var(--border)" }}
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
            </div>

            {/* Friends & Squads */}
            <div className="mb-1">
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--purple)" }}>
                Friends &amp; Squads
              </div>
              <div
                className="rounded-2xl border"
                style={{ background: "var(--bg)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                      Discoverable by others
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>
                      When on, others can find you in search and send you requests. Turn off to stay invisible; existing friends are unaffected.
                    </div>
                  </div>
                  <SettingToggle
                    value={settings.searchable}
                    onChange={(v) => update({ searchable: v })}
                    ariaLabel="Discoverable by others"
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
