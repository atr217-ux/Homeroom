"use client";

import ThemeToggle from "@/components/ThemeToggle";

export default function ProfilePage() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-12">
      <h1
        className="font-display italic leading-none mb-6"
        style={{ color: "var(--text)", fontSize: "clamp(3rem, 12vw, 4.5rem)" }}
      >
        Profile
      </h1>

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

      <p className="text-sm text-center mt-8" style={{ color: "var(--text-2)" }}>
        Friends and Squads coming in Phase 4
      </p>
    </div>
  );
}
