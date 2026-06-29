"use client";

import { useTheme } from "@/lib/theme";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="relative inline-flex items-center w-14 h-8 rounded-full transition-colors flex-shrink-0"
      style={{ background: isDark ? "var(--purple)" : "var(--border-2)" }}
    >
      <span
        className="absolute top-1 w-6 h-6 rounded-full shadow-md transition-transform flex items-center justify-center"
        style={{
          background: "var(--surface)",
          transform: isDark ? "translateX(28px)" : "translateX(4px)",
          color: isDark ? "var(--purple)" : "var(--text-2)",
        }}
      >
        {isDark ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        )}
      </span>
    </button>
  );
}
