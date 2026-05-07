"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type WrappedData = {
  homeroomId: string;
  title: string;
  elapsedMin: number;
  tasksDone: { id: string; text: string }[];
  tasksRemaining: { id: string; text: string }[];
};

export default function SessionSync() {
  const router = useRouter();
  const pathname = usePathname();
  const [wrapped, setWrapped] = useState<WrappedData | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth + profile sync
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace("/welcome"); return; }
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      if (profile) {
        const storedUsername = localStorage.getItem("homeroom-username");
        localStorage.setItem("homeroom-username", profile.username);
        localStorage.setItem("homeroom-avatar", profile.avatar ?? "");
        if (storedUsername !== profile.username) router.refresh();
      } else {
        await supabase.auth.signOut();
        router.replace("/welcome");
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Monitor active session timer from any page
  useEffect(() => {
    // Room page manages its own timer and wrapped modal
    if (pathname.startsWith("/room")) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const activeId = localStorage.getItem("homeroom-active-id");
    if (!activeId) return;

    const supabase = createClient();
    let channelRef: ReturnType<typeof supabase.channel> | null = null;

    async function buildWrapped(homeroomId: string, startedAt: string, title: string): Promise<WrappedData> {
      const { data: { user } } = await supabase.auth.getUser();
      let tasksDone: { id: string; text: string }[] = [];
      let tasksRemaining: { id: string; text: string }[] = [];
      if (user) {
        const { data: tasks } = await supabase
          .from("tasks").select("id, text, done")
          .eq("homeroom_id", homeroomId).eq("user_id", user.id);
        if (tasks) {
          tasksDone = tasks.filter(t => t.done).map(t => ({ id: t.id, text: t.text }));
          tasksRemaining = tasks.filter(t => !t.done).map(t => ({ id: t.id, text: t.text }));
          // Clear homeroom association from undone tasks
          if (tasksRemaining.length > 0) {
            await supabase.from("tasks")
              .update({ homeroom_id: null })
              .in("id", tasksRemaining.map(t => t.id));
          }
        }
      }
      const elapsedMin = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
      return { homeroomId, title, elapsedMin, tasksDone, tasksRemaining };
    }

    async function watchSession() {
      const { data: homeroom } = await supabase
        .from("homerooms")
        .select("id, title, duration, started_at, status")
        .eq("id", activeId)
        .single();

      if (!homeroom || homeroom.status !== "active") {
        localStorage.removeItem("homeroom-active-id");
        return;
      }

      const elapsedMs = Date.now() - new Date(homeroom.started_at!).getTime();
      const totalMs = homeroom.duration > 0 ? homeroom.duration * 60 * 1000 : null;

      async function triggerWrap() {
        if (channelRef) { supabase.removeChannel(channelRef); channelRef = null; }
        await supabase.from("homerooms")
          .update({ status: "completed", ended_at: new Date().toISOString() })
          .eq("id", activeId);
        localStorage.removeItem("homeroom-active-id");
        localStorage.removeItem(`homeroom-chat-${activeId}`);
        const data = await buildWrapped(activeId!, homeroom!.started_at!, homeroom!.title);
        setWrapped(data);
      }

      if (totalMs !== null) {
        const remainingMs = totalMs - elapsedMs;
        if (remainingMs <= 0) {
          triggerWrap();
          return;
        }
        timerRef.current = setTimeout(triggerWrap, remainingMs);
      }

      // Watch for the host ending the session early from inside the room
      channelRef = supabase
        .channel(`session-sync-room-${activeId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "homerooms", filter: `id=eq.${activeId}` },
          async (payload) => {
            if ((payload.new as { status: string }).status === "completed") {
              if (timerRef.current) clearTimeout(timerRef.current);
              if (channelRef) { supabase.removeChannel(channelRef); channelRef = null; }
              localStorage.removeItem("homeroom-active-id");
              localStorage.removeItem(`homeroom-chat-${activeId}`);
              const data = await buildWrapped(activeId!, homeroom!.started_at!, homeroom!.title);
              setWrapped(data);
            }
          }
        )
        .subscribe();
    }

    watchSession();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (channelRef) supabase.removeChannel(channelRef);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!wrapped) return null;

  const { title, elapsedMin, tasksDone, tasksRemaining } = wrapped;
  const elapsedH = Math.floor(elapsedMin / 60);
  const elapsedM = elapsedMin % 60;
  const elapsedDisplay = elapsedH > 0
    ? `${elapsedH}h ${elapsedM}m`
    : `${elapsedMin} minute${elapsedMin !== 1 ? "s" : ""}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-xl p-6 flex flex-col gap-5">
        <div className="text-center">
          <div className="text-4xl mb-3">
            {tasksDone.length > 0 && tasksRemaining.length === 0 ? "🎉" : "🏠"}
          </div>
          <h2 className="text-xl font-bold" style={{ color: "#1C1917" }}>Session wrapped</h2>
          <p className="text-sm mt-1" style={{ color: "#78716C" }}>
            {title ? `"${title}" · ` : ""}{elapsedDisplay}
          </p>
        </div>

        <div className="rounded-2xl px-4 py-4 space-y-3" style={{ background: "#F9FAFB" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "#78716C" }}>Tasks completed</span>
            <span className="text-sm font-semibold" style={{ color: "#1C1917" }}>
              {tasksDone.length} of {tasksDone.length + tasksRemaining.length}
            </span>
          </div>
          {tasksRemaining.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: "#78716C" }}>Still unfinished</span>
              <span className="text-sm font-semibold" style={{ color: "#1C1917" }}>{tasksRemaining.length}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {tasksRemaining.length > 0 && (
            <button
              onClick={() => { setWrapped(null); router.push("/start"); }}
              className="w-full font-semibold text-sm py-3 rounded-xl text-white transition-opacity hover:opacity-80"
              style={{ background: "#7C3AED" }}
            >
              Schedule a homeroom to finish ({tasksRemaining.length} task{tasksRemaining.length !== 1 ? "s" : ""})
            </button>
          )}
          <button
            onClick={() => { setWrapped(null); router.push("/home"); }}
            className="w-full font-semibold text-sm py-3 rounded-xl border hover:bg-gray-50 transition-colors"
            style={{ borderColor: "#E5E7EB", color: "#1C1917" }}
          >
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
