"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateKey, isWithinTimeRange } from "@/lib/utils/date";
import type { Block } from "@/lib/db/types";

// Detects whether the current user has an active block right now (one I own or
// am invited to, scheduled today, with current time inside [start_time, end_time]).
// Polls every 30s and subscribes to realtime block_invites updates so a freshly
// scheduled or accepted invite shows up immediately.
export function useBlockClock(userId: string | null): { activeBlock: Block | null; loading: boolean } {
  const [activeBlock, setActiveBlock] = useState<Block | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    const supabase = createClient();
    let cancelled = false;

    async function check() {
      const today = dateKey(new Date());
      // Own blocks for today
      const { data: ownBlocks } = await supabase
        .from("blocks")
        .select("*")
        .eq("user_id", userId)
        .eq("date", today);

      // Blocks I'm invited to today (joined or invited)
      const { data: invites } = await supabase
        .from("block_invites")
        .select("block_id, status")
        .eq("invited_user_id", userId)
        .in("status", ["invited", "joined"]);

      const invitedBlockIds = (invites ?? []).map((i) => i.block_id as string);
      let invitedBlocks: Block[] = [];
      if (invitedBlockIds.length > 0) {
        const { data } = await supabase
          .from("blocks")
          .select("*")
          .in("id", invitedBlockIds)
          .eq("date", today);
        invitedBlocks = (data ?? []) as Block[];
      }

      const all: Block[] = [...((ownBlocks ?? []) as Block[]), ...invitedBlocks];

      const live = all.find((b) =>
        b.start_time !== null &&
        b.end_time !== null &&
        isWithinTimeRange(b.start_time, b.end_time)
      ) ?? null;

      if (!cancelled) {
        setActiveBlock(live);
        setLoading(false);
      }
    }

    check();
    const interval = setInterval(check, 30_000);

    // Realtime: re-check when blocks or block_invites change for this user
    const channel = supabase
      .channel(`block-clock-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks", filter: `user_id=eq.${userId}` }, check)
      .on("postgres_changes", { event: "*", schema: "public", table: "block_invites", filter: `invited_user_id=eq.${userId}` }, check)
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return { activeBlock, loading };
}
