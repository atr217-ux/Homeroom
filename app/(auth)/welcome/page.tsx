"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const AVATAR_EMOJIS = [
  "😊","😎","🤓","🧑‍💻","👨‍🎨","👩‍🎨","🦊","🐼","🐸","🦁",
  "🐯","🦋","🌟","⚡","🔥","💎","🎯","🚀","🌙","☀️",
  "🎸","🎨","🏋️","🧘","🌊","🏔️","🌿","🍀","🦄","👾",
];

type Profile = {
  id: string;
  username: string;
  email: string;
  avatar: string;
};

// Kept as a no-op export so profile page import doesn't break
export function saveCurrentUserState() {}

function restoreUserData(profile: Profile) {
  localStorage.setItem("homeroom-username", profile.username);
  localStorage.setItem("homeroom-avatar", profile.avatar ?? "");
}

export default function WelcomePage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<"login" | "register-name" | "register-avatar" | "check-email">("login");
  const [pendingEmail, setPendingEmail] = useState("");

  const [loginInput, setLoginInput] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [regUsername, setRegUsername] = useState("");
  const [regUsernameError, setRegUsernameError] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regEmailError, setRegEmailError] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPasswordError, setRegPasswordError] = useState("");
  const [regAvatar, setRegAvatar] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;

      // After email verification, insert the pending profile then go to /profile
      const pendingRaw = localStorage.getItem("homeroom-pending-profile");
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw) as Profile;
          const { error } = await supabase.from("profiles").insert({
            id: session.user.id,
            username: pending.username,
            email: pending.email,
            avatar: pending.avatar,
          });
          if (!error) {
            localStorage.removeItem("homeroom-pending-profile");
            restoreUserData({ ...pending, id: session.user.id });
            router.replace("/profile");
            return;
          }
        } catch { /* fall through to normal load */ }
      }

      // Normal login — load existing profile
      supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            restoreUserData(data as Profile);
            router.replace("/home");
          }
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Login ──────────────────────────────────────────────────────────────────

  async function handleLogin() {
    const val = loginInput.trim();
    const pwd = loginPassword.trim();
    if (!val || !pwd) return;
    setLoginLoading(true);
    setLoginError("");

    let email = val;

    // If no @, treat as username → look up email in profiles
    if (!val.includes("@")) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .ilike("username", val)
        .single();
      if (!profile) {
        setLoginError("No account found with that username.");
        setLoginLoading(false);
        return;
      }
      email = profile.email;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
    if (error) {
      setLoginError("Incorrect password or account not found.");
      setLoginLoading(false);
      return;
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .single();
    if (prof) restoreUserData(prof as Profile);
    router.replace("/home");
  }

  // ── Register ───────────────────────────────────────────────────────────────

  function handleRegUsernameInput(raw: string) {
    const cleaned = raw.replace(/\s/g, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15);
    setRegUsername(cleaned);
    if (!cleaned) { setRegUsernameError(""); return; }
    if (/[^a-zA-Z0-9_]/.test(raw.replace(/\s/g, ""))) {
      setRegUsernameError("Only letters, numbers, and underscores");
    } else {
      setRegUsernameError("");
    }
  }

  function handleRegEmailInput(raw: string) {
    setRegEmail(raw);
    if (!raw.trim()) { setRegEmailError(""); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(raw.trim())) {
      setRegEmailError("Enter a valid email address");
    } else {
      setRegEmailError("");
    }
  }

  function handleRegPasswordInput(raw: string) {
    setRegPassword(raw);
    if (!raw) { setRegPasswordError(""); return; }
    if (raw.length < 6) {
      setRegPasswordError("Password must be at least 6 characters");
    } else {
      setRegPasswordError("");
    }
  }

  async function submitRegName() {
    if (!regUsername.trim() || regUsernameError) return;
    if (!regEmail.trim() || regEmailError) { setRegEmailError(regEmailError || "Email is required"); return; }
    if (!regPassword || regPassword.length < 6) { setRegPasswordError("Password must be at least 6 characters"); return; }

    // Check username uniqueness against DB
    const { data: existingUser } = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", regUsername.trim())
      .single();
    if (existingUser) {
      setRegUsernameError("That username is already taken");
      return;
    }
    setStep("register-avatar");
  }

  async function finishRegister(chosenAvatar: string) {
    setRegLoading(true);
    setRegError("");

    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: regEmail.trim(),
      password: regPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    if (signUpError || !authData.user) {
      setRegError(signUpError?.message ?? "Failed to create account.");
      setRegLoading(false);
      return;
    }

    const profileData = {
      id: authData.user.id,
      username: regUsername.trim(),
      email: regEmail.trim(),
      avatar: chosenAvatar,
    };

    if (authData.session) {
      // Explicitly set session so the insert uses the right auth token
      await supabase.auth.setSession(authData.session);

      const { error: profileError } = await supabase.from("profiles").insert(profileData);
      if (profileError) {
        setRegError(`Profile setup failed: ${profileError.message}`);
        setRegLoading(false);
        return;
      }
      restoreUserData(profileData);
      router.replace("/profile");
    } else {
      // Email confirmation is enabled — store pending and show check-email screen
      localStorage.setItem("homeroom-pending-profile", JSON.stringify(profileData));
      setPendingEmail(regEmail.trim());
      setRegLoading(false);
      setStep("check-email");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (step === "check-email") {
    return (
      <div className="text-center">
        <div className="text-5xl mb-6">📬</div>
        <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
        <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Check your inbox</h1>
        <p className="text-sm text-warm-gray mt-2">
          We sent a verification link to
        </p>
        <p className="text-sm font-semibold text-charcoal mt-0.5">{pendingEmail}</p>
        <p className="text-sm text-warm-gray mt-3">
          Click the link in that email to confirm your account. It expires in 24 hours.
        </p>
        <button
          onClick={() => setStep("login")}
          className="mt-8 w-full text-sm text-warm-gray hover:text-charcoal transition-colors"
        >
          ← Back to login
        </button>
      </div>
    );
  }

  if (step === "register-avatar") {
    return (
      <div>
        <div className="mb-8 text-center">
          <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
          <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Pick your avatar</h1>
          <p className="text-sm text-warm-gray mt-1">This shows on your profile and to friends.</p>
        </div>

        {regError && <p className="text-xs text-red-400 mb-4 text-center">{regError}</p>}

        <div className="grid grid-cols-6 gap-2 mb-6">
          {AVATAR_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => setRegAvatar(emoji)}
              className="text-2xl h-12 w-full rounded-xl flex items-center justify-center transition-colors hover:bg-gray-100"
              style={regAvatar === emoji ? { background: "#EDE9FE", outline: "2px solid #7C3AED" } : {}}
            >
              {emoji}
            </button>
          ))}
        </div>

        <button
          onClick={() => finishRegister(regAvatar)}
          disabled={regLoading}
          className="w-full bg-charcoal text-white font-semibold text-sm py-3 rounded-xl hover:bg-black transition-colors disabled:opacity-40"
        >
          {regLoading ? "Creating account…" : (regAvatar ? "Let's go" : "Skip for now")}
        </button>
      </div>
    );
  }

  if (step === "register-name") {
    return (
      <div>
        <div className="mb-8 text-center">
          <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
          <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Create account</h1>
          <p className="text-sm text-warm-gray mt-1">Choose a username to get started.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-charcoal mb-1.5">Username</label>
            <div
              className="flex items-center border rounded-xl px-3 py-2.5 bg-white"
              style={{ borderColor: regUsernameError ? "#F87171" : "#E5E7EB" }}
            >
              <input
                type="text"
                value={regUsername}
                onChange={(e) => handleRegUsernameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitRegName()}
                placeholder="your_username"
                maxLength={15}
                autoFocus
                className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
              />
              <span className="text-xs text-warm-gray ml-1 flex-shrink-0">{regUsername.length}/15</span>
            </div>
            {regUsernameError ? (
              <p className="text-xs text-red-400 mt-1">{regUsernameError}</p>
            ) : (
              <p className="text-xs text-warm-gray mt-1">Letters, numbers, and underscores only</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-charcoal mb-1.5">Email</label>
            <input
              type="email"
              value={regEmail}
              onChange={(e) => handleRegEmailInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRegName()}
              placeholder="you@example.com"
              className="w-full text-sm border rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
              style={{ borderColor: regEmailError ? "#F87171" : "#E5E7EB" }}
            />
            {regEmailError && <p className="text-xs text-red-400 mt-1">{regEmailError}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-charcoal mb-1.5">Password</label>
            <input
              type="password"
              value={regPassword}
              onChange={(e) => handleRegPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRegName()}
              placeholder="At least 6 characters"
              className="w-full text-sm border rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
              style={{ borderColor: regPasswordError ? "#F87171" : "#E5E7EB" }}
            />
            {regPasswordError && <p className="text-xs text-red-400 mt-1">{regPasswordError}</p>}
          </div>

          <button
            onClick={submitRegName}
            disabled={!regUsername.trim() || !!regUsernameError || !regEmail.trim() || !!regEmailError || !regPassword || !!regPasswordError}
            className="w-full bg-charcoal text-white font-semibold text-sm py-3 rounded-xl hover:bg-black transition-colors disabled:opacity-40"
          >
            Continue
          </button>

          <button
            onClick={() => setStep("login")}
            className="w-full text-sm text-warm-gray hover:text-charcoal transition-colors"
          >
            ← Back to login
          </button>
        </div>
      </div>
    );
  }

  // Default: login
  return (
    <div>
      <div className="mb-8 text-center">
        <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
        <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Welcome back.</h1>
        <p className="text-sm text-warm-gray mt-1">Better focus. Better company.</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-charcoal mb-1.5">Username or email</label>
          <input
            type="text"
            value={loginInput}
            onChange={(e) => { setLoginInput(e.target.value); setLoginError(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") document.getElementById("login-password-field")?.focus();
            }}
            placeholder="your_username or you@example.com"
            autoFocus
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
            style={loginError ? { borderColor: "#F87171" } : {}}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-charcoal mb-1.5">Password</label>
          <input
            id="login-password-field"
            type="password"
            value={loginPassword}
            onChange={(e) => { setLoginPassword(e.target.value); setLoginError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Your password"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
            style={loginError ? { borderColor: "#F87171" } : {}}
          />
          {loginError && <p className="text-xs text-red-400 mt-1">{loginError}</p>}
        </div>

        <button
          onClick={handleLogin}
          disabled={!loginInput.trim() || !loginPassword.trim() || loginLoading}
          className="w-full bg-charcoal text-white font-semibold text-sm py-3 rounded-xl hover:bg-black transition-colors disabled:opacity-40"
        >
          {loginLoading ? "Logging in…" : "Log in"}
        </button>

        <div className="relative flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-warm-gray flex-shrink-0">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <button
          onClick={() => setStep("register-name")}
          className="w-full border border-gray-200 text-charcoal font-semibold text-sm py-3 rounded-xl hover:border-sage hover:text-sage transition-colors"
        >
          Create new account
        </button>
      </div>
    </div>
  );
}
