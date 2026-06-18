import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Volume2, Mail, Loader2, UserPlus, Zap, Users, Share2, Clock, CalendarPlus, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";

export type AlertPrefs = {
  sale_toast: boolean;
  sale_sound: boolean;
  sale_email: boolean;
  access_request_email: boolean;
  live_lead_alert: boolean;
  share_alert: boolean;
  follow_up_alert: boolean;
  needs_follow_up_date_alert: boolean;
  x_date_alert: boolean;
  team_presence_visible: boolean;
};

const DEFAULTS: AlertPrefs = {
  sale_toast: true,
  sale_sound: true,
  sale_email: true,
  access_request_email: true,
  live_lead_alert: true,
  share_alert: true,
  follow_up_alert: true,
  needs_follow_up_date_alert: true,
  x_date_alert: true,
  team_presence_visible: true,
};

export function useAlertPrefs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["alert-prefs", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<AlertPrefs> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("notification_prefs")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      const v = (data?.notification_prefs ?? {}) as Partial<AlertPrefs>;
      return { ...DEFAULTS, ...v };
    },
    staleTime: 60_000,
  });
}

type Item = {
  key: keyof AlertPrefs;
  Icon: typeof Bell;
  label: string;
  description: string;
  adminOnly?: boolean;
};

const ITEMS: Item[] = [
  {
    key: "team_presence_visible",
    Icon: Users,
    label: "Show the team availability panel",
    description:
      "A slim tab on the left edge of the dashboard shows which teammates are online, on a call, or away. Hover or click to expand.",
  },
  {
    key: "live_lead_alert",
    Icon: Zap,
    label: "Pop up an alert when a new live lead arrives",
    description:
      "A small card slides in from the bottom-right of your screen with a Claim button so you can grab a fresh lead in one click.",
  },
  {
    key: "share_alert",
    Icon: Share2,
    label: "Pop up an alert when a teammate shares a lead with me",
    description:
      "A card slides in from the bottom-right with the sharer's name and a quick look at the lead, plus an Open button to jump to it in My Leads.",
  },
  {
    key: "follow_up_alert",
    Icon: Clock,
    label: "Pop up an alert when a follow-up is due",
    description:
      "A card slides in the moment a scheduled follow-up time arrives, with a quick Open button to jump to the lead.",
  },
  {
    key: "needs_follow_up_date_alert",
    Icon: CalendarPlus,
    label: "Pop up a reminder when a follow-up is missing a date",
    description:
      "If you marked a lead Follow-up but didn't pick a time, a card slides in so you can set one before it slips through the cracks.",
  },
  {
    key: "x_date_alert",
    Icon: CalendarClock,
    label: "Pop up an alert when a policy renewal (X-Date) is approaching",
    description:
      "A card slides in when one of your leads has an X-Date coming up in the next 14 days, so you can reach out before the renewal window closes.",
  },
  {
    key: "sale_toast",
    Icon: Bell,
    label: "Show on-screen alert when a teammate makes a sale",
    description:
      "A pop-up appears in the corner of your screen the moment a sale is closed.",
  },
  {
    key: "sale_sound",
    Icon: Volume2,
    label: "Play a celebration sound",
    description:
      "A short chime plays with the on-screen alert. Turn off if you're on a call.",
  },
  {
    key: "sale_email",
    Icon: Mail,
    label: "Email me the sales leaderboard after every sale",
    description:
      "Receive an email summarizing the latest sale and today's team leaderboard.",
  },
  {
    key: "access_request_email",
    Icon: UserPlus,
    label: "Email me when someone requests access to the platform",
    description:
      "Get an email the moment a new user signs up, with a link to the users page to approve or deny them.",
    adminOnly: true,
  },
];

export function AlertPrefsSection() {
  const { user } = useAuth();
  const isAdmin = useHasRole("admin");
  const qc = useQueryClient();
  const { data, isLoading } = useAlertPrefs();
  const [draft, setDraft] = useState<AlertPrefs>(DEFAULTS);

  const visibleItems = useMemo(
    () => ITEMS.filter((i) => !i.adminOnly || isAdmin),
    [isAdmin],
  );

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: AlertPrefs) => {
      if (!user?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ notification_prefs: next } as never)
        .eq("id", user.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(["alert-prefs", user?.id], next);
      toast.success("Preferences saved");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
      if (data) setDraft(data);
    },
  });

  const toggle = (key: keyof AlertPrefs, v: boolean) => {
    const next = { ...draft, [key]: v };
    setDraft(next);
    save.mutate(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>My alerts</CardTitle>
        <CardDescription>
          Choose how you want to be notified when someone on the team closes a sale.
          Changes save automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <ul className="divide-y">
            {visibleItems.map(({ key, Icon, label, description }) => (
              <li key={key} className="flex items-start justify-between gap-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-md bg-muted p-2 text-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={key} className="text-sm font-medium leading-tight">
                      {label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                    {key === "live_lead_alert" && draft[key] && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                        onClick={() =>
                          window.dispatchEvent(new CustomEvent("lovable:test-lead-alert"))
                        }
                      >
                        Send test alert (only you see it)
                      </Button>
                    )}
                    {key === "follow_up_alert" && draft[key] && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                        onClick={() =>
                          window.dispatchEvent(new CustomEvent("lovable:test-followup-alert"))
                        }
                      >
                        Send test alert (only you see it)
                      </Button>
                    )}
                  </div>
                </div>
                <Switch
                  id={key}
                  checked={draft[key]}
                  disabled={save.isPending}
                  onCheckedChange={(v) => toggle(key, v)}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Tip: emails can also be paused at any time using the unsubscribe link at the
          bottom of each message.
        </p>
      </CardContent>
    </Card>
  );
}

export default AlertPrefsSection;