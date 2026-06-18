import { createFileRoute, redirect, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Trash2, Loader2, ToggleLeft, SlidersHorizontal, Palette, Gauge, Link2, DollarSign, Target, Bell, Sun, Moon, Monitor, ClipboardList } from "lucide-react";
import {
  useSettings,
  useUpdateSetting,
  DEFAULT_SETTINGS,
  type AppSettings,
  type FeatureFlags,
  type LeadDefaults,
  type Branding,
  type LeadScripts,
} from "@/lib/settings";
import { useHasRole } from "@/lib/auth";
import { SCRIPT_TYPES, type ScriptType } from "@/lib/constants";
import { Textarea } from "@/components/ui/textarea";
import { ScrollText, Upload } from "lucide-react";
import { ScoringEditor } from "@/components/ScoringEditor";
import { PostingLinksManager } from "@/components/PostingLinksManager";
import { CommissionsSettings } from "@/components/CommissionsSettings";
import { GoalsSettings } from "@/components/GoalsSettings";
import { AlertPrefsSection } from "@/components/AlertPrefsSection";
import { useTheme, type Theme } from "@/lib/theme";
import { ProfileSection } from "@/components/ProfileSection";
import { SaleAlertTest } from "@/components/SaleAlertTest";
import { DispositionsManager } from "@/components/DispositionsManager";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIdleThresholdMinutes, DEFAULT_IDLE_THRESHOLD_MINUTES } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/settings")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
  component: SettingsPage,
});

const FEATURE_LABELS: Record<keyof FeatureFlags, { label: string; description: string }> = {
  enable_litigator_check: { label: "TCPA litigator check on new leads", description: "Block submission when Trestle flags the phone as a known TCPA litigator." },
  enable_jornaya_upload: { label: "Jornaya LeadID upload", description: "Allow uploading Jornaya LeadID to override DNC." },
  enable_manual_import: { label: "Manual lead entry", description: "Show the Add Lead button on list pages." },
  enable_call_logging: { label: "Call logging", description: "Prompt for call outcome when clicking a phone number." },
  enable_email_sending: { label: "Outbound email", description: "Allow sending emails from the app." },
  enable_follow_ups: { label: "Follow-up calendar", description: "Show the calendar/follow-ups tab." },
  enable_analytics: { label: "Analytics", description: "Show the analytics tab." },
  enable_list_leads: { label: "Shark Tank", description: "Show the Shark Tank tab." },
  require_quoted_premium_on_sale: { label: "Require quoted premium on sale", description: "Force agents to enter a premium before marking a lead sold." },
  allow_vendor_self_signup: { label: "Vendor self-signup", description: "Let vendors create their own account (pending admin approval)." },
  allow_lead_release: { label: "Allow lead release", description: "Let agents release a claimed lead back to the pool." },
};

function SettingsPage() {
  const isAdmin = useHasRole("admin");
  const { data, isLoading } = useSettings();
  const search = useSearch({ from: "/settings" }) as { tab?: string };

  if (!isAdmin) {
    return (
      <AppShell>
        <PageHeader
          title="Settings"
          description="Manage your display preferences and notifications."
        />
        <div className="max-w-2xl space-y-6">
          <ProfileSection />
          <DisplaySection />
          <AlertPrefsSection />
        </div>
      </AppShell>
    );
  }

  if (isLoading || !data) {
    return (
      <AppShell>
        <PageHeader title="Settings" />
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title="Settings" description="Configure features, defaults, and branding for your workspace." />
      <Tabs defaultValue={search.tab || "features"} className="md:flex md:gap-6">
        <TabsList
          className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0 md:mb-0 md:w-60 md:shrink-0 md:flex-col md:items-stretch md:rounded-lg md:border md:bg-muted/30 md:p-3"
        >
          {[
            {
              group: "You",
              items: [
                { v: "profile", label: "My profile", Icon: Monitor, hint: "Name, email, direct line" },
                { v: "display", label: "Display", Icon: Monitor, hint: "Theme & appearance" },
                { v: "alerts", label: "My alerts", Icon: Bell, hint: "Sale notifications" },
              ],
            },
            {
              group: "Workspace",
              items: [
                { v: "features", label: "Features", Icon: ToggleLeft, hint: "Modules on/off" },
                { v: "branding", label: "Branding", Icon: Palette, hint: "Look & feel" },
              ],
            },
            {
              group: "Leads",
              items: [
                { v: "defaults", label: "Lead defaults", Icon: SlidersHorizontal, hint: "Claim, archive, payout" },
                { v: "scoring", label: "Lead scoring", Icon: Gauge, hint: "Weights & tiers" },
                { v: "dispositions", label: "Dispositions", Icon: ClipboardList, hint: "Call outcomes & hide/show" },
                { v: "scripts", label: "Call scripts", Icon: ScrollText, hint: "Per lead type" },
                { v: "commissions", label: "Commissions", Icon: DollarSign, hint: "Plans, tiers, bonuses" },
                { v: "goals", label: "Goals", Icon: Target, hint: "Agency & agent targets" },
              ],
            },
            {
              group: "Integrations",
              items: [
                { v: "posting", label: "Posting links", Icon: Link2, hint: "Publisher endpoints" },
              ],
            },
          ].map((section) => (
            <div key={section.group} className="contents md:block md:w-full">
              <div className="hidden md:block px-2 pb-1 pt-3 first:pt-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.group}
              </div>
              {section.items.map(({ v, label, Icon, hint }) => (
                <TabsTrigger
                  key={v}
                  value={v}
                  className="justify-start gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm md:w-full md:h-auto md:py-2 md:px-2.5"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <div className="flex flex-col items-start leading-tight">
                    <span className="text-sm">{label}</span>
                    <span className="hidden md:inline text-[11px] text-muted-foreground font-normal">{hint}</span>
                  </div>
                </TabsTrigger>
              ))}
            </div>
          ))}
        </TabsList>

        <div className="flex-1 min-w-0">
          <TabsContent value="features" className="mt-0"><FeaturesSection value={data.features} /></TabsContent>
          <TabsContent value="defaults" className="mt-0"><DefaultsSection value={data.lead_defaults} /></TabsContent>
          <TabsContent value="dispositions" className="mt-0"><DispositionsManager /></TabsContent>
          <TabsContent value="scripts" className="mt-0"><ScriptsSection value={data.scripts} /></TabsContent>
          <TabsContent value="branding" className="mt-0"><BrandingSection value={data.branding} /></TabsContent>
          <TabsContent value="scoring" className="mt-0"><ScoringEditor /></TabsContent>
          <TabsContent value="posting" className="mt-0"><PostingLinksManager /></TabsContent>
          <TabsContent value="commissions" className="mt-0"><CommissionsSettings /></TabsContent>
          <TabsContent value="goals" className="mt-0"><GoalsSettings /></TabsContent>
          <TabsContent value="alerts" className="mt-0">
            <div className="space-y-6">
              <AlertPrefsSection />
              {isAdmin && <PresenceSettingsSection />}
              {isAdmin && <SaleAlertTest />}
            </div>
          </TabsContent>
          <TabsContent value="display" className="mt-0"><DisplaySection /></TabsContent>
          <TabsContent value="profile" className="mt-0"><ProfileSection /></TabsContent>
        </div>
      </Tabs>
    </AppShell>
  );
}

function SaveBar({ dirty, onSave, onReset, saving }: { dirty: boolean; onSave: () => void; onReset: () => void; saving: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-4">
      <Button variant="ghost" onClick={onReset} disabled={!dirty || saving}>Reset</Button>
      <Button onClick={onSave} disabled={!dirty || saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save changes
      </Button>
    </div>
  );
}

function FeaturesSection({ value }: { value: FeatureFlags }) {
  const [draft, setDraft] = useState<FeatureFlags>(value);
  useEffect(() => setDraft(value), [value]);
  const update = useUpdateSetting();
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const save = () =>
    update.mutate(
      { key: "features", value: draft },
      {
        onSuccess: () => toast.success("Features updated"),
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save"),
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature toggles</CardTitle>
        <CardDescription>Turn modules on or off for everyone in the workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {(Object.keys(FEATURE_LABELS) as (keyof FeatureFlags)[]).map((k, i) => (
          <div key={k}>
            {i > 0 && <Separator className="my-1" />}
            <div className="flex items-start justify-between gap-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor={k} className="text-sm font-medium">{FEATURE_LABELS[k].label}</Label>
                <p className="text-xs text-muted-foreground">{FEATURE_LABELS[k].description}</p>
              </div>
              <Switch
                id={k}
                checked={draft[k]}
                onCheckedChange={(v) => setDraft({ ...draft, [k]: v })}
              />
            </div>
          </div>
        ))}
        <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(value)} saving={update.isPending} />
      </CardContent>
    </Card>
  );
}

function PresenceSettingsSection() {
  const qc = useQueryClient();
  const fetchThreshold = useServerFn(getIdleThresholdMinutes);
  const { data: current } = useQuery({
    queryKey: ["presence", "idle_threshold_minutes"],
    queryFn: () => fetchThreshold(),
    staleTime: 60_000,
  });
  const [draft, setDraft] = useState<number>(DEFAULT_IDLE_THRESHOLD_MINUTES);
  useEffect(() => {
    if (typeof current === "number") setDraft(current);
  }, [current]);

  const save = useMutation({
    mutationFn: async (minutes: number) => {
      const { data: existing, error: selErr } = await supabase
        .from("app_settings")
        .select("id")
        .is("workspace_id", null)
        .eq("key", "presence")
        .maybeSingle();
      if (selErr) throw selErr;
      const value = { idle_threshold_minutes: minutes };
      if (existing) {
        const { error } = await supabase
          .from("app_settings")
          .update({ value })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("app_settings")
          .insert({ workspace_id: null, key: "presence", value });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["presence", "idle_threshold_minutes"] });
      toast.success("Presence settings updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const dirty = draft !== current;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent presence</CardTitle>
        <CardDescription>
          Controls when agents are auto-marked idle in the team status strip.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="idle-threshold">Idle after (minutes)</Label>
          <Input
            id="idle-threshold"
            type="number"
            min={1}
            max={720}
            value={draft}
            onChange={(e) => setDraft(Math.max(1, Number(e.target.value) || 1))}
          />
          <p className="text-xs text-muted-foreground">
            After this many minutes with no mouse, keyboard, or tab activity, an
            agent's status switches to Idle. Activity clears it automatically.
          </p>
        </div>
        <SaveBar
          dirty={dirty}
          onSave={() => save.mutate(draft)}
          onReset={() => setDraft(current ?? DEFAULT_IDLE_THRESHOLD_MINUTES)}
          saving={save.isPending}
        />
      </CardContent>
    </Card>
  );
}

function DefaultsSection({ value }: { value: LeadDefaults }) {
  const [draft, setDraft] = useState<LeadDefaults>(value);
  useEffect(() => setDraft(value), [value]);
  const update = useUpdateSetting();
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const save = () =>
    update.mutate(
      { key: "lead_defaults", value: draft },
      {
        onSuccess: () => toast.success("Defaults updated"),
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save"),
      },
    );

  const num = (k: keyof LeadDefaults) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [k]: Number(e.target.value) || 0 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lead defaults</CardTitle>
        <CardDescription>Defaults applied when new leads or vendors are created.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="payout">Default vendor payout ($)</Label>
          <Input id="payout" type="number" min={0} step="0.01" value={draft.default_vendor_payout} onChange={num("default_vendor_payout")} />
          <p className="text-xs text-muted-foreground">Applied to new vendors unless overridden.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="archive">Auto-archive after (days)</Label>
          <Input id="archive" type="number" min={0} value={draft.auto_archive_days} onChange={num("auto_archive_days")} />
          <p className="text-xs text-muted-foreground">Unclaimed leads older than this move to Shark Tank.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lock">Claim lock (minutes)</Label>
          <Input id="lock" type="number" min={0} value={draft.claim_lock_minutes} onChange={num("claim_lock_minutes")} />
          <p className="text-xs text-muted-foreground">How long a claimed lead is locked to the claiming agent.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="max">Max active claims per agent</Label>
          <Input id="max" type="number" min={0} value={draft.max_active_claims_per_agent} onChange={num("max_active_claims_per_agent")} />
        </div>
        <div className="sm:col-span-2">
          <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(value)} saving={update.isPending} />
        </div>
      </CardContent>
    </Card>
  );
}


function BrandingSection({ value }: { value: Branding }) {
  const [draft, setDraft] = useState<Branding>(value);
  useEffect(() => setDraft(value), [value]);
  const update = useUpdateSetting();
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const save = () =>
    update.mutate(
      { key: "branding", value: draft },
      {
        onSuccess: () => toast.success("Branding updated"),
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save"),
      },
    );

  const txt = (k: keyof Branding) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [k]: e.target.value });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Customize how the app looks for your customers.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cn">Company name</Label>
          <Input id="cn" value={draft.company_name} onChange={txt("company_name")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tag">Tagline</Label>
          <Input id="tag" value={draft.tagline} onChange={txt("tagline")} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="logo">Logo URL</Label>
          <Input id="logo" value={draft.logo_url} onChange={txt("logo_url")} placeholder="https://…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="color">Primary color (hex)</Label>
          <Input id="color" value={draft.primary_color} onChange={txt("primary_color")} placeholder="#0f172a" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sup">Support email</Label>
          <Input id="sup" type="email" value={draft.support_email} onChange={txt("support_email")} />
        </div>
        <div className="sm:col-span-2">
          <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(value)} saving={update.isPending} />
        </div>
      </CardContent>
    </Card>
  );
}

// Silence unused-import lint for redirect (kept for future auth-gate move)
void redirect;
void DEFAULT_SETTINGS;
void ({} as AppSettings);

function ScriptsSection({ value }: { value: LeadScripts }) {
  const [draft, setDraft] = useState<LeadScripts>(value);
  useEffect(() => setDraft(value), [value]);
  const update = useUpdateSetting();
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const save = () =>
    update.mutate(
      { key: "scripts", value: draft },
      {
        onSuccess: () => toast.success("Scripts updated"),
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save"),
      },
    );

  const setOne = (k: ScriptType, v: string) => setDraft({ ...draft, [k]: v });

  const onUpload = async (k: ScriptType, file: File | null) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error("Script file too large (max 1MB).");
      return;
    }
    const text = await file.text();
    setOne(k, text);
    toast.success(`Loaded ${file.name} — remember to Save.`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Call scripts</CardTitle>
        <CardDescription>
          Upload or paste a call script for each lead type. Sales agents can open these
          from the lead screen via the “Script” button.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {SCRIPT_TYPES.map((t) => {
          const k = t.value as ScriptType;
          const text = draft[k] ?? "";
          return (
            <div key={k} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">{t.label}</Label>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm" className="cursor-pointer">
                    <label>
                      <Upload className="mr-1 h-3.5 w-3.5" />
                      Upload .txt
                      <input
                        type="file"
                        accept=".txt,.md,text/plain,text/markdown"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          void onUpload(k, file);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </Button>
                  {text && (
                    <Button variant="ghost" size="sm" onClick={() => setOne(k, "")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <Textarea
                value={text}
                onChange={(e) => setOne(k, e.target.value)}
                placeholder={`Paste the ${t.label.toLowerCase()} call script here…`}
                className="min-h-32 font-mono text-xs"
              />
            </div>
          );
        })}
        <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(value)} saving={update.isPending} />
      </CardContent>
    </Card>
  );
}

function DisplaySection() {
  const { theme, setTheme } = useTheme();
  const options: Array<{ value: Theme; label: string; Icon: typeof Sun; desc: string }> = [
    { value: "light", label: "Light", Icon: Sun, desc: "Bright theme" },
    { value: "dark", label: "Dark", Icon: Moon, desc: "Easy on the eyes" },
    { value: "system", label: "System", Icon: Monitor, desc: "Match your device" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Display</CardTitle>
        <CardDescription>Choose how LeadVault looks for you on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Theme</Label>
          <div className="grid gap-3 sm:grid-cols-3">
            {options.map(({ value, label, Icon, desc }) => {
              const active = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors ${
                    active
                      ? "border-ring bg-accent/10 ring-2 ring-ring"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}