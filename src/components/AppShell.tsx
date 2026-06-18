import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth, useHasRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, ClipboardList, ClipboardCheck, PlusCircle, Users, BarChart3, ListChecks, CalendarDays, Settings as SettingsIcon, UserPlus, AlertOctagon, Menu, PhoneCall, Target, Search, ChevronDown, UserCheck, X, Bell, Activity, Radio, Coffee, Utensils, BellOff, Circle, CircleDot, Check, MessageSquare, Sparkles, Gauge } from "lucide-react";
import { ROLE_LABELS } from "@/lib/constants";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { listUsers, setMyStatus, type ManualStatus } from "@/lib/admin.functions";
import { AgentAvatar } from "@/components/AgentAvatar";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TeamPresenceStrip } from "@/components/TeamPresenceStrip";

const MANUAL_STATUS_OPTIONS: Array<{
  value: ManualStatus | null;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  dot: string;
  minutes?: number;
}> = [
  { value: "available", label: "Available", Icon: CircleDot, dot: "bg-emerald-500" },
  { value: "lunch", label: "Lunch", Icon: Utensils, dot: "bg-amber-400", minutes: 60 },
  { value: "break", label: "Break", Icon: Coffee, dot: "bg-amber-400", minutes: 15 },
  { value: "meeting", label: "Meeting", Icon: Users, dot: "bg-sky-400", minutes: 60 },
  { value: "dnd", label: "Do not disturb", Icon: BellOff, dot: "bg-rose-500" },
  { value: "offline", label: "Offline", Icon: Circle, dot: "bg-muted-foreground" },
];

function StatusSubMenu({
  current,
  onPick,
}: {
  current: ManualStatus | null;
  onPick: (s: ManualStatus | null) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${MANUAL_STATUS_OPTIONS.find((o) => o.value === current)?.dot ?? "bg-muted"}`} />
        Set status: {MANUAL_STATUS_OPTIONS.find((o) => o.value === current)?.label ?? "Auto"}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-56">
          <DropdownMenuItem onSelect={() => onPick(null)}>
            <Check className={`mr-2 h-3.5 w-3.5 ${current === null ? "opacity-100" : "opacity-0"}`} />
            Clear (auto)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {MANUAL_STATUS_OPTIONS.map((o) => (
            <DropdownMenuItem key={o.value ?? "none"} onSelect={() => onPick(o.value)}>
              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${o.dot}`} />
              <o.Icon className="mr-2 h-3.5 w-3.5" />
              {o.label}
              {current === o.value && <Check className="ml-auto h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function useMyManualStatus(userId: string | undefined) {
  return useQuery({
    queryKey: ["my_manual_status", userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from("profiles")
        .select("manual_status, manual_status_until")
        .eq("id", userId)
        .maybeSingle();
      const until = data?.manual_status_until ? new Date(data.manual_status_until).getTime() : 0;
      if (until && until <= Date.now()) return null;
      return (data?.manual_status as ManualStatus | null) ?? null;
    },
    refetchInterval: 60_000,
  });
}

export function AppShell({ children, fullBleed = false }: { children: React.ReactNode; fullBleed?: boolean }) {
  const {
    user,
    roles,
    signOut,
    isSubAgent,
    profile,
    isImpersonating,
    realUser,
    realRoles,
    startImpersonation,
    stopImpersonation,
  } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isAdmin = useHasRole("admin");
  const realIsAdmin = realRoles.includes("admin");
  const isVendor = useHasRole("vendor");
  const isSales = useHasRole("sales", "admin");
  const isTelemarketer = useHasRole("telemarketer");
  const isTelemarketerOnly = isTelemarketer && !isAdmin && !isSales && !isVendor;
  // Vendor "owners" can manage sub-agents. Sub-agents themselves cannot.
  const canManageTeam = isVendor && !isSubAgent;
  // Sub-agents do NOT see analytics (their vendor owner's revenue is private).
  const canSeeAnalytics = !isSubAgent && !isTelemarketerOnly;
  const [mobileOpen, setMobileOpen] = useState(false);
  const qc = useQueryClient();
  const myStatusQ = useMyManualStatus(user?.id);
  const canSetStatus = isSales || isTelemarketer;

  const updateStatus = async (s: ManualStatus | null) => {
    const opt = MANUAL_STATUS_OPTIONS.find((o) => o.value === s);
    try {
      await setMyStatus({ data: { status: s, minutes: opt?.minutes } });
      qc.invalidateQueries({ queryKey: ["my_manual_status", user?.id] });
      qc.invalidateQueries({ queryKey: ["team_presence"] });
      toast.success(s ? `Status set to ${opt?.label}` : "Status cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth" });
  };

  const isFrozen = !!profile?.frozen && !isAdmin;

  const navItem = (
    to: string,
    label: string,
    Icon: React.ComponentType<{ className?: string }>,
    variant: "desktop" | "mobile" = "desktop",
  ) => {
    const isActive = path === to;
    const handleClick = (e: React.MouseEvent) => {
      setMobileOpen(false);
      if (to === "/team-chat") {
        e.preventDefault();
        void navigate({ to: "/team-chat", search: {} });
      }
    };

    if (variant === "mobile") {
      return (
        <Link
          key={to}
          to={to}
          onClick={handleClick}
          className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors ${
            isActive
              ? "text-sidebar-primary"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          }`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      );
    }

    return (
      <Link
        key={to}
        to={to}
        onClick={handleClick}
        aria-current={isActive ? "page" : undefined}
        className={
          isActive
            ? "flex items-center gap-3 rounded-lg border border-leadvault-tab-accent/25 bg-leadvault-tab-accent/10 px-3 py-2 text-[13.5px] font-semibold text-leadvault-tab-accent shadow-sm [@media(max-height:760px)]:py-1.5 [@media(max-height:680px)]:gap-2 [@media(max-height:680px)]:py-1"
            : "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-leadvault-nav-muted transition-colors hover:bg-leadvault-nav-hover-bg hover:text-leadvault-nav-hover [@media(max-height:760px)]:py-1.5 [@media(max-height:680px)]:gap-2 [@media(max-height:680px)]:py-1"
        }
      >
        <Icon
          className={
            isActive
              ? "h-4 w-4 text-leadvault-tab-accent"
              : "h-4 w-4 text-leadvault-nav-muted/70 group-hover:text-leadvault-tab-accent"
          }
        />
        {label}
      </Link>
    );
  };

  const navLinks = (
    <>
      {isTelemarketerOnly ? (
        <>
          {navItem("/call-queue", "Call Queue", PhoneCall)}
          {navItem("/follow-ups", "Calendar", CalendarDays)}
          {navItem("/telemarketer", "My Performance", Target)}
          {navItem("/team-chat", "Chat", MessageSquare)}
        </>
      ) : (
        <>
          {navItem("/liveleads", "Live Leads", Radio)}
          {!isVendor && navItem("/shark-tank", "Shark Tank", SwooshIcon)}
          {isSales && navItem("/my-leads", "My Leads", ClipboardCheck)}
          {isSales && navItem("/follow-ups", "Calendar", CalendarDays)}
          
          {isTelemarketer && navItem("/call-queue", "Call Queue", PhoneCall)}
          {isVendor && navItem("/leads/new", "New Lead", PlusCircle)}
          {navItem("/team-chat", "Chat", MessageSquare)}
          {canSeeAnalytics && navItem("/analytics", "Performance", BarChart3)}
          {canSeeAnalytics && navItem("/insights", "Insights", Gauge)}
          {canManageTeam && navItem("/team-agents", "Team Agents", UserPlus)}
          {isAdmin && navItem("/admin", "Users", Users)}
          {isAdmin && navItem("/admin/scoring", "Scoring", Gauge)}
          {isAdmin && navItem("/ai", "AI", Sparkles)}
        </>
      )}
    </>
  );

  const mobileNavLinks = (
    <>
      {isTelemarketerOnly ? (
        <>
          {navItem("/call-queue", "Call Queue", PhoneCall, "mobile")}
          {navItem("/follow-ups", "Calendar", CalendarDays, "mobile")}
          {navItem("/telemarketer", "My Performance", Target, "mobile")}
          {navItem("/team-chat", "Chat", MessageSquare, "mobile")}
        </>
      ) : (
        <>
          {navItem("/liveleads", "Live Leads", Radio, "mobile")}
          {!isVendor && navItem("/shark-tank", "Shark Tank", SwooshIcon, "mobile")}
          {isSales && navItem("/my-leads", "My Leads", ClipboardCheck, "mobile")}
          {isSales && navItem("/follow-ups", "Calendar", CalendarDays, "mobile")}
          {isTelemarketer && navItem("/call-queue", "Call Queue", PhoneCall, "mobile")}
          {isVendor && navItem("/leads/new", "New Lead", PlusCircle, "mobile")}
          {navItem("/team-chat", "Chat", MessageSquare, "mobile")}
          {canSeeAnalytics && navItem("/analytics", "Performance", BarChart3, "mobile")}
          {canSeeAnalytics && navItem("/insights", "Insights", Gauge, "mobile")}
          {canManageTeam && navItem("/team-agents", "Team Agents", UserPlus, "mobile")}
          {isAdmin && navItem("/admin", "Users", Users, "mobile")}
          {isAdmin && navItem("/admin/scoring", "Scoring", Gauge, "mobile")}
          {isAdmin && navItem("/ai", "AI", Sparkles, "mobile")}
        </>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-leadvault-page-surface">
      {isImpersonating && (
        <div className="bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-3">
          <UserCheck className="h-4 w-4" />
          Viewing as {user?.email}
          <Button
            size="sm"
            variant="secondary"
            className="h-7"
            onClick={() => {
              stopImpersonation();
              navigate({ to: "/" });
            }}
          >
            <X className="h-3 w-3" /> Exit view-as
          </Button>
        </div>
      )}
      <div className="flex min-h-screen w-full">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 z-40 hidden h-screen w-40 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
          <Link to="/" className="flex h-16 items-center gap-2.5 px-3 text-[16px] font-semibold tracking-tight [@media(max-height:760px)]:h-14 [@media(max-height:680px)]:h-12">
            <Shield className="h-7 w-7 text-leadvault-tab-accent" />
            <span className="text-base font-bold tracking-tight text-sidebar-foreground">LeadVault</span>
          </Link>
          <nav className="shrink-0 space-y-1 px-3 py-4 [@media(max-height:760px)]:py-2 [@media(max-height:680px)]:space-y-0.5 [@media(max-height:680px)]:py-1">{navLinks}</nav>
          <div className="relative mt-auto flex min-h-0 w-auto flex-1 items-stretch overflow-visible">
            <TeamPresenceStrip />
          </div>
        </aside>

        {/* Main column — reserve right gutter for the fixed presence/chat rail */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-sidebar-border bg-leadvault-header px-4 md:h-16 md:px-5">
            {/* Mobile menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent/60"
                  aria-label="Open menu"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-sidebar text-sidebar-foreground">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
                    <Shield className="h-5 w-5 text-leadvault-tab-accent" />
                    LeadVault
                  </SheetTitle>
                </SheetHeader>
                <nav className="mt-4 flex flex-col gap-1">{mobileNavLinks}</nav>
                <div className="mt-6 border-t border-sidebar-border pt-4 text-sm">
                  <div className="text-xs text-sidebar-foreground/60">
                    {roles.map((r) => ROLE_LABELS[r]).join(" · ") || "No role"}
                  </div>
                  <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={handleSignOut}>
                    <LogOut className="h-4 w-4" /> Sign out
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full justify-start"
                    onClick={() => {
                      setMobileOpen(false);
                      navigate({ to: "/settings" });
                    }}
                  >
                    <SettingsIcon className="h-4 w-4" /> Settings
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            <Link
              to="/"
              className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-sidebar-foreground md:hidden"
            >
              <Shield className="h-5 w-5 text-leadvault-tab-accent" />
              <span>LeadVault</span>
            </Link>

            <div className="flex-1 min-w-0">
              <div className="mx-auto max-w-xl">
                <GlobalSearch />
              </div>
            </div>

            <div className="flex items-center gap-2 md:gap-4 text-sm">
              {realIsAdmin ? (
                <ImpersonationDropdown
                  currentEmail={user?.email ?? ""}
                  rolesLabel={roles.map((r) => ROLE_LABELS[r]).join(" · ") || "No role"}
                  isImpersonating={isImpersonating}
                  realEmail={realUser?.email ?? ""}
                  avatarName={profile?.full_name ?? user?.email ?? ""}
                  avatarPath={profile?.avatar_url ?? null}
                  onPick={async (id) => {
                    try {
                      await startImpersonation(id);
                      navigate({ to: "/" });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed to switch user");
                    }
                  }}
                  onStop={() => {
                    stopImpersonation();
                    navigate({ to: "/" });
                  }}
                  onSignOut={handleSignOut}
                />
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center justify-center rounded-full p-0 leading-none hover:bg-sidebar-accent/60 transition-colors"
                      aria-label={profile?.full_name || user?.email || "Account"}
                      title={profile?.full_name || user?.email || "Account"}
                    >
                      <AgentAvatar
                        name={profile?.full_name ?? user?.email}
                        path={profile?.avatar_url}
                        size="md"
                        className="ring-2 ring-card"
                        status={myStatusQ.data ?? undefined}
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="font-normal">
                      <div className="font-medium">{profile?.full_name || user?.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {roles.map((r) => ROLE_LABELS[r]).join(" · ") || "No role"}
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {canSetStatus && (
                      <>
                        <StatusSubMenu current={myStatusQ.data ?? null} onPick={updateStatus} />
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
                      <SettingsIcon className="h-4 w-4 mr-2" />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleSignOut}>
                      <LogOut className="h-4 w-4 mr-2" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>

          <main
            className={
              fullBleed
                ? "flex-1 bg-leadvault-page-surface"
                : "flex-1 bg-leadvault-page-surface px-4 py-5 md:px-5 md:pt-6 md:pb-6"
            }
          >
            <div className={fullBleed ? "" : "w-full"}>
              {isFrozen ? (
                <div
                  role="alert"
                  className="rounded-lg border-4 border-destructive bg-destructive p-8 text-destructive-foreground shadow-lg animate-pulse"
                >
                  <div className="flex items-start gap-4">
                    <AlertOctagon className="h-16 w-16 shrink-0" />
                    <div className="space-y-3">
                      <h2 className="text-4xl font-extrabold uppercase tracking-wide">
                        ⚠ Account Frozen — Do Not Transfer This Call
                      </h2>
                      <p className="text-xl font-semibold">
                        This account has been locked because a TCPA litigator number was submitted.
                      </p>
                      <p className="text-lg font-bold uppercase">
                        End the call immediately. Do NOT transfer.
                      </p>
                      {profile?.frozen_reason && (
                        <p className="text-sm opacity-90">{profile.frozen_reason}</p>
                      )}
                      <p className="pt-2 text-sm">
                        Your account is suspended until an administrator unlocks it. Please contact an admin.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                children
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action, center }: { title: React.ReactNode; description?: string; action?: React.ReactNode; center?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-2 md:mb-4 md:flex-row md:items-center md:gap-4">
      <div className="md:flex-1 md:min-w-0">
        <h1 className="text-base font-semibold tracking-tight text-foreground md:text-lg">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {center && (
        <div className="flex justify-center md:flex-1 md:min-w-0">{center}</div>
      )}
      {action && <div className="flex flex-wrap items-center gap-2 md:flex-1 md:justify-end md:min-w-0">{action}</div>}
    </div>
  );
}

/**
 * Branded hero title used by Shark Tank, Live Leads, My Leads, Calendar, and Performance.
 * Renders the swoosh mark + uppercase wordmark to match the Shark Tank header treatment.
 * Pass an `icon` prop to replace the swoosh with a page-specific Lucide icon.
 */
export function HeroTitle({ label, icon: Icon }: { label: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <span className="inline-flex items-center gap-2">
      {Icon ? (
        <Icon className="h-6 w-6 text-primary md:h-7 md:w-7" />
      ) : (
        <SwooshIcon className="h-6 w-6 text-primary md:h-7 md:w-7" />
      )}
      <span className="text-xl font-extrabold uppercase tracking-tight text-primary md:text-2xl">
        {label}
      </span>
    </span>
  );
}

export function SwooshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="currentColor"
      aria-hidden
    >
      <path d="M4 54 C 22 50 38 38 50 10 C 50 32 46 46 38 54 Z" />
    </svg>
  );
}

function ImpersonationDropdown({
  currentEmail,
  rolesLabel,
  isImpersonating,
  realEmail,
  avatarName,
  avatarPath,
  onPick,
  onStop,
  onSignOut,
}: {
  currentEmail: string;
  rolesLabel: string;
  isImpersonating: boolean;
  realEmail: string;
  avatarName: string;
  avatarPath: string | null;
  onPick: (id: string) => Promise<void> | void;
  onStop: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const [users, setUsers] = useState<Array<{ id: string; email: string | null; full_name: string | null; roles: string[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || users.length > 0) return;
    setLoading(true);
    listUsers()
      .then((res) => {
        setUsers(
          (res as Array<{ id: string; email: string | null; full_name: string | null; roles: string[] }>)
            .filter((u) => !u.roles.includes("admin") || true),
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, users.length]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? users.filter(
        (u) =>
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.full_name ?? "").toLowerCase().includes(q),
      )
    : users;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center rounded-full p-0.5 leading-none hover:bg-sidebar-accent/60 transition-colors"
          aria-label={avatarName || currentEmail}
          title={avatarName || currentEmail}
        >
          <AgentAvatar name={avatarName || currentEmail} path={avatarPath} size="md" className="ring-2 ring-card" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="font-normal">
          <div className="font-medium">{currentEmail}</div>
          <div className="text-xs text-muted-foreground">{rolesLabel}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>View as user</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isImpersonating && (
          <>
            <DropdownMenuItem onSelect={() => onStop()}>
              <X className="h-4 w-4" />
              <span>Stop — back to {realEmail}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <div className="p-2">
          <Input
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-8"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {loading && (
            <div className="px-3 py-4 text-sm text-muted-foreground">Loading…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">No users.</div>
          )}
          {filtered.map((u) => (
            <DropdownMenuItem
              key={u.id}
              onSelect={() => {
                setOpen(false);
                void onPick(u.id);
              }}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-medium">{u.full_name || u.email || "Unnamed"}</span>
              <span className="text-xs text-muted-foreground">
                {u.email} · {u.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "No role"}
              </span>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
          <SettingsIcon className="h-4 w-4" />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}