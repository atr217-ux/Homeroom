"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
};

const TABS: Tab[] = [
  {
    href: "/home",
    label: "Home",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z" />
      </svg>
    ),
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    href: "/progress",
    label: "Progress",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <polyline points="7 14 11 10 15 13 21 7" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  const todayActive = pathname?.startsWith("/today");

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="max-w-2xl mx-auto px-2 pt-2 pb-3 flex items-end justify-around relative">
        {TABS.slice(0, 2).map((t) => (
          <TabLink key={t.href} tab={t} active={pathname?.startsWith(t.href) ?? false} />
        ))}

        {/* Center: Today */}
        <Link
          href="/today"
          className="flex flex-col items-center justify-center -mt-7"
          aria-label="Today"
        >
          <span
            className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
            style={{
              background: "var(--purple)",
              boxShadow: todayActive
                ? "0 4px 16px rgba(124,58,237,0.45)"
                : "0 2px 10px rgba(124,58,237,0.3)",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="12" y1="14" x2="12" y2="18" />
              <line x1="10" y1="16" x2="14" y2="16" />
            </svg>
          </span>
          <span
            className="text-[10px] font-semibold mt-1"
            style={{ color: todayActive ? "var(--purple)" : "var(--text-2)" }}
          >
            Today
          </span>
        </Link>

        {TABS.slice(2).map((t) => (
          <TabLink key={t.href} tab={t} active={pathname?.startsWith(t.href) ?? false} />
        ))}
      </div>
    </nav>
  );
}

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      className="flex flex-col items-center justify-center py-1 px-3 transition-colors"
      style={{ color: active ? "var(--purple)" : "var(--text-2)" }}
    >
      {tab.icon(active)}
      <span
        className="text-[10px] mt-0.5 font-medium"
        style={{ color: active ? "var(--purple)" : "var(--text-2)" }}
      >
        {tab.label}
      </span>
    </Link>
  );
}
