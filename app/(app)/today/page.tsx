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

export default function TodayPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { activeBlock, loading: blockLoading } = useBlockClock(userId);

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

  // Active block takes precedence
  if (activeBlock) {
    return <BlockLiveView block={activeBlock} userId={userId} />;
  }

  // Otherwise: picker or committed
  return (
    <>
      {phase === "picker" && (
        <CommitPicker userId={userId} onCommitted={() => setReloadKey((k) => k + 1)} />
      )}
      {phase === "committed" && (
        <CommittedList userId={userId} onOpenSchedule={() => setScheduleOpen(true)} />
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
