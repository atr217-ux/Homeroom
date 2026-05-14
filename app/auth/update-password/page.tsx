"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Exchange code or session from URL (Supabase recovery flow)
    async function init() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");

      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      } else if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token });
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setReady(true);
      } else {
        setError("Reset link is invalid or has expired.");
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpdate() {
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setDone(true);
    setTimeout(() => router.replace("/home"), 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9F7F4] px-4">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 px-8 py-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
          <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Set new password</h1>
        </div>

        {done ? (
          <div className="text-center">
            <div className="text-4xl mb-4">✅</div>
            <p className="text-sm font-semibold text-charcoal">Password updated!</p>
            <p className="text-sm text-warm-gray mt-1">Taking you home…</p>
          </div>
        ) : !ready && !error ? (
          <p className="text-sm text-warm-gray text-center">Verifying link…</p>
        ) : error && !ready ? (
          <div className="text-center">
            <p className="text-sm text-red-400 mb-4">{error}</p>
            <button onClick={() => router.replace("/welcome")} className="text-sm text-warm-gray hover:text-charcoal transition-colors">← Back to login</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-charcoal mb-1.5">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                placeholder="At least 6 characters"
                autoFocus
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-charcoal mb-1.5">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                placeholder="Same password again"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              onClick={handleUpdate}
              disabled={!password || !confirm || loading}
              className="w-full font-semibold text-sm py-3 rounded-xl transition-opacity disabled:opacity-40"
              style={{ background: "var(--purple)", color: "white" }}
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
