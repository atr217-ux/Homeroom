import type { SupabaseClient } from "@supabase/supabase-js";

export const TAG_COLORS = [
  "#7C3AED", "#0891B2", "#059669", "#D97706",
  "#DC2626", "#DB2777", "#65A30D", "#0284C7",
] as const;

// If `override` is a hex string (`#rrggbb`), use it; else derive a stable
// color from the tag name via TAG_COLORS. Bg is a 13%-alpha tint of the
// same hue (fg + "22" hex).
export function tagColor(name: string, override?: string | null): { bg: string; fg: string } {
  if (override && /^#[0-9a-fA-F]{6}$/.test(override)) {
    return { bg: override + "22", fg: override };
  }
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const c = TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
  return { bg: c + "22", fg: c };
}

// "Buy milk #grocery #urgent" → ["grocery", "urgent"]
export function parseHashtags(raw: string): string[] {
  const matches = raw.match(/#(\w+)/g) ?? [];
  const names = matches.map(t => t.slice(1).toLowerCase());
  return Array.from(new Set(names));
}

// "Buy milk #grocery #urgent" → "Buy milk"
export function stripHashtags(raw: string): string {
  return raw.replace(/#\w+/g, "").replace(/\s+/g, " ").trim();
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Wraps every #hashtag in a purple span. For use as contenteditable innerHTML.
export function buildColoredHTML(text: string): string {
  return text.split(/(#\w+)/g).map(part =>
    /^#\w+/.test(part)
      ? `<span style="color:var(--purple);font-weight:500">${escapeHTML(part)}</span>`
      : escapeHTML(part)
  ).join("");
}

// Returns existing tag for (userId, name) or creates one. Case-insensitive on name.
export async function getOrCreateTag(
  name: string,
  supabase: SupabaseClient,
  userId: string,
): Promise<{ id: string; name: string; color?: string | null } | null> {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return null;

  const { data: existing } = await supabase
    .from("tags")
    .select("id, name, color")
    .eq("user_id", userId)
    .ilike("name", normalized)
    .maybeSingle();
  if (existing) return existing as { id: string; name: string; color: string | null };

  const { data: created } = await supabase
    .from("tags")
    .insert({ user_id: userId, name: normalized })
    .select("id, name, color")
    .single();
  return (created as { id: string; name: string; color: string | null } | null) ?? null;
}
