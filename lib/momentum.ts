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

// Age of stories: per-task tiered penalty; bonus if all tasks are fresh
function taskAgeBurden(ageDays: number[]): number {
  if (ageDays.length === 0) return 0;
  if (ageDays.every(d => d <= 7)) return 10;
  let total = 0;
  for (const age of ageDays) {
    if (age > 21)      total -= 5;
    else if (age > 14) total -= 3;
    else if (age > 7)  total -= 2;
  }
  return Math.max(total, -30);
}

// Attendance: ≥2 sessions = +10, <2 = -10
function attendanceScore(count: number): number {
  return count >= 2 ? 10 : -10;
}

// % of sessions where ALL committed tasks were completed
function allCompletionScore(sessions: { committed: number; completed: number }[]): number {
  if (sessions.length === 0) return 0;
  const allDone = sessions.filter(s => s.committed > 0 && s.completed >= s.committed).length;
  return allDone / sessions.length >= 0.5 ? 15 : -15;
}

// Rollover: did user carry unfinished tasks into new homerooms >50% of the time?
function rolloverScore(sessions: { rolled: number; discarded: number }[]): number {
  const relevant = sessions.filter(s => s.rolled + s.discarded > 0);
  if (relevant.length === 0) return 0;
  const rolledCount = relevant.filter(s => s.rolled > 0).length;
  return rolledCount / relevant.length > 0.5 ? 15 : -5;
}

// Scheduling: +2 per scheduled homeroom created this week; -5 if none
function schedulingScore(scheduledThisWeek: number): number {
  return scheduledThisWeek === 0 ? -5 : scheduledThisWeek * 2;
}

function sigmoid(raw: number): number {
  return 200 / (1 + Math.exp(-0.03 * raw)) - 100;
}

export function getMomentumZone(displayed: number): string {
  if (displayed >= 60)  return "Surging";
  if (displayed >= 20)  return "Building";
  if (displayed >= -19) return "Steady";
  if (displayed >= -59) return "Slowing";
  return "Stuck";
}

export function calculateMomentum(
  stuckTaskAgeDays: number[],
  allSessions: SessionStat[],
  scheduledHomerooms: { created_at: string }[] = []
): MomentumResult {
  const now = new Date();
  const thisWeekStart = getWeekStart(now).getTime();
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

  function weekRawScore(weeksAgo: number): number | null {
    const weekEnd   = weeksAgo === 0 ? now.getTime()        : thisWeekStart - (weeksAgo - 1) * MS_PER_WEEK;
    const weekStart = weeksAgo === 0 ? thisWeekStart        : thisWeekStart - weeksAgo * MS_PER_WEEK;

    const sessions = allSessions.filter(s => {
      const t = new Date(s.ended_at).getTime();
      return t >= weekStart && t < weekEnd;
    });
    if (sessions.length === 0 && weeksAgo !== 0) return null;

    const scheduledCount = scheduledHomerooms.filter(h => {
      const t = new Date(h.created_at).getTime();
      return t >= weekStart && t < weekEnd;
    }).length;

    return (
      (weeksAgo === 0 ? taskAgeBurden(stuckTaskAgeDays) : 0) +
      attendanceScore(sessions.length) +
      allCompletionScore(sessions.map(s => ({ committed: s.tasks_committed, completed: s.tasks_completed }))) +
      rolloverScore(sessions.map(s => ({ rolled: s.tasks_rolled_over, discarded: s.tasks_discarded }))) +
      schedulingScore(scheduledCount)
    );
  }

  const currentScores = ([0, 1, 2, 3] as const)
    .map(w => weekRawScore(w))
    .filter((s): s is number => s !== null);

  if (currentScores.length === 0) {
    return { displayedScore: 0, zone: "Steady", hasData: false, rawMomentum: 0, trendDelta: 0 };
  }

  const rawMomentum = currentScores.reduce((a, b) => a + b, 0) / currentScores.length;
  const displayedScore = Math.round(sigmoid(rawMomentum));
  const zone = getMomentumZone(displayedScore);

  const prevScores = ([1, 2, 3, 4] as const)
    .map(w => weekRawScore(w))
    .filter((s): s is number => s !== null);
  const prevRaw = prevScores.length > 0
    ? prevScores.reduce((a, b) => a + b, 0) / prevScores.length
    : rawMomentum;
  const trendDelta = displayedScore - Math.round(sigmoid(prevRaw));

  return { displayedScore, zone, hasData: true, rawMomentum, trendDelta };
}
