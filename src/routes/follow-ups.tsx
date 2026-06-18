import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { ChevronLeft, ChevronRight, Shield, LayoutGrid, CalendarDays, Phone } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { AppShell, PageHeader, HeroTitle } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyCTA } from "@/components/EmptyCTA";
import { cn } from "@/lib/utils";
import type { Dispo } from "@/lib/constants";

type FollowUpLead = {
  id: string;
  source: "leads" | "list_leads";
  kind: "follow_up" | "x_date";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  current_carrier: string | null;
  dispo: Dispo | null;
  // ISO datetime for follow-ups; midnight local for x-dates.
  follow_up_at: string;
};

type CalView = "day" | "week" | "month";

export const Route = createFileRoute("/follow-ups")({
  head: () => ({
    meta: [
      { title: "My Calendar — LeadVault" },
      {
        name: "description",
        content: "Day, week, and month views of your scheduled lead follow-ups.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    view: (s.view === "day" || s.view === "week" || s.view === "month")
      ? (s.view as CalView)
      : undefined,
    date: typeof s.date === "string" ? s.date : undefined,
  }),
  component: FollowUpsPage,
});

function FollowUpsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const isSales = useHasRole("sales", "admin");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Shield className="h-8 w-8 animate-pulse text-primary" />
      </div>
    );
  }

  return (
    <AppShell>
      {isSales ? (
        <FollowUpsCalendar uid={user.id} />
      ) : (
        <Card className="mx-auto max-w-2xl">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Follow-ups are only available to sales agents.
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}

function FollowUpsCalendar({ uid }: { uid: string }) {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const view: CalView = search.view ?? "month";
  const cursor = useMemo(
    () => (search.date ? parseLocalYmd(search.date) : startOfDay(new Date())),
    [search.date],
  );

  const setView = (v: CalView) =>
    navigate({ to: "/follow-ups", search: { view: v, date: format(cursor, "yyyy-MM-dd") } });
  const setCursor = (d: Date) =>
    navigate({
      to: "/follow-ups",
      search: { view, date: format(startOfDay(d), "yyyy-MM-dd") },
    });

  // Leads shared with this user — we want their follow-ups / x-dates to
  // appear on the calendar even when the viewer is not the claimer.
  const sharedIdsQ = useQuery({
    queryKey: ["follow-ups-shared-ids", uid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_shares")
        .select("lead_id, lead_table")
        .eq("shared_with", uid);
      if (error) throw error;
      const leads: string[] = [];
      const list: string[] = [];
      for (const r of data ?? []) {
        if (r.lead_table === "leads") leads.push(r.lead_id as string);
        else if (r.lead_table === "list_leads") list.push(r.lead_id as string);
      }
      return { leads, list };
    },
  });
  const sharedLeadIds = sharedIdsQ.data?.leads ?? [];
  const sharedListIds = sharedIdsQ.data?.list ?? [];
  // PostgREST `id.in.()` requires at least one value; use an impossible UUID
  // as a placeholder when the set is empty so the OR clause stays valid.
  const NONE = "00000000-0000-0000-0000-000000000000";
  const leadsIdIn = (sharedLeadIds.length ? sharedLeadIds : [NONE]).join(",");
  const listIdIn = (sharedListIds.length ? sharedListIds : [NONE]).join(",");
  const sharedReady = sharedIdsQ.isSuccess;

  const liveQ = useQuery({
    queryKey: ["follow-ups-live", uid, leadsIdIn],
    enabled: sharedReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, current_carrier, dispo, follow_up_at")
        .or(`claimed_by.eq.${uid},agent_id.eq.${uid},id.in.(${leadsIdIn})`)
        .is("archived_at", null)
        .eq("dispo", "follow_up")
        .not("follow_up_at", "is", null);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        source: "leads" as const,
        kind: "follow_up" as const,
      })) as FollowUpLead[];
    },
  });

  const listQ = useQuery({
    queryKey: ["follow-ups-list", uid, listIdIn],
    enabled: sharedReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("list_leads")
        .select("id, first_name, last_name, phone, current_carrier, dispo, follow_up_at")
        .or(`claimed_by.eq.${uid},agent_id.eq.${uid},id.in.(${listIdIn})`)
        .eq("dispo", "follow_up")
        .not("follow_up_at", "is", null);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        source: "list_leads" as const,
        kind: "follow_up" as const,
      })) as FollowUpLead[];
    },
  });

  // X-dates (renewal dates) shown alongside follow-ups on the same calendar.
  const xLiveQ = useQuery({
    queryKey: ["x-dates-live", uid, leadsIdIn],
    enabled: sharedReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, current_carrier, dispo, x_date")
        .or(`claimed_by.eq.${uid},agent_id.eq.${uid},id.in.(${leadsIdIn})`)
        .is("archived_at", null)
        .not("x_date", "is", null);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        source: "leads" as const,
        kind: "x_date" as const,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: r.phone,
        current_carrier: r.current_carrier,
        dispo: r.dispo,
        follow_up_at: parseLocalYmd(r.x_date as string).toISOString(),
      })) as FollowUpLead[];
    },
  });
  const xListQ = useQuery({
    queryKey: ["x-dates-list", uid, listIdIn],
    enabled: sharedReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("list_leads")
        .select("id, first_name, last_name, phone, current_carrier, dispo, x_date")
        .or(`claimed_by.eq.${uid},agent_id.eq.${uid},id.in.(${listIdIn})`)
        .not("x_date", "is", null);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        source: "list_leads" as const,
        kind: "x_date" as const,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: r.phone,
        current_carrier: r.current_carrier,
        dispo: r.dispo,
        follow_up_at: parseLocalYmd(r.x_date as string).toISOString(),
      })) as FollowUpLead[];
    },
  });

  // HOME side — follow-ups and x-dates set against the home portion of a lead.
  // We treat the home claimer as the owning agent.
  const homeFollowLiveQ = useQuery({
    queryKey: ["follow-ups-live-home", uid, leadsIdIn],
    enabled: sharedReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, current_carrier, home_dispo, home_follow_up_at, home_claimed_by")
        .or(`home_claimed_by.eq.${uid},id.in.(${leadsIdIn})`)
        .is("archived_at", null)
        .eq("home_dispo", "follow_up")
        .not("home_follow_up_at", "is", null);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        source: "leads" as const,
        kind: "follow_up" as const,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: r.phone,
        current_carrier: r.current_carrier,
        dispo: r.home_dispo,
        follow_up_at: r.home_follow_up_at,
      })) as FollowUpLead[];
    },
  });
  const homeFollowListQ = useQuery({
    queryKey: ["follow-ups-list-home", uid, listIdIn],
    enabled: sharedReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("list_leads")
        .select("id, first_name, last_name, phone, current_carrier, home_dispo, home_follow_up_at, home_claimed_by")
        .or(`home_claimed_by.eq.${uid},id.in.(${listIdIn})`)
        .eq("home_dispo", "follow_up")
        .not("home_follow_up_at", "is", null);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        source: "list_leads" as const,
        kind: "follow_up" as const,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: r.phone,
        current_carrier: r.current_carrier,
        dispo: r.home_dispo,
        follow_up_at: r.home_follow_up_at,
      })) as FollowUpLead[];
    },
  });
  const homeXLiveQ = useQuery({
    queryKey: ["x-dates-live-home", uid, leadsIdIn],
    enabled: sharedReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, current_carrier, home_dispo, home_x_date, home_claimed_by")
        .or(`home_claimed_by.eq.${uid},id.in.(${leadsIdIn})`)
        .is("archived_at", null)
        .not("home_x_date", "is", null);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        source: "leads" as const,
        kind: "x_date" as const,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: r.phone,
        current_carrier: r.current_carrier,
        dispo: r.home_dispo,
        follow_up_at: parseLocalYmd(r.home_x_date as string).toISOString(),
      })) as FollowUpLead[];
    },
  });
  const homeXListQ = useQuery({
    queryKey: ["x-dates-list-home", uid, listIdIn],
    enabled: sharedReady,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("list_leads")
        .select("id, first_name, last_name, phone, current_carrier, home_dispo, home_x_date, home_claimed_by")
        .or(`home_claimed_by.eq.${uid},id.in.(${listIdIn})`)
        .not("home_x_date", "is", null);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        source: "list_leads" as const,
        kind: "x_date" as const,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: r.phone,
        current_carrier: r.current_carrier,
        dispo: r.home_dispo,
        follow_up_at: parseLocalYmd(r.home_x_date as string).toISOString(),
      })) as FollowUpLead[];
    },
  });

  const leads = useMemo(
    () => {
      const all = [
        ...(liveQ.data ?? []),
        ...(listQ.data ?? []),
        ...(xLiveQ.data ?? []),
        ...(xListQ.data ?? []),
        ...(homeFollowLiveQ.data ?? []),
        ...(homeFollowListQ.data ?? []),
        ...(homeXLiveQ.data ?? []),
        ...(homeXListQ.data ?? []),
      ];
      const seen = new Set<string>();
      const out: FollowUpLead[] = [];
      for (const l of all) {
        const k = `${l.source}:${l.id}:${l.kind}:${l.follow_up_at}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(l);
      }
      return out;
    },
    [
      liveQ.data, listQ.data, xLiveQ.data, xListQ.data,
      homeFollowLiveQ.data, homeFollowListQ.data, homeXLiveQ.data, homeXListQ.data,
    ],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, FollowUpLead[]>();
    for (const l of leads) {
      const k = format(startOfDay(new Date(l.follow_up_at)), "yyyy-MM-dd");
      const arr = m.get(k) ?? [];
      arr.push(l);
      m.set(k, arr);
    }
    for (const [, arr] of m) {
      arr.sort(
        (a, b) =>
          new Date(a.follow_up_at).getTime() - new Date(b.follow_up_at).getTime(),
      );
    }
    return m;
  }, [leads]);

  const openLead = (l: FollowUpLead) =>
    navigate({ to: "/my-leads", search: { openLead: `${l.source}:${l.id}` } });

  const goPrev = () => {
    if (view === "day") setCursor(subDays(cursor, 1));
    else if (view === "week") setCursor(subWeeks(cursor, 1));
    else setCursor(subMonths(cursor, 1));
  };
  const goNext = () => {
    if (view === "day") setCursor(addDays(cursor, 1));
    else if (view === "week") setCursor(addWeeks(cursor, 1));
    else setCursor(addMonths(cursor, 1));
  };

  const title =
    view === "day"
      ? format(cursor, "EEEE, MMM d, yyyy")
      : view === "week"
      ? (() => {
          const s = startOfWeek(cursor, { weekStartsOn: 0 });
          const e = endOfWeek(cursor, { weekStartsOn: 0 });
          return isSameMonth(s, e)
            ? `${format(s, "MMM d")} – ${format(e, "d, yyyy")}`
            : `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`;
        })()
      : format(cursor, "MMMM yyyy");

  const isLoading =
    liveQ.isLoading || listQ.isLoading || xLiveQ.isLoading || xListQ.isLoading;

  return (
    <>
      <PageHeader
        title={<HeroTitle label="My Calendar" icon={CalendarDays} />}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" onClick={goPrev} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={goNext} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as CalView)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs
            value="calendar"
            onValueChange={(v) => {
              if (v === "board") navigate({ to: "/my-leads" });
            }}
          >
            <TabsList>
              <TabsTrigger value="board">
                <LayoutGrid className="mr-1 h-3.5 w-3.5" /> Board
              </TabsTrigger>
              <TabsTrigger value="calendar">
                <CalendarDays className="mr-1 h-3.5 w-3.5" /> Calendar
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading calendar…</div>
      ) : view === "month" ? (
        <MonthView
          cursor={cursor}
          byDay={byDay}
          onOpenLead={openLead}
          onJumpToDay={(d) => {
            navigate({
              to: "/follow-ups",
              search: { view: "day", date: format(d, "yyyy-MM-dd") },
            });
          }}
        />
      ) : view === "week" ? (
        <WeekView cursor={cursor} byDay={byDay} onOpenLead={openLead} />
      ) : (
        <DayView cursor={cursor} byDay={byDay} onOpenLead={openLead} />
      )}
    </>
  );
}

function fullName(l: FollowUpLead) {
  return `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed";
}

function parseLocalYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return startOfDay(new Date(s));
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function LeadChip({
  lead,
  onOpen,
  compact = false,
}: {
  lead: FollowUpLead;
  onOpen: (l: FollowUpLead) => void;
  compact?: boolean;
}) {
  const at = new Date(lead.follow_up_at);
  const isX = lead.kind === "x_date";
  const overdue = !isX && at.getTime() <= Date.now();
  const accentClass = isX
    ? "bg-violet-500"
    : overdue
    ? "bg-rose-500"
    : "bg-amber-500";
  const timeLabel = isX ? "X-Date" : format(at, "h:mm a");

  if (compact) {
    const timeLabelCompact = isX ? "x-date" : format(at, "h:mma").toLowerCase();
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(lead);
        }}
        className={cn(
          "w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] transition hover:shadow-sm",
          isX
            ? "border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100"
            : overdue
            ? "border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100"
            : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
        )}
        title={`${timeLabel} — ${fullName(lead)}`}
      >
        <span className="block truncate">
          <span className="font-medium tabular-nums">{timeLabelCompact}</span>{" "}
          <span className="truncate">{fullName(lead)}</span>
        </span>
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(lead)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(lead); } }}
      className={cn(
        "group relative w-full overflow-hidden rounded-xl border border-slate-200/80 bg-white text-left shadow-sm transition hover:shadow-md hover:border-slate-300 cursor-pointer",
      )}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentClass}`} />
      <div className="flex flex-col gap-1.5 p-2.5 pl-3.5 sm:gap-2 sm:p-3 sm:pl-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900 leading-snug truncate tracking-tight sm:text-[15px]">
              {fullName(lead)}
            </div>
            <div className="mt-0.5 text-[10px] font-medium text-slate-400 truncate sm:text-[11px]">
              {lead.current_carrier ?? "No carrier"}
            </div>
          </div>
          <span className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
            isX
              ? "border border-violet-100 bg-violet-50 text-violet-700"
              : overdue
              ? "border border-rose-100 bg-rose-50 text-rose-700"
              : "border border-amber-100 bg-amber-50 text-amber-700",
          )}>
            {timeLabel}
          </span>
        </div>

        {/* Phone CTA */}
        {lead.phone && (
          <FollowUpPhoneCTA phone={lead.phone} leadId={lead.id} leadTable={lead.source} />
        )}
      </div>
    </div>
  );
}

function FollowUpPhoneCTA({
  phone,
  leadId,
  leadTable,
}: {
  phone: string;
  leadId: string;
  leadTable: "leads" | "list_leads";
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (typeof window !== "undefined") {
          window.location.href = `tel:${phone}`;
        }
        void leadId; void leadTable;
      }}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold tracking-tight text-white hover:bg-slate-800 transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5 sm:px-4 sm:py-2.5 sm:text-[13px]"
    >
      <Phone className="h-3.5 w-3.5" />
      {phone}
    </button>
  );
}

function MonthView({
  cursor,
  byDay,
  onOpenLead,
  onJumpToDay,
}: {
  cursor: Date;
  byDay: Map<string, FollowUpLead[]>;
  onOpenLead: (l: FollowUpLead) => void;
  onJumpToDay: (d: Date) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-7 border-b text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {weekdayLabels.map((d) => (
            <div key={d} className="px-2 py-2 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const key = format(d, "yyyy-MM-dd");
            const items = byDay.get(key) ?? [];
            const inMonth = isSameMonth(d, cursor);
            const today = isToday(d);
            const visible = items.slice(0, 3);
            const overflow = items.length - visible.length;
            return (
              <button
                type="button"
                key={key}
                onClick={() => onJumpToDay(d)}
                className={cn(
                  "group min-h-[110px] border-b border-r p-1.5 text-left transition hover:bg-muted/40",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                      today && "bg-primary text-primary-foreground",
                    )}
                  >
                    {format(d, "d")}
                  </span>
                  {items.length > 0 && !today && (
                    <span className="text-[10px] text-muted-foreground">{items.length}</span>
                  )}
                </div>
                <div className="mt-1 space-y-1">
                  {visible.map((l) => (
                    <LeadChip key={`${l.source}:${l.id}`} lead={l} onOpen={onOpenLead} compact />
                  ))}
                  {overflow > 0 && (
                    <div className="px-1 text-[11px] text-muted-foreground">
                      +{overflow} more
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function WeekView({
  cursor,
  byDay,
  onOpenLead,
}: {
  cursor: Date;
  byDay: Map<string, FollowUpLead[]>;
  onOpenLead: (l: FollowUpLead) => void;
}) {
  const start = startOfWeek(cursor, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end: endOfWeek(cursor, { weekStartsOn: 0 }) });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const key = format(d, "yyyy-MM-dd");
            const items = byDay.get(key) ?? [];
            const today = isToday(d);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[420px] border-r p-2 last:border-r-0",
                  today && "bg-primary/5",
                )}
              >
                <div className="mb-2 flex items-baseline justify-between border-b pb-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {format(d, "EEE")}
                  </span>
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                      today && "bg-primary text-primary-foreground",
                    )}
                  >
                    {format(d, "d")}
                  </span>
                </div>
                {items.length === 0 ? (
                  <div className="py-4 text-center text-[11px] text-muted-foreground">—</div>
                ) : (
                  <ul className="space-y-2">
                    {items.map((l) => (
                      <li key={`${l.source}:${l.id}`}>
                        <LeadChip lead={l} onOpen={onOpenLead} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DayView({
  cursor,
  byDay,
  onOpenLead,
}: {
  cursor: Date;
  byDay: Map<string, FollowUpLead[]>;
  onOpenLead: (l: FollowUpLead) => void;
}) {
  const items = byDay.get(format(cursor, "yyyy-MM-dd")) ?? [];
  const todayFlag = isSameDay(cursor, new Date());

  // Group by hour for a simple timeline
  const hours: { hour: number; label: string; items: FollowUpLead[] }[] = [];
  for (let h = 7; h <= 20; h++) {
    hours.push({
      hour: h,
      label: format(new Date(2000, 0, 1, h), "h a"),
      items: items.filter((l) => new Date(l.follow_up_at).getHours() === h),
    });
  }
  const earlyOrLate = items.filter((l) => {
    const h = new Date(l.follow_up_at).getHours();
    return h < 7 || h > 20;
  });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold">{format(cursor, "EEEE, MMM d")}</span>{" "}
            {todayFlag && <Badge variant="outline" className="ml-1">Today</Badge>}
          </div>
          <span className="text-xs text-muted-foreground">
            {items.length} follow-up{items.length === 1 ? "" : "s"}
          </span>
        </div>
        {items.length === 0 ? (
          <div className="p-6">
            <EmptyCTA
              icon={CalendarDays}
              title="No follow-ups scheduled for this day."
              description="Schedule callbacks from your board to keep your day full and your pipeline warm."
              actions={[
                { label: "Open My Board", to: "/my-leads" },
                { label: "Browse Live Leads", to: "/call-queue", variant: "outline" },
              ]}
            />
          </div>
        ) : (
          <div>
            {earlyOrLate.length > 0 && (
              <div className="border-b bg-muted/30 px-4 py-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Outside 7am – 8pm
                </div>
                <ul className="space-y-2">
                  {earlyOrLate.map((l) => (
                    <li key={`${l.source}:${l.id}`}>
                      <LeadChip lead={l} onOpen={onOpenLead} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul>
              {hours.map((h) => (
                <li
                  key={h.hour}
                  className="grid grid-cols-[80px,1fr] gap-3 border-b px-4 py-2 last:border-b-0"
                >
                  <div className="pt-0.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {h.label}
                  </div>
                  <div className="min-h-[28px]">
                    {h.items.length === 0 ? (
                      <div className="h-full" />
                    ) : (
                      <ul className="space-y-2">
                        {h.items.map((l) => (
                          <li key={`${l.source}:${l.id}`}>
                            <LeadChip lead={l} onOpen={onOpenLead} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}