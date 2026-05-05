"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const AVATAR_EMOJIS = [
  "😊","😎","🤓","🧑‍💻","👨‍🎨","👩‍🎨","🦊","🐼","🐸","🦁",
  "🐯","🦋","🌟","⚡","🔥","💎","🎯","🚀","🌙","☀️",
  "🎸","🎨","🏋️","🧘","🌊","🏔️","🌿","🍀","🦄","👾",
];

export default function WelcomePage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [avatar, setAvatar] = useState("");
  const [step, setStep] = useState<"name" | "avatar">("name");

  useEffect(() => {
    const stored = localStorage.getItem("homeroom-username");
    if (stored && stored.trim()) router.replace("/home");
  }, [router]);

  function getTakenUsernames(): string[] {
    try {
      const friends = JSON.parse(localStorage.getItem("homeroom-friends") ?? "[]");
      const pending = JSON.parse(localStorage.getItem("homeroom-pending-friends") ?? "[]");
      return [...friends, ...pending].map((f: { username?: string; name?: string }) =>
        (f.username ?? f.name ?? "").toLowerCase()
      ).filter(Boolean);
    } catch { return []; }
  }

  function handleUsernameInput(raw: string) {
    const cleaned = raw.replace(/\s/g, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15);
    setUsername(cleaned);
    if (!cleaned) { setUsernameError(""); return; }
    if (/[^a-zA-Z0-9_]/.test(raw.replace(/\s/g, ""))) {
      setUsernameError("Only letters, numbers, and underscores");
    } else if (getTakenUsernames().includes(cleaned.toLowerCase())) {
      setUsernameError("That username is already taken");
    } else {
      setUsernameError("");
    }
  }

  function submitName() {
    if (!username.trim() || usernameError) return;
    if (getTakenUsernames().includes(username.toLowerCase())) {
      setUsernameError("That username is already taken");
      return;
    }
    setStep("avatar");
  }

  function finish(chosenAvatar: string) {
    localStorage.setItem("homeroom-username", username.trim());
    localStorage.setItem("homeroom-avatar", chosenAvatar);
    router.replace("/home");
  }

  function skipAvatar() {
    localStorage.setItem("homeroom-username", username.trim());
    if (avatar) localStorage.setItem("homeroom-avatar", avatar);
    router.replace("/home");
  }

  if (step === "avatar") {
    return (
      <div>
        <div className="mb-8 text-center">
          <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
          <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Pick your avatar</h1>
          <p className="text-sm text-warm-gray mt-1">
            This will show on your profile and to friends.
          </p>
        </div>

        <div className="grid grid-cols-6 gap-2 mb-6">
          {AVATAR_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => setAvatar(emoji)}
              className="text-2xl h-12 w-full rounded-xl flex items-center justify-center transition-colors hover:bg-gray-100"
              style={avatar === emoji ? { background: "#EDE9FE", outline: "2px solid #7C3AED" } : {}}
            >
              {emoji}
            </button>
          ))}
        </div>

        <button
          onClick={() => avatar ? finish(avatar) : skipAvatar()}
          className="w-full bg-charcoal text-white font-semibold text-sm py-3 rounded-xl hover:bg-black transition-colors"
        >
          {avatar ? "Let's go" : "Skip for now"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 text-center">
        <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
        <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Welcome.</h1>
        <p className="text-sm text-warm-gray mt-1">Adulting is hard. Don&apos;t do it alone.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-charcoal mb-1.5">Choose a username</label>
          <div
            className="flex items-center border rounded-xl px-3 py-2.5 bg-white"
            style={{ borderColor: usernameError ? "#F87171" : "#E5E7EB" }}
          >
            <input
              type="text"
              value={username}
              onChange={(e) => handleUsernameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitName()}
              placeholder="your_username"
              maxLength={15}
              autoFocus
              className="flex-1 text-sm bg-transparent text-charcoal placeholder:text-warm-gray focus:outline-none"
            />
            <span className="text-xs text-warm-gray ml-1 flex-shrink-0">{username.length}/15</span>
          </div>
          {usernameError ? (
            <p className="text-xs text-red-400 mt-1">{usernameError}</p>
          ) : (
            <p className="text-xs text-warm-gray mt-1">Letters, numbers, and underscores only</p>
          )}
        </div>

        <button
          onClick={submitName}
          disabled={!username.trim() || !!usernameError}
          className="w-full bg-charcoal text-white font-semibold text-sm py-3 rounded-xl hover:bg-black transition-colors disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
