"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { calculateMomentum, getMomentumZone, type MomentumResult, type SessionStat } from "@/lib/momentum";

// ─── Speedometer SVG ──────────────────────────────────────────────────────────

const CX = 140, CY = 150, RADIUS = 108, STROKE = 14, LABEL_R = 128;

// score -100 → 180° (left), score 0 → 90° (top), score +100 → 0° (right)
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

// Adjust label anchor/offset so they don't collide with the arc
function zoneLabelProps(deg: number): { textAnchor: "start" | "middle" | "end"; dx: number; dy: number } {
  if (deg === 180) return { textAnchor: "end",    dx: -2, dy: 0   };
  if (deg === 135) return { textAnchor: "end",    dx:  0, dy: -6  };
  if (deg === 90)  return { textAnchor: "middle", dx:  0, dy: -10 };
  if (deg === 45)  return { textAnchor: "start",  dx:  0, dy: -6  };
  return                   { textAnchor: "start",  dx:  2, dy: 0   };
}

function Speedometer({ score }: { score: number }) {
  // Ring starts at arc top (score 0). +90deg CSS = right (+100), -90deg = left (-100)
  const target = (score / 100) * 90;
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setRotation(target), 150);
    return () => clearTimeout(t);
  }, [target]);

  const arc = `M ${CX - RADIUS} ${CY} A ${RADIUS} ${RADIUS} 0 0 1 ${CX + RADIUS} ${CY}`;
  const scoreLabel = (score > 0 ? "+" : "") + score;
  const zone = getMomentumZone(score);

  return (
    <svg viewBox="-40 -20 360 210" width="100%" aria-hidden="true">
      <defs>
        <linearGradient id="gaugeGrad" x1={CX - RADIUS} y1="0" x2={CX + RADIUS} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#F59E0B" />
          <stop offset="28%"  stopColor="#FCD34D" />
          <stop offset="50%"  stopColor="#EDE8E1" />
          <stop offset="72%"  stopColor="#6EE7DA" />
          <stop offset="100%" stopColor="#14B8A6" />
        </linearGradient>
      </defs>

      {/* Background track (slightly wider so it shows as a subtle border) */}
      <path d={arc} fill="none" stroke="#C8C4BF" strokeWidth={STROKE + 2} strokeLinecap="round" />
      {/* Gradient arc */}
      <path d={arc} fill="none" stroke="url(#gaugeGrad)" strokeWidth={STROKE} strokeLinecap="round" />

      {/* Zone labels */}
      {ZONES.map((z) => {
        const p = zonePos(z.deg, LABEL_R);
        const { textAnchor, dx, dy } = zoneLabelProps(z.deg);
        return (
          <text key={z.label} x={p.x + dx} y={p.y + dy} textAnchor={textAnchor} fontSize="7" fontWeight="700" letterSpacing="0.7" fill="#C0BDB5">
            {z.label}
          </text>
        );
      })}

      {/* Needle — rotates from top. +90deg=right(+100), -90deg=left(-100) */}
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transition: "transform 1.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <line x1={CX} y1={CY + 8} x2={CX} y2={CY - RADIUS + 14} stroke="#111827" strokeWidth="3" strokeLinecap="round" />
      </g>
      {/* Pivot */}
      <circle cx={CX} cy={CY} r="8" fill="#111827" />
      <circle cx={CX} cy={CY} r="4" fill="white" />

      {/* Scale markers */}
      <text x={CX - RADIUS} y={CY + 22} textAnchor="middle" fontSize="8" fontWeight="600" fill="#C0BDB5">-100</text>
      <text x={CX}          y={CY + 22} textAnchor="middle" fontSize="8" fontWeight="600" fill="#C0BDB5">0</text>
      <text x={CX + RADIUS} y={CY + 22} textAnchor="middle" fontSize="8" fontWeight="600" fill="#C0BDB5">+100</text>
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

interface StuckTask { id: string; text: string; created_at: string }
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

const MIN_SESSIONS = 3;

export default function ProgressPage() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showStuckModal, setShowStuckModal] = useState(false);

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

        const [stuckRes, statsRes, completedNowRes, completedPrevRes, winsRes, homesRes, scheduledRes] = await Promise.all([
          supabase.from("tasks").select("id, text, created_at")
            .eq("user_id", user.id).eq("done", false).is("homeroom_id", null),

          // Used only for momentum math — may be empty if table isn't set up yet
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

          // Reliable session source: completed homerooms the user created
          supabase.from("homerooms").select("id, ended_at")
            .eq("created_by", user.id)
            .eq("status", "completed")
            .not("ended_at", "is", null),

          // Scheduled homerooms: used for scheduling momentum score
          supabase.from("homerooms").select("id, created_at")
            .eq("created_by", user.id)
            .not("scheduled_for", "is", null)
            .gte("created_at", fiveWeeksAgo.toISOString()),
        ]);

        if (homesRes.error) { console.error("[progress] homerooms query error:", homesRes.error.message); setError(true); return; }
        if (statsRes.error) console.error("[progress] homeroom_session_stats error:", statsRes.error.message);
        const stuckTasks: StuckTask[] = (stuckRes.data ?? []).map(t => ({ id: t.id, text: t.text as string, created_at: t.created_at as string }));
        const sessionStats: SessionStat[] = statsRes.data ?? [];

        const stuckAgeDays = stuckTasks.map(t =>
          Math.floor((now.getTime() - new Date(t.created_at).getTime()) / msDay)
        );

        const momentum = calculateMomentum(stuckAgeDays, sessionStats, scheduledRes.data ?? []);

        // Use completed homerooms as the authoritative session source
        const completedHomes = homesRes.data ?? [];
        const sessionsThisWeek = completedHomes.filter(h =>
          new Date(h.ended_at as string).getTime() >= oneWeekAgo.getTime()
        ).length;

        const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
        const dailySessionCounts = Array.from({ length: 7 }, (_, i) => {
          const dayStart = new Date(now);
          dayStart.setDate(dayStart.getDate() - (6 - i));
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          return completedHomes.filter(h => {
            const t = new Date(h.ended_at as string).getTime();
            return t >= dayStart.getTime() && t < dayEnd.getTime();
          }).length;
        });
        const weekDayLabels = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (6 - i));
          return DAY_LABELS[d.getDay()];
        });

        const activeDateSet = new Set(
          completedHomes
            .filter(h => new Date(h.ended_at as string).getTime() >= thirtyDaysAgo.getTime())
            .map(h => new Date(h.ended_at as string).toDateString())
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

        const total = completedHomes.length;
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
          totalSessionCount: total,
        });
        if (total < MIN_SESSIONS) setShowOverlay(true);
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

  if (!data) return (
    <div className="max-w-2xl mx-auto px-4 pt-16 pb-28 flex flex-col items-center justify-center gap-3 text-center" style={{ minHeight: 300 }}>
      <p className="text-sm font-semibold text-charcoal">Couldn&apos;t load your progress</p>
      <p className="text-xs text-warm-gray">Check your connection and try again.</p>
      <button onClick={() => window.location.reload()} className="text-xs font-semibold px-4 py-2 rounded-xl text-white" style={{ background: "var(--purple)" }}>Retry</button>
    </div>
  );

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
    <>
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
        <div className="text-center mt-1">
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
        <div className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}>
          <div className="text-xs font-medium text-warm-gray mb-3">Tasks closed</div>
          <div className="text-4xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1.5px", lineHeight: 1 }}>{completedThisWeek}</div>
          <div className="text-xs text-warm-gray mt-1">this week</div>
          {taskDelta !== 0 && (
            <div className="inline-flex items-center gap-1 text-xs font-semibold mt-3 px-2 py-0.5 rounded-full"
              style={taskDelta > 0 ? { background: "var(--green-bg)", color: "var(--green-text)" } : { background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>
              {taskDelta > 0 ? "↑" : "↓"} {Math.abs(taskDelta)} vs last week
            </div>
          )}
        </div>

        {/* Stuck Tasks — tappable */}
        {(() => {
          const stuckCount = stuckTasks.filter(t => Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) >= 8).length;
          const hasStuck = stuckCount > 0;
          return (
            <button
              onClick={() => hasStuck && setShowStuckModal(true)}
              className="rounded-2xl border p-4 text-left w-full transition-opacity active:opacity-70"
              style={{
                background: hasStuck ? "var(--yellow-bg)" : "var(--surface)",
                borderColor: hasStuck ? "#FDE68A" : "var(--border-2)",
                cursor: hasStuck ? "pointer" : "default",
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-medium" style={{ color: hasStuck ? "#92400E" : "var(--text-2)" }}>Stuck tasks</div>
                {hasStuck && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
              <div className="text-4xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1.5px", lineHeight: 1 }}>{stuckCount}</div>
              {hasStuck ? (
                <div className="text-xs mt-1" style={{ color: "#92400E" }}>
                  {oldestStuckDays >= 8 ? `oldest: ${oldestStuckDays}d` : "tap to view"}
                </div>
              ) : (
                <div className="text-xs text-warm-gray mt-1">all clear</div>
              )}
            </button>
          );
        })()}

        {/* Sessions */}
        <div className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}>
          <div className="text-xs font-medium text-warm-gray mb-3">Sessions</div>
          <div className="text-4xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1.5px", lineHeight: 1 }}>{sessionsThisWeek}</div>
          <div className="text-xs text-warm-gray mt-1">this week</div>
          <div className="text-xs font-medium mt-3" style={{ color: "var(--text-3)" }}>
            {data.totalSessionCount} all time
          </div>
        </div>

        {/* Active Days */}
        <div className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}>
          <div className="text-xs font-medium text-warm-gray mb-3">Active days</div>
          <div className="text-4xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1.5px", lineHeight: 1 }}>{activeThisMonth}</div>
          <div className="text-xs text-warm-gray mt-1">last 30 days</div>
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

    {/* Stuck tasks modal */}
    {showStuckModal && (() => {
      const modalTasks = stuckTasks
        .map(t => ({ ...t, ageDays: Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) }))
        .filter(t => t.ageDays >= 8)
        .sort((a, b) => b.ageDays - a.ageDays);
      function tackleThese() {
        localStorage.setItem("homeroom-stuck-preselect", JSON.stringify(modalTasks.map(t => t.id)));
        window.location.href = "/start";
      }
      return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowStuckModal(false)} />
          <div
            className="relative w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl max-h-[80vh] flex flex-col"
            style={{ background: "var(--surface)", animation: "slideUp 0.25s ease" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>Stuck tasks</h2>
                <p className="text-xs text-warm-gray mt-0.5">{modalTasks.length} task{modalTasks.length !== 1 ? "s" : ""} needing attention</p>
              </div>
              <button
                onClick={() => setShowStuckModal(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full"
                style={{ background: "var(--border)", color: "var(--text-2)" }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-2 mb-4">
              {modalTasks.map(t => (
                <div key={t.id} className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border-2)", background: "var(--bg)" }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug" style={{ color: "var(--text)" }}>{t.text}</p>
                  </div>
                  <span
                    className="flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={t.ageDays >= 30
                      ? { background: "#FEE2E2", color: "#B91C1C" }
                      : { background: "var(--yellow-bg)", color: "#92400E" }}
                  >
                    {t.ageDays}d
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={tackleThese}
              className="w-full font-bold text-sm py-3.5 rounded-2xl text-white transition-opacity hover:opacity-90 active:opacity-75"
              style={{ background: "var(--purple)" }}
            >
              Tackle these in a Homeroom →
            </button>
          </div>
        </div>
      );
    })()}

    {/* Sessions-needed overlay */}
    {showOverlay && (
      <div
        className="fixed inset-0 z-40 flex items-end justify-center pb-8 px-4 pointer-events-none"
        style={{ background: "rgba(0,0,0,0.35)" }}
      >
        <div
          className="w-full max-w-sm rounded-3xl p-6 pointer-events-auto"
          style={{
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            animation: "slideUp 0.3s ease",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-base font-bold text-charcoal">Insights unlocking…</span>
            <button
              onClick={() => setShowOverlay(false)}
              className="w-7 h-7 flex items-center justify-center rounded-full transition-colors"
              style={{ background: "var(--border)", color: "var(--text-2)" }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="flex gap-2 mb-4">
            {Array.from({ length: MIN_SESSIONS }).map((_, i) => (
              <div
                key={i}
                className="flex-1 h-2 rounded-full transition-colors"
                style={{ background: i < data.totalSessionCount ? "var(--purple)" : "var(--border-2)" }}
              />
            ))}
          </div>

          <p className="text-sm text-warm-gray leading-relaxed mb-4">
            {MIN_SESSIONS - data.totalSessionCount === MIN_SESSIONS
              ? `Complete ${MIN_SESSIONS} sessions to unlock your momentum score and personalized insights.`
              : `${MIN_SESSIONS - data.totalSessionCount} more session${MIN_SESSIONS - data.totalSessionCount !== 1 ? "s" : ""} until your momentum score and full insights unlock.`}
          </p>

          <Link
            href="/start"
            className="block w-full text-center text-sm font-semibold py-3 rounded-xl text-white transition-opacity hover:opacity-85"
            style={{ background: "var(--purple)" }}
            onClick={() => setShowOverlay(false)}
          >
            Start a Homeroom
          </Link>
        </div>
      </div>
    )}
    <style>{`@keyframes slideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </>
  );
}
