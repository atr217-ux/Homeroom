"use client";

import { useEffect, useState } from "react";

// True on hover-capable + fine-pointer devices (laptops, desktops with mouse).
// False on phones/tablets where swipe gestures are the primary interaction.
export function useHasHover(): boolean {
  const [hasHover, setHasHover] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    setHasHover(mq.matches);
    const handler = (e: MediaQueryListEvent) => setHasHover(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return hasHover;
}
