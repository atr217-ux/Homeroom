"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const AVATAR_EMOJIS = [
  "😊","😎","🤓","🧑‍💻","👨‍🎨","👩‍🎨","🦊","🐼","🐸","🦁",
  "🐯","🦋","🌟","⚡","🔥","💎","🎯","🚀","🌙","☀️",
  "🎸","🎨","🏋️","🧘","🌊","🏔️","🌿","🍀","🦄","👾",
];

type RegisteredUser = {
  username: string;
  email: string;
  avatar: string;
  friends: unknown[];
  pendingFriends: unknown[];
  joinedSquads: string[];
  mySquads: unknown[];
  tasks: unknown[];
  taskHistory: unknown[];
  scheduled: unknown[];
};

function getRegisteredUsers(): Record<string, RegisteredUser> {
  try {
    const raw = localStorage.getItem("homeroom-registered-users");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveRegisteredUsers(users: Record<string, RegisteredUser>) {
  localStorage.setItem("homeroom-registered-users", JSON.stringify(users));
}

export function saveCurrentUserState() {
  const username = localStorage.getItem("homeroom-username");
  if (!username) return;
  const users = getRegisteredUsers();
  const existing = users[username.toLowerCase()];
  users[username.toLowerCase()] = {
    username,
    email: existing?.email ?? "",
    avatar: localStorage.getItem("homeroom-avatar") ?? "",
    friends: JSON.parse(localStorage.getItem("homeroom-friends") ?? "[]"),
    pendingFriends: JSON.parse(localStorage.getItem("homeroom-pending-friends") ?? "[]"),
    joinedSquads: JSON.parse(localStorage.getItem("homeroom-joined-squads") ?? "[]"),
    mySquads: JSON.parse(localStorage.getItem("homeroom-my-squads") ?? "[]"),
    tasks: JSON.parse(localStorage.getItem("homeroom-tasks") ?? "[]"),
    taskHistory: JSON.parse(localStorage.getItem("homeroom-task-history") ?? "[]"),
    scheduled: JSON.parse(localStorage.getItem("homeroom-scheduled") ?? "[]"),
  };
  saveRegisteredUsers(users);
}

function restoreUserData(user: RegisteredUser) {
  localStorage.setItem("homeroom-username", user.username);
  localStorage.setItem("homeroom-avatar", user.avatar);
  localStorage.setItem("homeroom-friends", JSON.stringify(user.friends));
  localStorage.setItem("homeroom-pending-friends", JSON.stringify(user.pendingFriends));
  localStorage.setItem("homeroom-joined-squads", JSON.stringify(user.joinedSquads));
  localStorage.setItem("homeroom-my-squads", JSON.stringify(user.mySquads));
  localStorage.setItem("homeroom-tasks", JSON.stringify(user.tasks));
  localStorage.setItem("homeroom-task-history", JSON.stringify(user.taskHistory));
  localStorage.setItem("homeroom-scheduled", JSON.stringify(user.scheduled));
}

export default function WelcomePage() {
  const router = useRouter();

  // "login" | "register-name" | "register-avatar"
  const [step, setStep] = useState<"login" | "register-name" | "register-avatar">("login");

  const [loginInput, setLoginInput] = useState("");
  const [loginError, setLoginError] = useState("");

  const [regUsername, setRegUsername] = useState("");
  const [regUsernameError, setRegUsernameError] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regEmailError, setRegEmailError] = useState("");
  const [regAvatar, setRegAvatar] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("homeroom-username");
    if (stored && stored.trim()) router.replace("/home");
  }, [router]);

  // ── Login ──────────────────────────────────────────────────────────────────

  function handleLogin() {
    const val = loginInput.trim().toLowerCase();
    if (!val) return;
    const users = getRegisteredUsers();
    // Try username first, then scan for matching email
    const user = users[val] ?? Object.values(users).find((u) => u.email.toLowerCase() === val);
    if (!user) {
      setLoginError("No account found with that username or email.");
      return;
    }
    restoreUserData(user);
    router.replace("/home");
  }

  // ── Register ───────────────────────────────────────────────────────────────

  function handleRegUsernameInput(raw: string) {
    const cleaned = raw.replace(/\s/g, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15);
    setRegUsername(cleaned);
    if (!cleaned) { setRegUsernameError(""); return; }
    if (getRegisteredUsers()[cleaned.toLowerCase()]) {
      setRegUsernameError("That username is already taken");
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
    } else if (Object.values(getRegisteredUsers()).some((u) => u.email.toLowerCase() === raw.trim().toLowerCase())) {
      setRegEmailError("An account with that email already exists");
    } else {
      setRegEmailError("");
    }
  }

  function submitRegName() {
    if (!regUsername.trim() || regUsernameError) return;
    if (!regEmail.trim() || regEmailError) { setRegEmailError(regEmailError || "Email is required"); return; }
    if (getRegisteredUsers()[regUsername.toLowerCase()]) {
      setRegUsernameError("That username is already taken");
      return;
    }
    setStep("register-avatar");
  }

  function finishRegister(chosenAvatar: string) {
    const newUser: RegisteredUser = {
      username: regUsername.trim(),
      email: regEmail.trim(),
      avatar: chosenAvatar,
      friends: [], pendingFriends: [], joinedSquads: [],
      mySquads: [], tasks: [], taskHistory: [], scheduled: [],
    };
    const users = getRegisteredUsers();
    users[regUsername.toLowerCase()] = newUser;
    saveRegisteredUsers(users);
    restoreUserData(newUser);
    router.replace("/home");
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (step === "register-avatar") {
    return (
      <div>
        <div className="mb-8 text-center">
          <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
          <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Pick your avatar</h1>
          <p className="text-sm text-warm-gray mt-1">This shows on your profile and to friends.</p>
        </div>

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
          className="w-full bg-charcoal text-white font-semibold text-sm py-3 rounded-xl hover:bg-black transition-colors"
        >
          {regAvatar ? "Let's go" : "Skip for now"}
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

          <button
            onClick={submitRegName}
            disabled={!regUsername.trim() || !!regUsernameError || !regEmail.trim() || !!regEmailError}
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
        <p className="text-sm text-warm-gray mt-1">Adulting is hard. Don&apos;t do it alone.</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-charcoal mb-1.5">Username or email</label>
          <input
            type="text"
            value={loginInput}
            onChange={(e) => { setLoginInput(e.target.value); setLoginError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="your_username or you@example.com"
            autoFocus
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
            style={loginError ? { borderColor: "#F87171" } : {}}
          />
          {loginError && <p className="text-xs text-red-400 mt-1">{loginError}</p>}
        </div>

        <button
          onClick={handleLogin}
          disabled={!loginInput.trim()}
          className="w-full bg-charcoal text-white font-semibold text-sm py-3 rounded-xl hover:bg-black transition-colors disabled:opacity-40"
        >
          Log in
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
