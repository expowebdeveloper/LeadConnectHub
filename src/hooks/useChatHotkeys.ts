import { useEffect } from "react";

export function useChatHotkeys(opts: {
  onSearch?: () => void;
  onNew?: () => void;
  onEscape?: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && /^(INPUT|TEXTAREA)$/.test(target.tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opts.onSearch?.();
        return;
      }
      if (mod && e.key.toLowerCase() === "n" && !inField) {
        e.preventDefault();
        opts.onNew?.();
        return;
      }
      if (e.key === "Escape") {
        opts.onEscape?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [opts]);
}