"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// ─── Seeded prototype data ─────────────────────────────────────────────────────

const MOMENTUM_SCORE = 34;
const MOMENTUM_TREND = 12;
const MOMENTUM_ZONE = "Building";

// Sa Su Mo Tu We Th Fr — today = index 6 (Fri)
const WEEK_LABELS  = ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"];
const WEEK_SESSIONS = [1, 0, 2, 1, 3, 0, 2];
const TODAY_IDX = 6;

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
        <linearGradient
          id="gaugeGrad"
          x1={CX - RADIUS} y1="0"
          x2={CX + RADIUS} y2="0"
          gradientUnits="userSpaceOnUse"
        >
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

      {/* Track */}
      <path d={arc} fill="none" stroke="#EBEBE6" strokeWidth={STROKE} strokeLinecap="round" />
      {/* Gradient fill */}
      <path d={arc} fill="none" stroke="url(#gaugeGrad)" strokeWidth={STROKE} strokeLinecap="round" />

      {/* Zone labels */}
      {ZONES.map((z) => {
        const p = zonePos(z.deg, LABEL_R);
        const dy = z.deg === 0 || z.deg === 180 ? -9 : 0;
        return (
          <text
            key={z.label}
            x={p.x}
            y={p.y + dy}
            textAnchor="middle"
            fontSize="7"
            fontWeight="700"
            letterSpacing="0.7"
            fill="#C0BDB5"
          >
            {z.label}
          </text>
        );
      })}

      {/* Needle */}
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transition: "transform 1.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
        filter="url(#nShadow)"
      >
        <line
          x1={CX} y1={CY + 6}
          x2={CX} y2={CY - NEEDLE}
          stroke="#111827"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>

      {/* Hub */}
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ProgressPage() {
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSessionCount(0); return; }
      const { data: rows } = await supabase
        .from("homeroom_participants")
        .select("homeroom_id")
        .eq("user_id", user.id);
      const ids = (rows ?? []).map((r) => r.homeroom_id as string);
      if (!ids.length) { setSessionCount(0); return; }
      const { count } = await supabase
        .from("homerooms")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .in("id", ids);
      setSessionCount(count ?? 0);
    })();
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (sessionCount === null) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-10 pb-28 flex items-center justify-center" style={{ minHeight: 300 }}>
        <div
          className="w-6 h-6 rounded-full border-2 animate-spin"
          style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (sessionCount < 3) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-28 space-y-4">
        <div>
          <h1 className="text-3xl font-bold text-charcoal" style={{ letterSpacing: "-0.5px" }}>Progress</h1>
          <p className="text-sm text-warm-gray mt-1">Your focus history at a glance.</p>
        </div>

        <div
          className="bg-white rounded-3xl border p-5"
          style={{ borderColor: "var(--border-2)", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}
        >
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

        <div
          className="rounded-2xl border p-5 text-center"
          style={{ background: "#F0FDF8", borderColor: "#BBF7D0" }}
        >
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

  // ── Full page ──────────────────────────────────────────────────────────────
  const trendUp = MOMENTUM_TREND > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-28 space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-charcoal" style={{ letterSpacing: "-0.5px" }}>Progress</h1>
        <p className="text-sm text-warm-gray mt-1">Your focus history at a glance.</p>
      </div>

      {/* ── Momentum card ─────────────────────────────────────────────────── */}
      <div
        className="bg-white rounded-3xl border"
        style={{ borderColor: "var(--border-2)", boxShadow: "0 2px 14px rgba(0,0,0,0.07)", padding: "20px 20px 24px" }}
      >
        <Speedometer score={MOMENTUM_SCORE} />
        <div className="text-center mt-2">
          <div
            className="font-bold"
            style={{ fontSize: 52, letterSpacing: "-3px", lineHeight: 1, color: "var(--text)" }}
          >
            {MOMENTUM_SCORE > 0 ? "+" : ""}{MOMENTUM_SCORE}
          </div>
          <div className="text-sm font-semibold mt-1.5" style={{ color: "var(--text-2)" }}>
            {MOMENTUM_ZONE}
          </div>
          <div
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full mt-3"
            style={
              trendUp
                ? { background: "#CCFBF1", color: "#0F766E" }
                : { background: "#FEF3C7", color: "#B45309" }
            }
          >
            {trendUp ? "↑" : "↓"} {Math.abs(MOMENTUM_TREND)} this week
          </div>
        </div>
      </div>

      {/* ── Metric grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">

        {/* Tasks Closed */}
        <div
          className="bg-white rounded-2xl border p-4"
          style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        >
          <div className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Tasks Closed</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1px" }}>12</div>
          <div className="text-xs text-warm-gray mt-0.5">this week</div>
          <div className="text-xs font-semibold mt-2.5" style={{ color: "#0D9488" }}>↑ 3 from last week</div>
        </div>

        {/* Stuck Tasks */}
        <div
          className="rounded-2xl border p-4"
          style={{ background: "#FFFBEB", borderColor: "#FDE68A", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--yellow-text)" }}>
            Stuck Tasks
          </div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1px" }}>5</div>
          <div className="text-xs font-medium mt-0.5" style={{ color: "#D97706" }}>Oldest: 23 days</div>
          <button
            onClick={() => { window.location.href = "/start"; }}
            className="mt-2.5 text-xs font-semibold w-full py-1.5 rounded-lg text-white transition-all active:scale-95 hover:opacity-90"
            style={{ background: "#F59E0B" }}
          >
            Tackle these →
          </button>
        </div>

        {/* Sessions */}
        <div
          className="bg-white rounded-2xl border p-4"
          style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        >
          <div className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Sessions</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1px" }}>3</div>
          <div className="text-xs text-warm-gray mt-0.5">this week</div>
          <div className="text-xs font-medium mt-2.5" style={{ color: "var(--text-2)" }}>2h 15m focused</div>
        </div>

        {/* Active Days */}
        <div
          className="bg-white rounded-2xl border p-4"
          style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        >
          <div className="text-xs font-semibold text-warm-gray uppercase tracking-wide mb-2">Active Days</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)", letterSpacing: "-1px" }}>5</div>
          <div className="text-xs text-warm-gray mt-0.5">this month</div>
          <div className="text-xs font-medium mt-2.5" style={{ color: "var(--text-2)" }}>Last month: 18 days</div>
        </div>
      </div>

      {/* ── Weekly activity ───────────────────────────────────────────────── */}
      <div
        className="bg-white rounded-2xl border p-4"
        style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      >
        <div className="flex items-baseline justify-between mb-5">
          <p className="text-sm font-bold text-charcoal">This week</p>
          <p className="text-xs text-warm-gray">circle size = activity</p>
        </div>
        <div className="flex justify-between items-end">
          {WEEK_LABELS.map((label, i) => {
            const n = WEEK_SESSIONS[i];
            const isToday = i === TODAY_IDX;
            const { size, fill, border } = circleStyle(n);
            const MAX = 36;
            return (
              <div key={i} className="flex flex-col items-center gap-2">
                <div
                  className="flex items-end justify-center"
                  style={{ height: MAX + 10, width: MAX + 4 }}
                >
                  <div
                    style={{
                      width:  size,
                      height: size,
                      borderRadius: "50%",
                      background: fill,
                      border: border ? "1.5px solid var(--border-3)" : "none",
                      boxShadow: isToday
                        ? "0 0 0 3px rgba(124,58,237,0.15), 0 0 0 6px rgba(124,58,237,0.07)"
                        : "none",
                      flexShrink: 0,
                    }}
                  />
                </div>
                <span
                  className="text-xs font-semibold"
                  style={{ color: isToday ? "var(--purple)" : "var(--text-3)" }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Insights card ─────────────────────────────────────────────────── */}
      <div
        className="bg-white rounded-2xl border p-4"
        style={{ borderColor: "var(--border-2)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <p className="text-sm font-bold text-charcoal">Insights for you</p>
          <p className="text-xs text-warm-gray">refreshed daily</p>
        </div>

        <div className="space-y-4">
          {/* Tip 1 */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--purple-bg)", fontSize: 16 }}>⚡</div>
            <div>
              <p className="text-sm leading-snug" style={{ color: "var(--text)" }}>
                You&apos;re in your <strong>highest Momentum range in 3 weeks</strong>. Lock it in by joining a session today.
              </p>
              <Link href="/home" className="text-xs font-semibold mt-1 inline-block hover:opacity-70 transition-opacity" style={{ color: "var(--purple)" }}>
                Find a Homeroom →
              </Link>
            </div>
          </div>

          {/* Tip 2 */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#CCFBF1", fontSize: 16 }}>🌅</div>
            <div>
              <p className="text-sm leading-snug" style={{ color: "var(--text)" }}>
                You complete admin tasks <strong>30% faster in morning sessions</strong>. Try a Sunday Reset tomorrow morning.
              </p>
              <Link href="/start" className="text-xs font-semibold mt-1 inline-block hover:opacity-70 transition-opacity" style={{ color: "#0D9488" }}>
                Schedule it →
              </Link>
            </div>
          </div>

          {/* Tip 3 */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#E0F2FE", fontSize: 16 }}>📥</div>
            <div>
              <p className="text-sm leading-snug" style={{ color: "var(--text)" }}>
                Tasks you bring from My List get completed <strong>2× more often</strong>. Browse your list before your next Homeroom.
              </p>
              <Link href="/list" className="text-xs font-semibold mt-1 inline-block hover:opacity-70 transition-opacity" style={{ color: "#0369A1" }}>
                Open My List →
              </Link>
            </div>
          </div>

          {/* Tip 4 */}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#FEF3C7", fontSize: 16 }}>👋</div>
            <div>
              <p className="text-sm leading-snug" style={{ color: "var(--text)" }}>
                <strong>Sarah and Dan</strong> both have positive Momentum this week. Want to schedule a session together?
              </p>
              <Link href="/home" className="text-xs font-semibold mt-1 inline-block hover:opacity-70 transition-opacity" style={{ color: "#B45309" }}>
                Send invite →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Wins ───────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl border p-4"
        style={{
          background: "linear-gradient(140deg, #F0FDF8 0%, #ECFDF5 100%)",
          borderColor: "var(--green-border)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <p className="text-sm font-bold" style={{ color: "#14532D" }}>Recent wins</p>
          <p className="text-xs" style={{ color: "#4B7A5A" }}>last 7 days</p>
        </div>

        <div className="space-y-3.5">
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0 mt-0.5">🎉</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#14532D" }}>
                Finished &ldquo;Schedule dentist&rdquo;
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#4B7A5A" }}>After waiting 23 days</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0 mt-0.5">⚡</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#14532D" }}>
                New record on &ldquo;Empty dishwasher&rdquo;
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#4B7A5A" }}>3 min — beat your average of 4 min</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-xl flex-shrink-0 mt-0.5">🔥</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#14532D" }}>
                Cleared 5 stuck tasks in one session
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#4B7A5A" }}>Wednesday&apos;s Sunday Reset Homeroom</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
