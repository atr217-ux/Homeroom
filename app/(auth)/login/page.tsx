"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "@/app/auth/actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <div>
      <div className="mb-8 text-center">
        <span className="text-xs font-semibold tracking-widest text-sage uppercase">Homeroom</span>
        <h1 className="text-2xl font-bold text-charcoal mt-2 leading-snug">Welcome back.</h1>
        <p className="text-sm text-warm-gray mt-1">Good to see you again.</p>
      </div>

      <form action={action} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-charcoal mb-1.5">Email</label>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-charcoal mb-1.5">Password</label>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:border-sage transition-colors"
          />
        </div>

        {state?.error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full font-semibold text-sm py-3 rounded-xl mt-1 transition-opacity disabled:opacity-40" style={{ background: "var(--purple)", color: "white" }}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-center text-sm text-warm-gray mt-6">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-semibold text-sage hover:text-sage-dark transition-colors">
          Create one →
        </Link>
      </p>
    </div>
  );
}
