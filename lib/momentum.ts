export interface SessionStat {
  tasks_committed: number;
  tasks_completed: number;
  tasks_rolled_over: number;
  tasks_discarded: number;
  breakthrough_14_29: number;
  breakthrough_30_plus: number;
  ended_at: string;
}

export interface MomentumResult {
  displayedScore: number;
  zone: string;
  hasData: boolean;
  rawMomentum: number;
  trendDelta: number;
}

function getWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysToMonday);
  return d;
}

function taskAgeBurden(ageDays: number[]): number {
  let total = 0;
  for (const age of ageDays) {
    if (age >= 31) total -= 3;
    else if (age >= 15) total -= 2;
    else if (age >= 8) total -= 1;
  }
  return Math.max(total, -15);
}

function attendanceScore(count: number): number {
  if (count === 0) return -10;
  if (count === 1) return -5;
  if (count === 2) return 5;
  if (count === 3) return 10;
  return 15;
}

function completionRateScore(sessions: { committed: number; completed: number }[]): number {
  if (sessions.length === 0) return 0;
  const rates = sessions.map(s => (s.committed > 0 ? s.completed / s.committed : 1));
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  return (avg - 0.5) * 30;
}

function rolloverScore(sessions: { rolled: number; discarded: number }[]): number {
  const relevant = sessions.filter(s => s.rolled + s.discarded > 0);
  if (relevant.length === 0) return 0;
  const rates = relevant.map(s => s.rolled / (s.rolled + s.discarded));
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  return (avg - 0.5) * 10;
}

function breakthroughScore(total14_29: number, total30plus: number): number {
  return Math.min(total14_29 * 5 + total30plus * 10, 20);
}

function socialScore(totalInSession: number): number {
  return Math.min(totalInSession, 10);
}

function weekRawScore(stuckAgeDays: number[], sessions: SessionStat[]): number {
  return (
    taskAgeBurden(stuckAgeDays) +
    attendanceScore(sessions.length) +
    completionRateScore(sessions.map(s => ({ committed: s.tasks_committed, completed: s.tasks_completed }))) +
    rolloverScore(sessions.map(s => ({ rolled: s.tasks_rolled_over, discarded: s.tasks_discarded }))) +
    // Category 5 (future scheduling) omitted — feature doesn't exist yet
    breakthroughScore(
      sessions.reduce((a, s) => a + s.breakthrough_14_29, 0),
      sessions.reduce((a, s) => a + s.breakthrough_30_plus, 0)
    ) +
    socialScore(sessions.reduce((a, s) => a + s.tasks_completed, 0))
  );
}

function sigmoid(raw: number): number {
  return 200 / (1 + Math.exp(-0.03 * raw)) - 100;
}

export function getMomentumZone(displayed: number): string {
  if (displayed >= 60) return "Surging";
  if (displayed >= 20) return "Building";
  if (displayed >= -19) return "Steady";
  if (displayed >= -59) return "Slowing";
  return "Stuck";
}

export function calculateMomentum(
  stuckTaskAgeDays: number[],
  allSessions: SessionStat[]
): MomentumResult {
  const now = new Date();
  const thisWeekStart = getWeekStart(now).getTime();
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

  function scoreForWeek(weeksAgo: number): number | null {
    const weekEnd = weeksAgo === 0 ? now.getTime() : thisWeekStart - (weeksAgo - 1) * MS_PER_WEEK;
    const weekStart = weeksAgo === 0 ? thisWeekStart : thisWeekStart - weeksAgo * MS_PER_WEEK;
    const sessions = allSessions.filter(s => {
      const t = new Date(s.ended_at).getTime();
      return t >= weekStart && t < weekEnd;
    });
    if (sessions.length === 0 && weeksAgo !== 0) return null;
    return weekRawScore(weeksAgo === 0 ? stuckTaskAgeDays : [], sessions);
  }

  const currentScores = ([0, 1, 2, 3] as const)
    .map(w => scoreForWeek(w))
    .filter((s): s is number => s !== null);

  if (currentScores.length === 0) {
    return { displayedScore: 0, zone: "Steady", hasData: false, rawMomentum: 0, trendDelta: 0 };
  }

  const rawMomentum = currentScores.reduce((a, b) => a + b, 0) / currentScores.length;
  const displayedScore = Math.round(sigmoid(rawMomentum));
  const zone = getMomentumZone(displayedScore);

  // Trend: score using weeks 1–4 (shift the window back one week)
  const prevScores = ([1, 2, 3, 4] as const)
    .map(w => scoreForWeek(w))
    .filter((s): s is number => s !== null);
  const prevRaw = prevScores.length > 0
    ? prevScores.reduce((a, b) => a + b, 0) / prevScores.length
    : rawMomentum;
  const trendDelta = displayedScore - Math.round(sigmoid(prevRaw));

  return { displayedScore, zone, hasData: true, rawMomentum, trendDelta };
}
