"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { calculateMomentum, getMomentumZone, type MomentumResult, type SessionStat } from "@/lib/momentum";

// ─── Speedometer SVG ──────────────────────────────────────────────────────────

const CX = 140, CY = 150, RADIUS = 108, STROKE = 14, NEEDLE = 82, LABEL_R = 124;

const ZONES = [
  { label: "STUCK",    deg: 180 },
  { label: "SLOWING",  deg: 135 },
  { label: "STEADY",   deg: 90  },
  { label: "BUILDING", deg: 45  },
  { label: "SURGING",  deg: 0   },
];

function zonePos(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

function Speedometer({ score }: { score: number }) {
  const target = (score / 100) * 90;
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setRotation(target), 150);
    return () => clearTimeout(t);
  }, [target]);

  const arc = `M ${CX - RADIUS} ${CY} A ${RADIUS} ${RADIUS} 0 0 0 ${CX + RADIUS} ${CY}`;

  return (
    <svg viewBox="-8 -12 296 172" width="100%" aria-hidden="true">
      <defs>
        <linearGradient id="gaugeGrad" x1={CX - RADIUS} y1="0" x2={CX + RADIUS} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#F59E0B" />
          <stop offset="25%"  stopColor="#FCD34D" />
          <stop offset="50%"  stopColor="#D1D5DB" />
          <stop offset="75%"  stopColor="#5EEAD4" />
          <stop offset="100%" stopColor="#14B8A6" />
        </linearGradient>
        <filter id="nShadow">
          <feDropShadow dx="0.5" dy="1" stdDeviation="1.5" floodOpacity="0.18" />
        </filter>
      </defs>

      <path d={arc} fill="none" stroke="#EBEBE6" strokeWidth={STROKE} strokeLinecap="round" />
      <path d={arc} fill="none" stroke="url(#gaugeGrad)" strokeWidth={STROKE} strokeLinecap="round" />

      {ZONES.map((z) => {
        const p = zonePos(z.deg, LABEL_R);
        const dy = z.deg === 0 || z.deg === 180 ? -9 : 0;
        return (
          <text key={z.label} x={p.x} y={p.y + dy} textAnchor="middle" fontSize="7" fontWeight="700" letterSpacing="0.7" fill="#C0BDB5">
            {z.label}
          </text>
        );
      })}

      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transition: "transform 1.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
        filter="url(#nShadow)"
      >
        <line x1={CX} y1={CY + 6} x2={CX} y2={CY - NEEDLE} stroke="#111827" strokeWidth="2.5" strokeLinecap="round" />
      </g>

      <circle cx={CX} cy={CY} r="8.5" fill="#111827" />
      <circle cx={CX} cy={CY} r="4.5" fill="#FAFAF9" />
    </svg>
  );
}

// ─── Activity circle helper ────────────────────────────────────────────────────

function circleStyle(n: number): { size: number; fill: string; border: boolean } {
  if (n === 0) return { size: 8,  fill: "transparent", border: true  };
  if (n === 1) return { size: 18, fill: "var(--purple-muted)",     border: false };
  if (n === 2) return { size: 26, fill: "#8B5CF6",     border: false };
  return               { size: 36, fill: "var(--purple)",     border: false };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StuckTask { id: string; created_at: string }
interface RecentWin { text: string; created_at: string; completed_at: string; ageDays: number }

interface ProgressData {
  momentum: MomentumResult;
  stuckTasks: StuckTask[];
  completedThisWeek: number;
  completedLastWeek: number;
  sessionsThisWeek: number;
  activeThisMonth: number;
  dailySessionCounts: number[];
  weekDayLabels: string[];
  recentWins: RecentWin[];
  totalSessionCount: number;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ProgressPage() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setError(true); return; }

        const now = new Date();
        const msDay = 86400000;
        const oneWeekAgo    = new Date(now.getTime() - 7  * msDay);
        const twoWeeksAgo   = new Date(now.getTime() - 14 * msDay);
        const fiveWeeksAgo  = new Date(now.getTime() - 35 * msDay);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * msDay);

        const [stuckRes, statsRes, completedNowRes, completedPrevRes, winsRes, monthRes] = await Promise.all([
          supabase.from("tasks").select("id, created_at")
            .eq("user_id", user.id).eq("done", false).is("homeroom_id", null),

          supabase.from("homeroom_session_stats").select("*")
            .eq("user_id", user.id)
            .gte("ended_at", fiveWeeksAgo.toISOString())
            .order("ended_at", { ascending: true }),

          supabase.from("tasks").select("id", { count: "exact", head: true })
            .eq("user_id", user.id).eq("done", true)
            .gte("completed_at", oneWeekAgo.toISOString()),

          supabase.from("tasks").select("id", { count: "exact", head: true })
            .eq("user_id", user.id).eq("done", true)
            .gte("completed_at", twoWeeksAgo.toISOString())
            .lt("completed_at", oneWeekAgo.toISOString()),

          supabase.from("tasks").select("id, text, created_at, completed_at")
            .eq("user_id", user.id).eq("done", true)
            .gte("completed_at", oneWeekAgo.toISOString())
            .order("completed_at", { ascending: false })
            .limit(20),

          supabase.from("homeroom_session_stats").select("ended_at")
            .eq("user_id", user.id)
            .gte("ended_at", thirtyDaysAgo.toISOString()),
        ]);

        const stuckTasks: StuckTask[] = stuckRes.data ?? [];
        const sessionStats: SessionStat[] = statsRes.data ?? [];

        const stuckAgeDays = stuckTasks.map(t =>
          Math.floor((now.getTime() - new Date(t.created_at).getTime()) / msDay)
        );

        const momentum = calculateMomentum(stuckAgeDays, sessionStats);

        const sessionsThisWeek = sessionStats.filter(s =>
          new Date(s.ended_at).getTime() >= oneWeekAgo.getTime()
        ).length;

        // Daily session counts for last 7 days
        const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
        const dailySessionCounts = Array.from({ length: 7 }, (_, i) => {
          const dayStart = new Date(now);
          dayStart.setDate(dayStart.getDate() - (6 - i));
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          return sessionStats.filter(s => {
            const t = new Date(s.ended_at).getTime();
            return t >= dayStart.getTime() && t < dayEnd.getTime();
          }).length;
        });
        const weekDayLabels = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (6 - i));
          return DAY_LABELS[d.getDay()];
        });

        const activeDateSet = new Set(
          (monthRes.data ?? []).map(s => new Date(s.ended_at).toDateString())
        );

        const recentWins: RecentWin[] = (winsRes.data ?? [])
          .map(t => ({
            text: t.text as string,
            created_at: t.created_at as string,
            completed_at: t.completed_at as string,
            ageDays: Math.floor(
              (new Date(t.completed_at as string).getTime() - new Date(t.created_at as string).getTime()) / msDay
            ),
          }))
          .sort((a, b) => b.ageDays - a.ageDays)
          .slice(0, 3);

        // Total session count for empty state check
        const { count: totalCount } = await supabase
          .from("homeroom_session_stats")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id);

        setData({
          momentum,
          stuckTasks,
          completedThisWeek: completedNowRes.count ?? 0,
          completedLastWeek: completedPrevRes.count ?? 0,
          sessionsThisWeek,
          activeThisMonth: activeDateSet.size,
          dailySessionCounts,
          weekDayLabels,
          recentWins,
          totalSessionCount: totalCount ?? 0,
        });
      } catch {
        setError(true);
      }
    })();
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (!data && !error) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-10 pb-28 flex items-center justify-center" style={{ minHeight: 300 }}>
        <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!data || data.totalSessionCount < 3) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-28 space-y-4">
        <div>
          <h1 className="text-3xl font-bold text-charcoal" style={{ letterSpacing: "-0.5px" }}>Progress</h1>
          <p className="text-sm text-warm-gray mt-1">Your focus history at a glance.</p>
        </div>

        <div className="bg-white rounded-3xl border p-5" style={{ borderColor: "var(--border-2)", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <Speedometer score={0} />
          <div className="text-center mt-1">
            <div className="text-4xl font-bold" style={{ color: "var(--text-3)", letterSpacing: "-2px" }}>—</div>
            <div className="text-sm font-semibold mt-1" style={{ color: "var(--text-3)" }}>Just getting started</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border p-5" style={{ borderColor: "var(--border-2)" }}>
          <div className="text-2xl mb-3">✨</div>
          <p className="text-sm font-semibold text-charcoal mb-1.5">
            Your insights will appear here as you complete sessions.
          </p>
          <p className="text-sm text-warm-gray leading-relaxed">
            The more you use Homeroom, the more useful this page gets — personalized stats, momentum tracking, and wins tailored to how you work.
          </p>
        </div>

        <div className="bg-white rounded-2xl border p-5 space-y-4" style={{ borderColor: "var(--border-2)" }}>
          <div>
            <p className="text-sm font-bold text-charcoal">Tips to get started</p>
            <p className="text-xs text-warm-gray mt-0.5">A few things worth trying</p>
          </div>
          {[
            { icon: "🎯", text: "Add tasks to My List before your first session so you have something to focus on." },
            { icon: "🏠", text: "Join a public Homeroom to see what a live session feels like." },
            { icon: "📅", text: "Schedule a session for a time you know you'll be free — even 25 minutes counts." },
          ].map((tip, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0 mt-0.5">{tip.icon}</span>
              <p className="text-sm text-charcoal leading-relaxed">{tip.text}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border p-5 text-center" style={{ background: "var(--green-bg)", borderColor: "var(--green-border)" }}>
          <div className="text-2xl mb-2">🏆</div>
          <p className="text-sm font-semibold text-charcoal">Complete your first task to see your wins here</p>
          <Link
            href="/start"
            className="inline-block mt-3 text-xs font-semibold px-5 py-2.5 rounded-xl text-white transition-opacity hover:opacity-85"
            style={{ background: "var(--purple)" }}
          >
            Start a Homeroom
          </Link>
        </div>
      </div>
    );
  }

  // ── Full page ────────────────────────────────────────────────────────────────
  const { momentum, stuckTasks, completedThisWeek, completedLastWeek, sessionsThisWeek, activeThisMonth, dailySessionCounts, weekDayLabels, recentWins } = data;

  const taskDelta = completedThisWeek - completedLastWeek;
  const trendUp = momentum.trendDelta >= 0;

  // Oldest stuck task
  const oldestStuckDays = stuckTasks.length > 0
    ? Math.max(...stuckTasks.map(t => Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000)))
    : 0;

  // Dynamic insights
  const insights: { icon: string; bg: string; text: ReactNode; linkHref: string; linkLabel: string; linkColor: string }[] = [];
  if (momentum.trendDelta > 5) {
    insights.push({
      icon: "⚡",
      bg: "var(--purple-bg)",
      text: <><strong>Your momentum is climbing</strong> — up {momentum.trendDelta} points this week. Keep the streak alive.</>,
      linkHref: "/home",
      linkLabel: "Find a Homeroom →",
      linkColor: "var(--purple)",
    });
  } else if (sessionsThisWeek === 0) {
    insights.push({
      icon: "🗓️",
      bg: "#FEF3C7",
      text: <>No sessions yet this week. <strong>Even one short Homeroom</strong> can shift your momentum in the right direction.</>,
      linkHref: "/start",
      linkLabel: "Start one now →",
      linkColor: "#B45309",
    });
  } else {
    insights.push({
      icon: "🌱",
      bg: "#CCFBF1",
      text: <>{sessionsThisWeek === 1 ? "You've started the week" : `You've done ${sessionsThisWeek} sessions this week`}. <strong>Consistency builds momentum</strong> — aim for one more.</>,
      linkHref: "/home",
      linkLabel: "Join a session →",
      linkColor: "#0D9488",
    });
  }
  if (stuckTasks.length > 0) {
    const stuckCount = stuckTasks.filter(t =>
      Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) >= 8
    ).length;
    if (stuckCount > 0) {
      insights.push({
        icon: "📦",
        bg: "#FEF3C7",
        text: <>You have <strong>{stuckCount} task{stuckCount !== 1 ? "s" : ""} that could use attention</strong>. Finishing even one is a win.</>,
        linkHref: "/start",
        linkLabel: "Tackle them →",
        linkColor: "#B45309",
      });
    }
  }
  if (completedThisWeek > 0 && taskDelta > 0) {
    insights.push({
      icon: "🎯",
      bg: "#CCFBF1",
      text: <>You closed <strong>{completedThisWeek} task{completedThisWeek !== 1 ? "s" : ""} this week</strong> — {taskDelta} more than last week. Strong follow-through.</>,
      linkHref: "/list",
      linkLabel: "Open My List →",
      linkColor: "#0D9488",
    });
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-28 space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-charcoal" style={{ letterSpacing: "-0.5px" }}>Progress</h1>
        <p className="text-sm text-warm-gray mt-1">Your focus history at a glance.</p>
      </div>

      {/* ── Momentum card ───────────────────────────────────────────────────── */}
      <div
        className="bg-white rounded-3xl border"
        style={{ borderColor: "var(--border-2)", boxShadow: "0 2px 14px rgba(0,0,0,0.07)", padding: "20px 20px 24px" }}
      >
        <Speedometer score={momentum.displayedScore} />
        <div className="text-center mt-2">
          <div className="font-bold" style={{ fontSize: 52, letterSpacing: "-3px", lineHeight: 1, color: "var(--text)" }}>
            {momentum.displayedScore > 0 ? "+" : ""}{momentum.displayedScore}
          </div>
          <div className="text-sm font-semibold mt-1.5" style={{ color: "var(--text-2)" }}>
            {getMomentumZone(momentum.displayedScore)}
          </div>
          {momentum.trendDelta !== 0 && (
            <div
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full mt-3"
              style={trendUp ? { background: "var(--green-bg)", color: "var(--green-text)" } : { background: "var(--yellow-bg)", color: "var(--yellow-text)" }}
            >
              {trendUp ? "↑" : "↓"} {Math.abs(momentum.trendDelta)} this week
            </div>
          )}
        </div>
      </div>

      {/* ── Metric grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">

        {/* Tasks Closed */}
        <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
          <div className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Tasks Closed</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1px" }}>{completedThisWeek}</div>
          <div className="text-xs text-warm-gray mt-0.5">this week</div>
          {taskDelta !== 0 && (
            <div className="text-xs font-semibold mt-2.5" style={{ color: taskDelta > 0 ? "var(--green-text)" : "var(--yellow-text)" }}>
              {taskDelta > 0 ? "↑" : "↓"} {Math.abs(taskDelta)} from last week
            </div>
          )}
          {taskDelta === 0 && completedLastWeek > 0 && (
            <div className="text-xs font-medium mt-2.5" style={{ color: "var(--text-2)" }}>Same as last week</div>
          )}
        </div>

        {/* Stuck Tasks */}
        <div
          className="rounded-2xl border p-4"
          style={{ background: "var(--yellow-bg)", borderColor: "var(--yellow-border, #FDE68A)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--yellow-text)" }}>Stuck Tasks</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1px" }}>
            {stuckTasks.filter(t => Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) >= 8).length}
          </div>
          {oldestStuckDays >= 8 && (
            <div className="text-xs font-medium mt-0.5" style={{ color: "var(--yellow-text)" }}>Oldest: {oldestStuckDays} days</div>
          )}
          {stuckTasks.length === 0 && (
            <div className="text-xs text-warm-gray mt-0.5">All clear!</div>
          )}
          <button
            onClick={() => { window.location.href = "/start"; }}
            className="mt-2.5 text-xs font-semibold w-full py-1.5 rounded-lg text-white transition-all active:scale-95 hover:opacity-90"
            style={{ background: "#F59E0B" }}
          >
            Tackle these →
          </button>
        </div>

        {/* Sessions */}
        <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
          <div className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Sessions</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1px" }}>{sessionsThisWeek}</div>
          <div className="text-xs text-warm-gray mt-0.5">this week</div>
          <div className="text-xs font-medium mt-2.5" style={{ color: "var(--text-2)" }}>
            {data.totalSessionCount} total all time
          </div>
        </div>

        {/* Active Days */}
        <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
          <div className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Active Days</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1px" }}>{activeThisMonth}</div>
          <div className="text-xs text-warm-gray mt-0.5">last 30 days</div>
        </div>
      </div>

      {/* ── Weekly activity ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
        <div className="flex items-baseline justify-between mb-5">
          <p className="text-sm font-bold text-charcoal">This week</p>
          <p className="text-xs text-warm-gray">circle size = activity</p>
        </div>
        <div className="flex justify-between items-end">
          {weekDayLabels.map((label, i) => {
            const n = dailySessionCounts[i];
            const isToday = i === 6;
            const { size, fill, border } = circleStyle(n);
            const MAX = 36;
            return (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="flex items-end justify-center" style={{ height: MAX + 10, width: MAX + 4 }}>
                  <div
                    style={{
                      width: size, height: size, borderRadius: "50%", background: fill,
                      border: border ? "1.5px solid var(--border-3)" : "none",
                      boxShadow: isToday ? "0 0 0 3px rgba(124,58,237,0.15), 0 0 0 6px rgba(124,58,237,0.07)" : "none",
                      flexShrink: 0,
                    }}
                  />
                </div>
                <span className="text-xs font-semibold" style={{ color: isToday ? "var(--purple)" : "var(--text-3)" }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Insights card ───────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-sm font-bold text-charcoal">Insights for you</p>
            <p className="text-xs text-warm-gray">based on your data</p>
          </div>
          <div className="space-y-4">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: ins.bg, fontSize: 16 }}>
                  {ins.icon}
                </div>
                <div>
                  <p className="text-sm leading-snug" style={{ color: "var(--text)" }}>{ins.text}</p>
                  <Link href={ins.linkHref} className="text-xs font-semibold mt-1 inline-block hover:opacity-70 transition-opacity" style={{ color: ins.linkColor }}>
                    {ins.linkLabel}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Wins ──────────────────────────────────────────────────────── */}
      {recentWins.length > 0 && (
        <div
          className="rounded-2xl border p-4"
          style={{ background: "var(--green-bg)", borderColor: "var(--green-border)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        >
          <div className="flex items-baseline justify-between mb-4">
            <p className="text-sm font-bold" style={{ color: "var(--green-text)" }}>Recent wins</p>
            <p className="text-xs" style={{ color: "var(--green-text)", opacity: 0.75 }}>last 7 days</p>
          </div>
          <div className="space-y-3.5">
            {recentWins.map((win, i) => {
              const icon = win.ageDays >= 30 ? "🔥" : win.ageDays >= 14 ? "🎉" : "✅";
              const subtitle = win.ageDays >= 14
                ? `After ${win.ageDays} days — breakthrough!`
                : `Completed ${win.ageDays === 0 ? "today" : `${win.ageDays}d ago`}`;
              return (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--green-text)" }}>&ldquo;{win.text}&rdquo;</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--green-text)", opacity: 0.75 }}>{subtitle}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty wins placeholder */}
      {recentWins.length === 0 && (
        <div className="rounded-2xl border p-5 text-center" style={{ background: "var(--green-bg)", borderColor: "var(--green-border)" }}>
          <div className="text-2xl mb-2">🏆</div>
          <p className="text-sm font-semibold text-charcoal">Complete tasks this week to see your wins here</p>
          <Link
            href="/start"
            className="inline-block mt-3 text-xs font-semibold px-5 py-2.5 rounded-xl text-white transition-opacity hover:opacity-85"
            style={{ background: "var(--purple)" }}
          >
            Start a Homeroom
          </Link>
        </div>
      )}

    </div>
  );
}
