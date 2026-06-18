import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Copy, Trash2, Link2, Plus, Power, PowerOff, Activity, Clock, Mail, Send, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listPostTokens,
  createPostToken,
  setPostTokenActive,
  setPostTokenDestination,
  deletePostToken,
  createPostingOnlyVendor,
} from "@/lib/posting-tokens.functions";
import { listVendors } from "@/lib/admin.functions";

function postUrl(token: string) {
  if (typeof window === "undefined") return `/api/public/leads/post/${token}`;
  return `${window.location.origin}/api/public/leads/post/${token}`;
}

export function PostingLinksManager() {
  const qc = useQueryClient();

  const fetchTokens = useServerFn(listPostTokens);
  const fetchVendors = useServerFn(listVendors);
  const createT = useServerFn(createPostToken);
  const toggleT = useServerFn(setPostTokenActive);
  const setDestT = useServerFn(setPostTokenDestination);
  const deleteT = useServerFn(deletePostToken);
  const createVendorFn = useServerFn(createPostingOnlyVendor);

  const tokensQ = useQuery({ queryKey: ["post-tokens"], queryFn: () => fetchTokens() });
  const vendorsQ = useQuery({ queryKey: ["vendors-all"], queryFn: () => fetchVendors() });

  const [vendorId, setVendorId] = useState("");
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState<"live" | "shark_tank">("shark_tank");

  // New-vendor dialog state
  const [newVendorOpen, setNewVendorOpen] = useState(false);
  const [nvCompany, setNvCompany] = useState("");
  const [nvContact, setNvContact] = useState("");
  const [nvEmail, setNvEmail] = useState("");

  // Send integration doc dialog state
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTokenId, setSendTokenId] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendContact, setSendContact] = useState("");
  const [sendNote, setSendNote] = useState("");
  const [sending, setSending] = useState(false);

  const createM = useMutation({
    mutationFn: (v: { vendor_id: string; label?: string; destination: "live" | "shark_tank" }) =>
      createT({ data: v }),
    onSuccess: () => {
      toast.success("Posting link created");
      setLabel("");
      qc.invalidateQueries({ queryKey: ["post-tokens"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create"),
  });

  const toggleM = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggleT({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["post-tokens"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update"),
  });

  const destM = useMutation({
    mutationFn: (v: { id: string; destination: "live" | "shark_tank" }) => setDestT({ data: v }),
    onSuccess: () => {
      toast.success("Destination updated");
      qc.invalidateQueries({ queryKey: ["post-tokens"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update destination"),
  });

  const newVendorM = useMutation({
    mutationFn: (v: { company_name: string; full_name?: string; email?: string }) =>
      createVendorFn({ data: v }),
    onSuccess: (vendor) => {
      toast.success(`Vendor "${vendor.company_name}" created`);
      qc.invalidateQueries({ queryKey: ["vendors-all"] });
      setVendorId(vendor.id);
      setNewVendorOpen(false);
      setNvCompany("");
      setNvContact("");
      setNvEmail("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create vendor"),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteT({ data: { id } }),
    onSuccess: () => {
      toast.success("Link deleted");
      qc.invalidateQueries({ queryKey: ["post-tokens"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(
      () => toast.success("Copied"),
      () => toast.error("Copy failed"),
    );
  };

  const sampleToken = tokensQ.data?.[0]?.token ?? "<YOUR_TOKEN>";
  const sampleUrl = postUrl(sampleToken);
  const sampleBody = JSON.stringify(
    {
      first_name: "Jane",
      last_name: "Doe",
      phone: "5555550123",
      state: "FL",
      current_carrier: "Geico",
      email: "jane@example.com",
      date_of_birth: "1985-04-12",
      street: "123 Main St",
      city: "Tampa",
      zip: "33602",
      county: "Hillsborough",
      num_vehicles: 2,
      vehicles: [
        { year: "2019", make: "Toyota", model: "Camry" },
        { year: "2021", make: "Honda", model: "Civic" },
      ],
      lead_types: ["auto"],
      vendor_notes: "Interested in lower rate",
    },
    null,
    2,
  );
  const curlExample = `curl -X POST "${sampleUrl}" \\
  -H "Content-Type: application/json" \\
  -d '${sampleBody.replace(/'/g, "'\\''")}'`;

  const tokens = tokensQ.data ?? [];
  const vendors = vendorsQ.data ?? [];
  const activeCount = tokens.filter((t) => t.active).length;
  const totalPosts = tokens.reduce((sum, t) => sum + (t.post_count || 0), 0);

  const activeToken = tokens.find((t) => t.id === sendTokenId) || null;
  const activeVendor = activeToken
    ? vendors.find((v: any) => v.id === activeToken.vendor_id || v.company_name === activeToken.vendor_name || v.full_name === activeToken.vendor_name)
    : null;

  function openSendDialog(tokenId: string) {
    const t = tokens.find((x) => x.id === tokenId);
    if (!t) return;
    const v = vendors.find((x: any) => x.id === (t as any).vendor_id) as any;
    setSendTokenId(tokenId);
    setSendTo(v?.email || "");
    setSendContact(v?.full_name?.split(" ")?.[0] || "");
    setSendNote("");
    setSendOpen(true);
  }

  async function handleSendIntegration() {
    if (!activeToken) return;
    if (!sendTo || !/.+@.+\..+/.test(sendTo)) {
      toast.error("Enter a valid recipient email");
      return;
    }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Not signed in");
      const res = await fetch("/lovable/email/transactional/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          templateName: "vendor-integration-guide",
          recipientEmail: sendTo,
          idempotencyKey: `vendor-integration-${activeToken.id}-${Date.now()}`,
          templateData: {
            vendorName: activeToken.vendor_name,
            contactName: sendContact || undefined,
            postUrl: postUrl(activeToken.token),
            note: sendNote || undefined,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Send failed (${res.status})`);
      }
      toast.success(`Integration guide sent to ${sendTo}`);
      setSendOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <Tabs defaultValue="links" className="space-y-4">
      <TabsList>
        <TabsTrigger value="links" className="gap-2"><Link2 className="h-4 w-4" /> Links</TabsTrigger>
        <TabsTrigger value="docs" className="gap-2"><Activity className="h-4 w-4" /> API docs</TabsTrigger>
      </TabsList>

      <TabsContent value="links" className="space-y-4 mt-0">
        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total links" value={tokens.length} />
          <StatCard label="Active" value={activeCount} />
          <StatCard label="Posts received" value={totalPosts} />
        </div>

        {/* Create */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4" /> New posting link</CardTitle>
            <CardDescription>Generates a unique URL. Choose whether leads land in Shark Tank (shared pool) or go straight to Live Leads.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[2fr_2fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger><SelectValue placeholder="Select vendor…" /></SelectTrigger>
                <SelectContent>
                  {(vendorsQ.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.company_name || v.full_name || v.email || v.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNewVendorOpen(true)}
                className="w-full gap-2"
              >
                <UserPlus className="h-4 w-4" /> Add new vendor
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder="e.g. Acme Dialer, FB Form #1"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Leads land in</Label>
              <Select value={destination} onValueChange={(v) => setDestination(v as "live" | "shark_tank")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shark_tank">Shark Tank (shared pool)</SelectItem>
                  <SelectItem value="live">Live Leads (instant transfer)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() =>
                vendorId &&
                createM.mutate({ vendor_id: vendorId, label: label || undefined, destination })
              }
              disabled={!vendorId || createM.isPending}
            >
              <Plus className="h-4 w-4" /> Generate
            </Button>
          </CardContent>
        </Card>

        {/* List */}
        {tokens.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Link2 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No posting links yet. Create one above to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tokens.map((t) => {
              const url = postUrl(t.token);
              return (
                <Card key={t.id} className={t.active ? "" : "opacity-60"}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{t.vendor_name}</span>
                          {t.label && (
                            <Badge variant="outline" className="font-normal">{t.label}</Badge>
                          )}
                          {t.active ? (
                            <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10">
                              <Power className="h-3 w-3" /> Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1 text-muted-foreground">
                              <PowerOff className="h-3 w-3" /> Disabled
                            </Badge>
                          )}
                          <Badge
                            variant="secondary"
                            className={
                              (t as any).destination === "live"
                                ? "gap-1 text-sky-700 dark:text-sky-400 bg-sky-500/10"
                                : "gap-1 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                            }
                          >
                            → {(t as any).destination === "live" ? "Live Leads" : "Shark Tank"}
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Activity className="h-3 w-3" /> {t.post_count} {t.post_count === 1 ? "post" : "posts"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {t.last_used_at ? `Last used ${new Date(t.last_used_at).toLocaleString()}` : "Never used"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="flex items-center gap-1.5 pr-1">
                          <Label className="text-xs text-muted-foreground">Lands in</Label>
                          <Select
                            value={((t as any).destination as string) || "shark_tank"}
                            onValueChange={(v) =>
                              destM.mutate({ id: t.id, destination: v as "live" | "shark_tank" })
                            }
                          >
                            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="shark_tank">Shark Tank</SelectItem>
                              <SelectItem value="live">Live Leads</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2 pr-1">
                          <Label htmlFor={`active-${t.id}`} className="text-xs text-muted-foreground">Enabled</Label>
                          <Switch
                            id={`active-${t.id}`}
                            checked={t.active}
                            onCheckedChange={(v) => toggleM.mutate({ id: t.id, active: v })}
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("Delete this posting link? Publishers using it will get a 401.")) {
                              deleteM.mutate(t.id);
                            }
                          }}
                          title="Delete link"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex items-center gap-2">
                      <code className="flex-1 min-w-0 text-xs font-mono bg-muted px-2.5 py-2 rounded truncate">{url}</code>
                      <Button size="sm" variant="outline" onClick={() => copy(url)}>
                        <Copy className="h-3.5 w-3.5" /> Copy URL
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openSendDialog(t.id)}>
                        <Mail className="h-3.5 w-3.5" /> Email integration doc
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </TabsContent>

      <TabsContent value="docs" className="space-y-4 mt-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posting a lead</CardTitle>
            <CardDescription>Send a JSON <code className="text-xs">POST</code> to the link's URL. Returns <code className="text-xs">201</code> with the new lead id.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold text-foreground mb-2">Required</div>
                <div className="flex flex-wrap gap-1.5">
                  {["first_name", "last_name", "phone (10 digits)", "state (2-letter)", "current_carrier"].map((f) => (
                    <Badge key={f} variant="secondary" className="font-mono text-[10px]">{f}</Badge>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold text-foreground mb-2">Optional</div>
                <div className="flex flex-wrap gap-1.5">
                  {["email", "date_of_birth", "street", "city", "zip", "county", "num_vehicles", "vehicles[].year", "vehicles[].make", "vehicles[].model", "current_home_carrier", "housing_status", "lead_types[]", "vendor_notes"].map((f) => (
                    <Badge key={f} variant="outline" className="font-mono text-[10px]">{f}</Badge>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold">Example request</div>
                <Button size="sm" variant="outline" onClick={() => copy(curlExample)}>
                  <Copy className="h-3 w-3" /> Copy curl
                </Button>
              </div>
              <pre className="bg-muted rounded-lg p-3 text-xs overflow-auto max-h-80 border">{curlExample}</pre>
            </div>

          </CardContent>
        </Card>
      </TabsContent>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Email integration guide</DialogTitle>
            <DialogDescription>
              Sends a branded guide with this vendor's unique posting URL, required fields, and a cURL example.
              {activeToken && (
                <span className="block mt-1 text-foreground/70">
                  Vendor: <strong>{activeToken.vendor_name}</strong>{activeToken.label ? ` · ${activeToken.label}` : ""}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="send-to">Recipient email</Label>
              <Input
                id="send-to"
                type="email"
                placeholder="dev@vendor.com"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="send-contact">Contact first name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="send-contact"
                placeholder="Jane"
                value={sendContact}
                onChange={(e) => setSendContact(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="send-note">Personal note <span className="text-muted-foreground font-normal">(optional, internal use)</span></Label>
              <Textarea
                id="send-note"
                rows={3}
                placeholder="Anything you'd like to mention…"
                value={sendNote}
                onChange={(e) => setSendNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSendOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={handleSendIntegration} disabled={sending}>
              <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send guide"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newVendorOpen} onOpenChange={setNewVendorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> New vendor</DialogTitle>
            <DialogDescription>
              Creates a posting-only vendor. They won't get CRM access — this just gives you a vendor to attach posting links to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nv-company">Company name</Label>
              <Input
                id="nv-company"
                placeholder="Acme Leads LLC"
                value={nvCompany}
                onChange={(e) => setNvCompany(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nv-contact">Contact name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="nv-contact"
                placeholder="Jane Doe"
                value={nvContact}
                onChange={(e) => setNvContact(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nv-email">Email <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="nv-email"
                type="email"
                placeholder="contact@vendor.com"
                value={nvEmail}
                onChange={(e) => setNvEmail(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Leave blank if they won't ever log in — we'll generate a placeholder.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewVendorOpen(false)} disabled={newVendorM.isPending}>Cancel</Button>
            <Button
              onClick={() =>
                nvCompany.trim() &&
                newVendorM.mutate({
                  company_name: nvCompany.trim(),
                  full_name: nvContact.trim() || undefined,
                  email: nvEmail.trim() || undefined,
                })
              }
              disabled={!nvCompany.trim() || newVendorM.isPending}
            >
              <UserPlus className="h-4 w-4" /> {newVendorM.isPending ? "Creating…" : "Create vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}