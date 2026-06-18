import { useEffect, useRef } from "react";

/**
 * Hook: show browser notification + play sound when a new chat message arrives
 * while the tab is not focused. Also flashes the document.title with an
 * unread counter.
 */
export function useBrowserNotifications({
  unreadCount,
  title = "Lead Vault",
  onNewMessage,
}: {
  unreadCount: number;
  title?: string;
  onNewMessage?: { title: string; body: string; conversationId?: string } | null;
}) {
  const lastSig = useRef<string | null>(null);

  // Request permission once (after a user click ideally; this just nudges)
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      // Defer to next click: don't auto-prompt aggressively
      const onClick = () => {
        if (Notification.permission === "default") {
          void Notification.requestPermission();
        }
        window.removeEventListener("click", onClick);
      };
      window.addEventListener("click", onClick, { once: true });
      return () => window.removeEventListener("click", onClick);
    }
  }, []);

  // Title flashing
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = unreadCount > 0 ? `(${unreadCount}) ${title}` : title;
  }, [unreadCount, title]);

  // Show notification
  useEffect(() => {
    if (!onNewMessage) return;
    const sig = `${onNewMessage.conversationId ?? ""}|${onNewMessage.title}|${onNewMessage.body}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const n = new Notification(onNewMessage.title, {
        body: onNewMessage.body,
        tag: onNewMessage.conversationId,
        silent: false,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // ignore
    }
  }, [onNewMessage]);
}
