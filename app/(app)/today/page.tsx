"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey } from "@/lib/utils/date";
import { useBlockClock } from "@/lib/hooks/useBlockClock";
import CommitPicker from "@/components/today/CommitPicker";
import CommittedList from "@/components/today/CommittedList";
import BlockCreateModal from "@/components/today/BlockCreateModal";
import BlockLiveView from "@/components/today/BlockLiveView";

type Phase = "loading" | "picker" | "committed";
type ViewMode = "block" | "today";

export default function TodayPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Manual override — set only when the user taps the toggle, cleared when
  // a new active block arrives so the auto default kicks in again.
  const [viewOverride, setViewOverride] = useState<ViewMode | null>(null);
  const { activeBlock, loading: blockLoading } = useBlockClock(userId);
  // Default view derives from block state so /today opens into the block
  // when one is live — no "Today first, then Block" flash on load.
  const viewMode: ViewMode = viewOverride ?? (activeBlock ? "block" : "today");
  const setViewMode = setViewOverride;

  const refreshCommitState = useCallback(async () => {
    if (!userId) return;
    const today = dateKey(new Date());
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .select("id")
      .eq("user_id", userId)
      .eq("committed_for_date", today)
      .limit(1);
    setPhase((data && data.length > 0) ? "committed" : "picker");
  }, [userId]);

  // Initial auth + phase resolution
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
    }
    init();
  }, []);

  useEffect(() => {
    if (userId) refreshCommitState();
  }, [userId, reloadKey, refreshCommitState]);

  // Reset any manual override whenever the active block changes so the
  // derived default takes over. If the user came in via a carry-preselect,
  // force Today so CommitPicker mounts and consumes the sessionStorage.
  useEffect(() => {
    const carryPending = typeof window !== "undefined" && !!sessionStorage.getItem("homeroom-carry-preselect");
    if (carryPending && activeBlock) {
      setViewOverride("today");
    } else {
      setViewOverride(null);
    }
  }, [activeBlock?.id]);

  if (!userId || phase === "loading" || blockLoading) {
    return (
      <div className="flex items-center justify-center pt-32">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--purple)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const showToggle = activeBlock !== null;

  return (
    <>
      {showToggle && (
        <div className="max-w-2xl mx-auto px-4 pt-4">
          <div
            className="flex items-center rounded-full border p-1 gap-1"
            style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}
          >
            <button
              type="button"
              onClick={() => setViewMode("block")}
              className="flex-1 text-xs font-semibold py-2 rounded-full transition-colors flex items-center justify-center gap-1.5"
              style={viewMode === "block"
                ? { background: "var(--purple)", color: "white" }
                : { background: "transparent", color: "var(--text-2)" }}
            >
              {viewMode === "block" && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "white", boxShadow: "0 0 0 3px rgba(255,255,255,0.35)" }}
                />
              )}
              <span className="truncate max-w-[140px]">
                {activeBlock!.name || "Block"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("today")}
              className="flex-1 text-xs font-semibold py-2 rounded-full transition-colors"
              style={viewMode === "today"
                ? { background: "var(--purple)", color: "white" }
                : { background: "transparent", color: "var(--text-2)" }}
            >
              Today
            </button>
          </div>
        </div>
      )}

      {activeBlock && viewMode === "block" ? (
        <BlockLiveView block={activeBlock} userId={userId} />
      ) : (
        <>
          {phase === "picker" && (
            <CommitPicker userId={userId} onCommitted={() => setReloadKey((k) => k + 1)} blockReloadKey={reloadKey} />
          )}
          {phase === "committed" && (
            <CommittedList userId={userId} onOpenSchedule={() => setScheduleOpen(true)} blockReloadKey={reloadKey} />
          )}
        </>
      )}

      {scheduleOpen && (
        <BlockCreateModal
          userId={userId}
          onClose={() => setScheduleOpen(false)}
          onCreated={() => {
            setScheduleOpen(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}
