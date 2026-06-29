import type { SupabaseClient } from "@supabase/supabase-js";

export const TAG_COLORS = [
  "#7C3AED", "#0891B2", "#059669", "#D97706",
  "#DC2626", "#DB2777", "#65A30D", "#0284C7",
] as const;

export function tagColor(name: string): { bg: string; fg: string } {
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
): Promise<{ id: string; name: string } | null> {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return null;

  const { data: existing } = await supabase
    .from("tags")
    .select("id, name")
    .eq("user_id", userId)
    .ilike("name", normalized)
    .maybeSingle();
  if (existing) return existing as { id: string; name: string };

  const { data: created } = await supabase
    .from("tags")
    .insert({ user_id: userId, name: normalized })
    .select("id, name")
    .single();
  return (created as { id: string; name: string } | null) ?? null;
}
