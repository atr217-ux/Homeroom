"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  username: string;
  onClose: () => void;
  onCreated: () => void;
};

export default function CreateSquadModal({ username, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🏆");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanName = name.replace(/[^a-zA-Z0-9]/g, "");

  async function save() {
    if (!cleanName) { setError("Give the squad a name"); return; }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: insertErr } = await supabase.from("squads").insert({
      name: `#${cleanName}`,
      description: description.trim(),
      emoji: emoji || "🏆",
      is_public: isPublic,
      created_by: username,
      member_count: 1,
    }).select().single();

    if (insertErr || !data) {
      setBusy(false);
      setError(insertErr?.message ?? "Could not create squad");
      return;
    }
    await supabase.from("squad_members").insert({
      squad_id: data.id,
      username,
      role: "owner",
    });
    setBusy(false);
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: "var(--surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: "var(--text)" }}>Create squad</h3>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--text-2)" }}>Cancel</button>
        </div>

        {/* Name + emoji */}
        <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: "var(--text-2)" }}>Name</label>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
            className="w-14 text-center text-lg rounded-xl px-2 py-2.5 border"
            style={{ background: "var(--bg)", borderColor: "var(--border-2)" }}
          />
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ color: "var(--text-2)" }}>#</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
              maxLength={24}
              placeholder="squadname"
              className="w-full text-sm rounded-xl pl-7 pr-3 py-2.5 focus:outline-none border"
              style={{ background: "var(--bg)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
            />
          </div>
        </div>

        {/* Description */}
        <label className="text-xs font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: "var(--text-2)" }}>Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={120}
          placeholder="What's this squad for?"
          className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none border mb-3"
          style={{ background: "var(--bg)", borderColor: "var(--border-2)", color: "var(--text)", fontSize: "16px" }}
        />

        {/* Visibility */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setIsPublic(true)}
            className="flex-1 text-sm font-semibold py-2 rounded-xl border transition-colors"
            style={isPublic
              ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
              : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
          >
            Public
          </button>
          <button
            onClick={() => setIsPublic(false)}
            className="flex-1 text-sm font-semibold py-2 rounded-xl border transition-colors"
            style={!isPublic
              ? { background: "var(--purple)", color: "white", borderColor: "var(--purple)" }
              : { background: "var(--surface)", color: "var(--text-2)", borderColor: "var(--border-2)" }}
          >
            Private
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-2)" }}>
          {isPublic
            ? "Anyone can find and join this squad."
            : "Only invited friends can see and join this squad."}
        </p>

        {error && (
          <p className="text-xs mb-3" style={{ color: "var(--red)" }}>{error}</p>
        )}

        <button
          onClick={save}
          disabled={busy || !cleanName}
          className="w-full py-3 rounded-xl text-base font-bold text-white disabled:opacity-50"
          style={{ background: "var(--purple)" }}
        >
          {busy ? "Creating…" : `Create #${cleanName || "squad"}`}
        </button>
      </div>
    </div>
  );
}
