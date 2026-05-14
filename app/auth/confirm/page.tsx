"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ConfirmPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");

  useEffect(() => {
    const supabase = createClient();

    // Query params (PKCE flow)
    const params = new URLSearchParams(window.location.search);
    const token_hash = params.get("token_hash");
    const type = params.get("type");
    const code = params.get("code");

    // Hash fragment (implicit flow)
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");

    async function verify() {
      const isRecovery = type === "recovery" || hash.get("type") === "recovery";
      const dest = isRecovery ? "/auth/update-password" : "/welcome";

      if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash,
          type: type as "signup",
        });
        if (!error) { setStatus("success"); setTimeout(() => router.replace(dest), 800); return; }
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) { setStatus("success"); setTimeout(() => router.replace(dest), 800); return; }
      }

      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (!error) { setStatus("success"); setTimeout(() => router.replace(dest), 800); return; }
      }

      // Check if the client already handled the session from the URL
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setStatus("success");
        setTimeout(() => router.replace(dest), 800);
        return;
      }

      setStatus("error");
    }

    verify();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9F7F4] px-4">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 px-8 py-10 w-full max-w-sm text-center">
        <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>

        {status === "verifying" && (
          <>
            <div className="text-4xl mt-6 mb-3">⏳</div>
            <h1 className="text-xl font-bold text-charcoal">Verifying…</h1>
            <p className="text-sm text-warm-gray mt-2">Just a second.</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="text-4xl mt-6 mb-3">✅</div>
            <h1 className="text-xl font-bold text-charcoal">Email verified!</h1>
            <p className="text-sm text-warm-gray mt-2">Taking you to your profile…</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-4xl mt-6 mb-3">❌</div>
            <h1 className="text-xl font-bold text-charcoal">Link invalid or expired</h1>
            <p className="text-sm text-warm-gray mt-2">Try registering again.</p>
            <button
              onClick={() => router.replace("/welcome")}
              className="mt-6 w-full bg-charcoal text-white font-semibold text-sm py-3 rounded-xl hover:bg-black transition-colors"
            >
              Back to welcome
            </button>
          </>
        )}
      </div>
    </div>
  );
}
