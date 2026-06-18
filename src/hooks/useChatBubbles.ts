import { useSyncExternalStore } from "react";

export type ComposeMode = "dm" | "group" | "channel";

type State = {
  bubbles: string[];
  activeId: string | null;
  compose: ComposeMode | null;
  hiddenTeammates: string[];
};

const STORAGE_KEY = "chat.bubbles.v1";
const MAX_BUBBLES = 6;

function loadInitial(): State {
  if (typeof window === "undefined") {
    return { bubbles: [], activeId: null, compose: null, hiddenTeammates: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { bubbles?: unknown; hiddenTeammates?: unknown };
      const bubbles = Array.isArray(parsed.bubbles)
        ? (parsed.bubbles.filter((x) => typeof x === "string") as string[])
        : [];
      const hiddenTeammates = Array.isArray(parsed.hiddenTeammates)
        ? (parsed.hiddenTeammates.filter((x) => typeof x === "string") as string[])
        : [];
      return { bubbles: bubbles.slice(0, MAX_BUBBLES), activeId: null, compose: null, hiddenTeammates };
    }
  } catch {
    // ignore
  }
  return { bubbles: [], activeId: null, compose: null, hiddenTeammates: [] };
}

let state: State = loadInitial();
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ bubbles: state.bubbles, hiddenTeammates: state.hiddenTeammates }),
    );
  } catch {
    // ignore
  }
}

function set(next: State) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return state;
}

function getServerSnapshot(): State {
  return { bubbles: [], activeId: null, compose: null, hiddenTeammates: [] };
}

export const chatBubbles = {
  openBubble(id: string, opts?: { unhideUserId?: string }) {
    const without = state.bubbles.filter((b) => b !== id);
    const next = [id, ...without].slice(0, MAX_BUBBLES);
    const hiddenTeammates = opts?.unhideUserId
      ? state.hiddenTeammates.filter((x) => x !== opts.unhideUserId)
      : state.hiddenTeammates;
    set({ ...state, bubbles: next, activeId: id, compose: null, hiddenTeammates });
  },
  closeBubble(id: string) {
    set({
      ...state,
      bubbles: state.bubbles.filter((b) => b !== id),
      activeId: state.activeId === id ? null : state.activeId,
    });
  },
  setActive(id: string | null) {
    set({ ...state, activeId: id, compose: id ? null : state.compose });
  },
  openCompose(mode: ComposeMode = "dm") {
    set({ ...state, compose: mode, activeId: null });
  },
  closeCompose() {
    set({ ...state, compose: null });
  },
  clear() {
    set({ bubbles: [], activeId: null, compose: null, hiddenTeammates: state.hiddenTeammates });
  },
  hideTeammate(id: string) {
    if (state.hiddenTeammates.includes(id)) return;
    set({ ...state, hiddenTeammates: [...state.hiddenTeammates, id] });
  },
  showTeammate(id: string) {
    set({ ...state, hiddenTeammates: state.hiddenTeammates.filter((x) => x !== id) });
  },
  clearHidden() {
    set({ ...state, hiddenTeammates: [] });
  },
};

export function useChatBubbles() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}