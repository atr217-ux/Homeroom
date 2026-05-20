export interface SessionStat {
  tasks_committed: number;
  tasks_completed: number;
  tasks_rolled_over: number;
  tasks_discarded: number;
  breakthrough_14_29: number;   // retained for DB compat, unused in v2
  breakthrough_30_plus: number; // retained for DB compat, unused in v2
  ended_at: string;
}

export interface TaskCounts {
  closedThisWeek: number;
  closedLastWeek: number;
  openInboxCount: number; // open tasks with no homeroom assignment right now
}

export interface MomentumResult {
  displayedScore: number;
  zone: string;
  hasData: boolean;
  rawMomentum: number;
  trendDelta: number;
}

// ─── Week boundaries ─────────────────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  return d;
}

// ─── Signal 1A: Task Closure Rate ────────────────────────────────────────────
// closable ≈ tasks closed this week + tasks still open in inbox
// linear map: 0%→-15, 50%→0, 100%→+15

function taskClosurePoints(closed: number, openInbox: number): number {
  const closable = closed + openInbox;
  if (closable === 0) return 0;
  const rate = closed / closable;
  return (rate - 0.5) * 30; // clamps naturally to [-15, +15]
}

// ─── Signal 1B: Session Follow-Through ───────────────────────────────────────
// Asymmetric: harsh on the negative end, modest ceiling on positive.
// Rolled-over tasks are treated as "in motion" (benefit of the doubt).

function followThroughPointsForRate(rate: number): number {
  if (rate <= 0.25) return -20 + (rate / 0.25) * 10;           // -20 → -10
  if (rate <= 0.50) return -10 + ((rate - 0.25) / 0.25) * 10;  // -10 → 0
  if (rate <= 0.75) return (rate - 0.50) / 0.25 * 5;           //   0 → +5
  return 5 + ((rate - 0.75) / 0.25) * 3;                        //  +5 → +8
}

function sessionFollowThroughPoints(sessions: SessionStat[]): number {
  const committed = sessions.filter(s => s.tasks_committed > 0);
  if (committed.length === 0) return 0;
  const avgRate =
    committed.reduce((sum, s) => {
      const effective = Math.min(s.tasks_completed + s.tasks_rolled_over, s.tasks_committed);
      return sum + effective / s.tasks_committed;
    }, 0) / committed.length;
  return followThroughPointsForRate(avgRate);
}

// ─── Signal 2: Aging Pressure ────────────────────────────────────────────────
// Only computed from current inbox state. Tasks scheduled to a homeroom are
// already excluded upstream (homeroom_id IS NULL query).

function agingPressure(ageDays: number[]): number {
  let total = 0;
  for (const age of ageDays) {
    if (age >= 31)      total -= 4;
    else if (age >= 15) total -= 2;
    else if (age >= 8)  total -= 1;
  }
  return Math.max(total, -20);
}

// ─── Signal 3A: Attendance Band ──────────────────────────────────────────────

function attendanceBand(count: number): number {
  if (count === 0) return -10;
  if (count === 1) return 0;
  if (count === 2) return 5;
  if (count === 3) return 8;
  return 10; // 4+
}

// ─── Signal 3B: Consistency (stdev of last 4 complete weeks) ─────────────────

function consistencyPoints(weeklyCounts: number[]): number {
  if (weeklyCounts.length < 3) return 0;
  const mean = weeklyCounts.reduce((a, b) => a + b, 0) / weeklyCounts.length;
  const stdev = Math.sqrt(
    weeklyCounts.reduce((acc, n) => acc + (n - mean) ** 2, 0) / weeklyCounts.length
  );
  if (stdev > 2) return -3;
  if (stdev >= 1) return 0;
  return 3;
}

// ─── Signal 3C: Weekly Streak ────────────────────────────────────────────────

function streakPoints(consecutiveWeeks: number): number {
  if (consecutiveWeeks >= 8) return 6;
  if (consecutiveWeeks >= 5) return 4;
  if (consecutiveWeeks >= 3) return 2;
  return 0;
}

// ─── Sigmoid display scaling (k=0.04 for the narrower ±50 raw range) ─────────

function sigmoid(raw: number): number {
  return 200 / (1 + Math.exp(-0.04 * raw)) - 100;
}

// ─── Zone labels ─────────────────────────────────────────────────────────────

export function getMomentumZone(displayed: number): string {
  if (displayed >= 60)  return "Surging";
  if (displayed >= 20)  return "Building";
  if (displayed >= -19) return "Steady";
  if (displayed >= -59) return "Slowing";
  return "Stuck";
}

// ─── Main calculation ────────────────────────────────────────────────────────

export function calculateMomentum(
  stuckTaskAgeDays: number[],
  allSessions: SessionStat[],
  _scheduledHomerooms: { created_at: string }[] = [], // kept for call-site compat
  taskCounts?: TaskCounts
): MomentumResult {
  const now = new Date();
  const thisWeekStart = getWeekStart(now).getTime();
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

  function sessionsInWeek(weeksAgo: number): SessionStat[] {
    const end   = weeksAgo === 0 ? now.getTime()       : thisWeekStart - (weeksAgo - 1) * MS_PER_WEEK;
    const start = weeksAgo === 0 ? thisWeekStart       : thisWeekStart - weeksAgo * MS_PER_WEEK;
    return allSessions.filter(s => {
      const t = new Date(s.ended_at).getTime();
      return t >= start && t < end;
    });
  }

  // Consecutive weeks (going back from last completed week) with ≥1 session,
  // plus current week if it already has a session.
  function calcStreak(): number {
    let streak = sessionsInWeek(0).length > 0 ? 1 : 0;
    for (let w = 1; w <= 12; w++) {
      if (sessionsInWeek(w).length > 0) streak++;
      else break;
    }
    return streak;
  }

  // Session counts for the 4 most-recently-completed weeks (weeks 1–4).
  const pastWeeklyCounts = [1, 2, 3, 4].map(w => sessionsInWeek(w).length);

  // ── Per-week raw score ────────────────────────────────────────────────────
  // Week 0 (current): all three signals.
  // Week 1 (last week): closure rate + attendance only (no historical aging).
  // Week 2+ used only for trend comparison.

  function weekRawScore(weeksAgo: number): number | null {
    const sessions = sessionsInWeek(weeksAgo);

    // Past weeks with no sessions and no known task activity → skip
    if (weeksAgo >= 1 && sessions.length === 0) {
      if (weeksAgo === 1 && taskCounts && taskCounts.closedLastWeek > 0) {
        // last week had task closes even without sessions — include it
      } else {
        return null;
      }
    }

    // Signal 1: Closure Rate
    let cr1a = 0;
    if (weeksAgo === 0 && taskCounts) {
      cr1a = taskClosurePoints(taskCounts.closedThisWeek, taskCounts.openInboxCount);
    } else if (weeksAgo === 1 && taskCounts) {
      // For last week, use openInboxCount as proxy for still-open tasks
      cr1a = taskClosurePoints(taskCounts.closedLastWeek, taskCounts.openInboxCount);
    }
    const cr1b = sessionFollowThroughPoints(sessions);
    const closureRate = cr1a * 0.6 + cr1b * 0.4;

    // Signal 2: Aging Pressure — only current-state data available
    const aging = weeksAgo === 0 ? agingPressure(stuckTaskAgeDays) : 0;

    // Signal 3: Rhythm
    const attendance = attendanceBand(sessions.length);
    // Consistency and streak are current-state; only add to week 0 to avoid double-counting
    const consistency = weeksAgo === 0 ? consistencyPoints(pastWeeklyCounts) : 0;
    const streak      = weeksAgo === 0 ? streakPoints(calcStreak()) : 0;
    const rhythm = attendance + consistency + streak;

    return closureRate + aging + rhythm;
  }

  // ── 2-week rolling average ────────────────────────────────────────────────

  const hasData =
    allSessions.length > 0 ||
    (taskCounts != null && (taskCounts.closedThisWeek > 0 || taskCounts.openInboxCount > 0));

  if (!hasData) {
    return { displayedScore: 0, zone: "Steady", hasData: false, rawMomentum: 0, trendDelta: 0 };
  }

  const currentWindow = [weekRawScore(0), weekRawScore(1)].filter((s): s is number => s !== null);
  if (currentWindow.length === 0) {
    return { displayedScore: 0, zone: "Steady", hasData: false, rawMomentum: 0, trendDelta: 0 };
  }

  const rawMomentum    = currentWindow.reduce((a, b) => a + b, 0) / currentWindow.length;
  const displayedScore = Math.round(sigmoid(rawMomentum));
  const zone           = getMomentumZone(displayedScore);

  // Trend: compare current window (0,1) to previous window (1,2)
  const prevWindow = [weekRawScore(1), weekRawScore(2)].filter((s): s is number => s !== null);
  const prevRaw    = prevWindow.length > 0
    ? prevWindow.reduce((a, b) => a + b, 0) / prevWindow.length
    : rawMomentum;
  const trendDelta = displayedScore - Math.round(sigmoid(prevRaw));

  return { displayedScore, zone, hasData: true, rawMomentum, trendDelta };
}
