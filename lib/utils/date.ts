export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso).getTime();
  return Math.floor((now.getTime() - then) / 86_400_000);
}

// "Today" / "Yesterday" / "This week" / "Last week" / "N weeks ago"
export function addedAtLabel(iso: string, now: Date = new Date()): string {
  const added = new Date(iso);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addedStart = new Date(added.getFullYear(), added.getMonth(), added.getDate());
  const diffDays = Math.round((todayStart.getTime() - addedStart.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  const weekStart = (d: Date) => {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    s.setDate(s.getDate() - s.getDay()); // Sunday
    return s;
  };
  const currentWeek = weekStart(now);
  const addedWeek = weekStart(added);
  if (addedWeek.getTime() === currentWeek.getTime()) return "This week";

  const prevWeek = new Date(currentWeek);
  prevWeek.setDate(prevWeek.getDate() - 7);
  if (addedWeek.getTime() === prevWeek.getTime()) return "Last week";

  const weeksDiff = Math.round((currentWeek.getTime() - addedWeek.getTime()) / (7 * 86_400_000));
  return `${weeksDiff} weeks ago`;
}

// Accepts "HH:MM" or "HH:MM:SS" strings and tests whether `now` falls in [start, end].
export function isWithinTimeRange(startTime: string, endTime: string, now: Date = new Date()): boolean {
  const minutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= minutes(startTime) && cur < minutes(endTime);
}
