import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIdleThresholdMinutes, setIdleAuto } from "@/lib/admin.functions";

/**
 * Client-side inactivity detector. After `threshold` minutes of no
 * mouse/keyboard/touch/scroll activity (or while the tab is hidden), marks
 * the current user as idle. Any activity (or tab returning to visible)
 * clears the idle status.
 *
 * Mount once per authenticated session. No-op when `enabled` is false.
 */
export function useIdleAutoStatus(enabled: boolean) {
  const setIdle = useServerFn(setIdleAuto);
  const fetchThreshold = useServerFn(getIdleThresholdMinutes);
  const qc = useQueryClient();

  const { data: thresholdMinutes } = useQuery({
    queryKey: ["presence", "idle_threshold_minutes"],
    queryFn: () => fetchThreshold(),
    enabled,
    staleTime: 5 * 60_000,
  });

  const isIdleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const minutes = thresholdMinutes ?? 7;
    const ms = Math.max(1, minutes) * 60_000;

    const markIdle = async () => {
      if (isIdleRef.current) return;
      isIdleRef.current = true;
      try {
        await setIdle({ data: { idle: true } });
        qc.invalidateQueries({ queryKey: ["team_presence"] });
      } catch {
        // best-effort; will retry on next idle cycle
      }
    };

    const markActive = async () => {
      if (!isIdleRef.current) return;
      isIdleRef.current = false;
      try {
        await setIdle({ data: { idle: false } });
        qc.invalidateQueries({ queryKey: ["team_presence"] });
      } catch {
        // ignore
      }
    };

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(markIdle, ms);
      if (isIdleRef.current) void markActive();
    };

    const onActivity = () => reset();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (timerRef.current) clearTimeout(timerRef.current);
        void markIdle();
      } else {
        reset();
      }
    };

    const events: (keyof DocumentEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "click",
      "scroll",
      "touchstart",
      "wheel",
    ];
    for (const e of events) document.addEventListener(e, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onActivity);
    window.addEventListener("blur", onVisibility);

    reset();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const e of events) document.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onActivity);
      window.removeEventListener("blur", onVisibility);
    };
  }, [enabled, thresholdMinutes, setIdle, qc]);
}