"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import CreateSquadModal from "@/components/profile/CreateSquadModal";

type Squad = {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  is_public: boolean;
  member_count: number;
  role?: "owner" | "member";
};

type Props = {
  username: string;
};

export default function SquadsPanel({ username }: Props) {
  const [mine, setMine] = useState<Squad[]>([]);
  const [publicSquads, setPublicSquads] = useState<Squad[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);

  useEffect(() => {
    if (!username) return;
    load();
    const supabase = createClient();
    const channel = supabase
      .channel(`squads-panel-${username}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "squad_members" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "squads" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  async function load() {
    const supabase = createClient();

    // Squads I'm a member of
    const { data: myMemberships } = await supabase
      .from("squad_members")
      .select("squad_id, role")
      .eq("username", username);

    const mySquadIds = (myMemberships ?? []).map((m) => m.squad_id) as string[];
    let mySquadRows: Squad[] = [];
    if (mySquadIds.length > 0) {
      const { data } = await supabase
        .from("squads")
        .select("id, name, emoji, description, is_public, member_count")
        .in("id", mySquadIds);
      const roleById = Object.fromEntries((myMemberships ?? []).map((m) => [m.squad_id as string, m.role as "owner" | "member"]));
      mySquadRows = ((data as Squad[] | null) ?? []).map((s) => ({ ...s, role: roleById[s.id] }));
    }
    setMine(mySquadRows);

    // Discover public squads I'm not in
    const { data: publicData } = await supabase
      .from("squads")
      .select("id, name, emoji, description, is_public, member_count")
      .eq("is_public", true)
      .order("member_count", { ascending: false })
      .limit(50);
    const publicFiltered = ((publicData as Squad[] | null) ?? []).filter((s) => !mySquadIds.includes(s.id));
    setPublicSquads(publicFiltered);
  }

  async function joinSquad(s: Squad) {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("squad_members").insert({
      squad_id: s.id,
      username,
      role: "member",
    });
    await supabase
      .from("squads")
      .update({ member_count: (s.member_count ?? 0) + 1 })
      .eq("id", s.id);
    setBusy(false);
    load();
  }

  async function leaveSquad(s: Squad) {
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("squad_members")
      .delete()
      .eq("squad_id", s.id)
      .eq("username", username);

    // If nobody left, remove the squad; otherwise decrement
    const { count } = await supabase
      .from("squad_members")
      .select("*", { count: "exact", head: true })
      .eq("squad_id", s.id);
    if ((count ?? 0) === 0) {
      await supabase.from("squads").delete().eq("id", s.id);
    } else {
      await supabase.from("squads").update({ member_count: count ?? 0 }).eq("id", s.id);
    }
    setBusy(false);
    load();
  }

  const filteredPublic = search.trim()
    ? publicSquads.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description ?? "").toLowerCase().includes(search.toLowerCase()))
    : publicSquads;

  return (
    <section
      className="rounded-2xl border p-4 mb-4"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>
          Squads
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs font-semibold px-3 py-1.5 rounded-full text-white"
          style={{ background: "var(--purple)" }}
        >
          + New
        </button>
      </div>

      {/* My squads */}
      {mine.length > 0 ? (
        <div className="space-y-1.5 mb-4">
          {mine.map((s) => (
            <div key={s.id} className="group flex items-center gap-2 py-1.5">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: "var(--surface-2)" }}>
                {s.emoji || "🏆"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{s.name}</div>
                <div className="text-xs" style={{ color: "var(--text-2)" }}>
                  {s.member_count} member{s.member_count === 1 ? "" : "s"}
                  {s.is_public ? "" : " · Private"}
                  {s.role === "owner" ? " · Owner" : ""}
                </div>
              </div>
              <button
                onClick={() => leaveSquad(s)}
                disabled={busy}
                className="text-xs font-medium px-2.5 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "var(--red)" }}
                title="Leave squad"
              >
                Leave
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-center py-3" style={{ color: "var(--text-2)" }}>
          You&apos;re not in any squads yet.
        </p>
      )}

      {/* Browse public toggle */}
      <button
        onClick={() => setShowBrowse((v) => !v)}
        className="w-full text-sm font-medium py-2 rounded-xl border flex items-center justify-center gap-1.5 transition-colors"
        style={showBrowse
          ? { borderColor: "var(--purple)", color: "var(--purple)", background: "rgba(124,58,237,0.06)" }
          : { borderColor: "var(--border-3)", color: "var(--text-2)", background: "transparent" }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        {showBrowse ? "Hide public squads" : "Discover public squads"}
      </button>

      {showBrowse && (
        <div className="mt-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search squads…"
            className="w-full text-sm rounded-xl px-3 py-2 focus:outline-none border mb-2"
            style={{ background: "var(--bg)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
          />
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {filteredPublic.length === 0 && (
              <p className="text-xs text-center py-3" style={{ color: "var(--text-2)" }}>
                {search ? "No matches" : "No public squads yet"}
              </p>
            )}
            {filteredPublic.map((s) => (
              <div key={s.id} className="flex items-center gap-2 py-1.5 px-2 rounded-xl" style={{ background: "var(--bg)" }}>
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: "var(--surface-2)" }}>
                  {s.emoji || "🏆"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{s.name}</div>
                  <div className="text-xs" style={{ color: "var(--text-2)" }}>
                    {s.member_count} member{s.member_count === 1 ? "" : "s"}
                    {s.description ? ` · ${s.description}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => joinSquad(s)}
                  disabled={busy}
                  className="text-xs font-semibold px-2.5 py-1 rounded-full text-white disabled:opacity-50"
                  style={{ background: "var(--purple)" }}
                >
                  Join
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateSquadModal
          username={username}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </section>
  );
}
