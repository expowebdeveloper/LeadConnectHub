import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { heartbeatActive, getImpersonationTarget } from "@/lib/admin.functions";

export type AppRole = "admin" | "sales" | "vendor" | "telemarketer" | "pending";

export interface AppProfile {
  id: string;
  parent_vendor_id: string | null;
  company_name: string | null;
  full_name: string | null;
  avatar_url?: string | null;
  frozen: boolean;
  frozen_reason: string | null;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  profile: AppProfile | null;
  isSubAgent: boolean;
  loading: boolean;
  refreshRoles: () => Promise<void>;
  signOut: () => Promise<void>;
  // Admin "view-as" impersonation
  realUser: User | null;
  realRoles: AppRole[];
  isImpersonating: boolean;
  impersonatedEmail: string | null;
  startImpersonation: (userId: string) => Promise<void>;
  stopImpersonation: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const AUTH_POP_OUT_REQUEST = "leadvault:popout-auth-request";
const AUTH_POP_OUT_RESPONSE = "leadvault:popout-auth-response";

type SessionTransferPayload = {
  accessToken: string;
  refreshToken: string;
};

async function fetchRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error || !data) return [];
  return data.map((r) => r.role as AppRole);
}

async function fetchProfile(userId: string): Promise<AppProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, parent_vendor_id, company_name, full_name, avatar_url, frozen, frozen_reason")
    .eq("id", userId)
    .maybeSingle();
  return (data as AppProfile) ?? null;
}

function shouldAttemptPopoutSessionTransfer() {
  if (typeof window === "undefined" || !window.opener) return false;
  return new URLSearchParams(window.location.search).get("popout") === "1";
}

async function requestSessionFromOpener(timeoutMs = 1500): Promise<SessionTransferPayload | null> {
  if (!shouldAttemptPopoutSessionTransfer()) return null;

  return new Promise((resolve) => {
    let settled = false;

    const settle = (value: SessionTransferPayload | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeoutId);
      resolve(value);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.opener) return;

      const data = event.data;
      if (!data || data.type !== AUTH_POP_OUT_RESPONSE) return;

      const payload = data.payload;
      if (
        payload &&
        typeof payload.accessToken === "string" &&
        typeof payload.refreshToken === "string"
      ) {
        settle(payload);
        return;
      }

      settle(null);
    };

    const timeoutId = window.setTimeout(() => settle(null), timeoutMs);
    window.addEventListener("message", onMessage);

    try {
      window.opener.postMessage({ type: AUTH_POP_OUT_REQUEST }, window.location.origin);
    } catch {
      settle(null);
    }
  });
}

function getStoredValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function removeStoredValue(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState<{
    user: User;
    roles: AppRole[];
    profile: AppProfile;
    email: string;
  } | null>(null);

  useEffect(() => {
    const hydrateUserState = async (nextSession: Session | null) => {
      setSession(nextSession);

      if (!nextSession?.user) {
        setRoles([]);
        setProfile(null);
        return;
      }

      const [nextRoles, nextProfile] = await Promise.all([
        fetchRoles(nextSession.user.id),
        fetchProfile(nextSession.user.id),
      ]);
      setRoles(nextRoles);
      setProfile(nextProfile);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        // Defer to avoid deadlock with auth callback
        setTimeout(() => {
          fetchRoles(newSession.user.id).then(setRoles);
          fetchProfile(newSession.user.id).then(setProfile);
        }, 0);
      } else {
        setRoles([]);
        setProfile(null);
      }
    });

    void (async () => {
      const { data } = await supabase.auth.getSession();

      if (data.session?.user) {
        await hydrateUserState(data.session);
        setLoading(false);
        return;
      }

      const transferredSession = await requestSessionFromOpener();
      if (transferredSession) {
        const { data: restored } = await supabase.auth.setSession({
          access_token: transferredSession.accessToken,
          refresh_token: transferredSession.refreshToken,
        });
        await hydrateUserState(restored.session ?? null);
        setLoading(false);
        return;
      }

      await hydrateUserState(null);
      setLoading(false);
    })();

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== AUTH_POP_OUT_REQUEST || !event.source) return;

      void (async () => {
        const { data } = await supabase.auth.getSession();
        const currentSession = data.session;

        (event.source as WindowProxy).postMessage(
          {
            type: AUTH_POP_OUT_RESPONSE,
            payload:
              currentSession?.access_token && currentSession.refresh_token
                ? {
                    accessToken: currentSession.access_token,
                    refreshToken: currentSession.refresh_token,
                  }
                : null,
          },
          window.location.origin,
        );
      })();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Restore impersonation from localStorage when the real admin user is loaded.
  useEffect(() => {
    if (!session?.user) {
      setImpersonation(null);
      return;
    }
    const isAdmin = roles.includes("admin");
    if (!isAdmin) {
      setImpersonation(null);
      removeStoredValue("impersonate_user_id");
      return;
    }
    const stored = getStoredValue("impersonate_user_id");
    if (!stored || impersonation?.user.id === stored) return;
    getImpersonationTarget({ data: { target_user_id: stored } })
      .then((res) => {
        setImpersonation({
          user: { id: res.profile.id, email: res.profile.email ?? "" } as User,
          roles: res.roles as AppRole[],
          profile: {
            id: res.profile.id,
            parent_vendor_id: res.profile.parent_vendor_id,
            company_name: res.profile.company_name,
            full_name: res.profile.full_name,
            avatar_url: res.profile.avatar_url,
            frozen: !!res.profile.frozen,
            frozen_reason: res.profile.frozen_reason,
          },
          email: res.profile.email ?? "",
        });
      })
      .catch(() => {
        removeStoredValue("impersonate_user_id");
      });
  }, [session?.user?.id, roles.join("|")]);

  // Heartbeat: mark current user as active every 2 minutes (and once on sign-in).
  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    const ping = () => {
      heartbeatActive().catch(() => {});
    };
    ping();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(ping, 2 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session?.user?.id]);

  const value: AuthState = {
    session,
    user: impersonation ? impersonation.user : (session?.user ?? null),
    roles: impersonation ? impersonation.roles : roles,
    profile: impersonation ? impersonation.profile : profile,
    isSubAgent: impersonation
      ? !!impersonation.profile.parent_vendor_id
      : !!profile?.parent_vendor_id,
    loading,
    realUser: session?.user ?? null,
    realRoles: roles,
    isImpersonating: !!impersonation,
    impersonatedEmail: impersonation?.email ?? null,
    startImpersonation: async (userId: string) => {
      const res = await getImpersonationTarget({ data: { target_user_id: userId } });
      setImpersonation({
        user: { id: res.profile.id, email: res.profile.email ?? "" } as User,
        roles: res.roles as AppRole[],
        profile: {
          id: res.profile.id,
          parent_vendor_id: res.profile.parent_vendor_id,
          company_name: res.profile.company_name,
          full_name: res.profile.full_name,
          avatar_url: res.profile.avatar_url,
          frozen: !!res.profile.frozen,
          frozen_reason: res.profile.frozen_reason,
        },
        email: res.profile.email ?? "",
      });
      setStoredValue("impersonate_user_id", userId);
    },
    stopImpersonation: () => {
      setImpersonation(null);
      removeStoredValue("impersonate_user_id");
    },
    refreshRoles: async () => {
      if (session?.user) {
        setRoles(await fetchRoles(session.user.id));
        setProfile(await fetchProfile(session.user.id));
      }
    },
    signOut: async () => {
      setImpersonation(null);
      removeStoredValue("impersonate_user_id");
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useHasRole(...allowed: AppRole[]) {
  const { roles } = useAuth();
  return roles.some((r) => allowed.includes(r));
}
