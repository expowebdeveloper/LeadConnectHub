import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { useServerFn } from "@tanstack/react-start";
import { checkLitigator } from "@/lib/litigator.functions";
import { findDuplicatePhone, type DuplicateMatch } from "@/lib/duplicates.functions";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CARRIERS,
  VEHICLE_YEARS,
  VEHICLE_MAKES,
  VEHICLE_MODELS_BY_MAKE,
  HOME_CARRIERS,
  CONSTRUCTION_TYPES,
  ROOF_TYPES,
  type LeadType,
  type LeadSource,
  formatPhone,
  isValidUsPhone,
  type Vehicle,
} from "@/lib/constants";
import { toast } from "sonner";
import {
  AlertOctagon,
  CheckCircle2,
  Car,
  Home as HomeIcon,
  MapPin,
  Phone as PhoneIcon,
  Mail,
  Calendar,
  User,
} from "lucide-react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { VendorLeadWaitDialog } from "@/components/VendorLeadWaitDialog";
import { ImportListFlow } from "@/components/ImportListFlow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TOP_AUTO_CARRIERS = [
  "Progressive", "GEICO", "State Farm", "Allstate",
  "Liberty Mutual", "Farmers", "Nationwide", "Travelers",
];
const TOP_HOME_CARRIERS = [
  "Citizens", "State Farm", "Allstate", "USAA",
  "Progressive", "Universal", "Tower Hill", "Heritage",
];

function Chip({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-input bg-background text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function ChipGroup({
  options,
  value,
  onChange,
  topOptions,
}: {
  options: readonly string[] | string[];
  value: string;
  onChange: (v: string) => void;
  /** When provided, show only these first with a "Show all" toggle. */
  topOptions?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const useTop = topOptions && !expanded && !(value && !topOptions.includes(value) && value !== "Other" && value !== "None");
  const shown = topOptions
    ? (expanded
        ? options
        : Array.from(new Set([
            ...topOptions,
            ...(options.includes("Other") ? ["Other"] : []),
            ...(options.includes("None") ? ["None"] : []),
            ...(value && !topOptions.includes(value) ? [value] : []),
          ])))
    : options;
  void useTop;
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((opt) => (
        <Chip key={opt} selected={value === opt} onClick={() => onChange(opt)}>
          {opt}
        </Chip>
      ))}
      {topOptions && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-full border border-dashed border-input bg-background px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
        >
          Show all…
        </button>
      )}
    </div>
  );
}

export const Route = createFileRoute("/leads/new")({
  validateSearch: z.object({ as: z.enum(["shark"]).optional() }),
  head: () => ({
    meta: [
      { title: "New lead — LeadVault" },
      { name: "description", content: "Submit a new insurance lead to LeadVault." },
    ],
  }),
  component: NewLeadPage,
});

function NewLeadPage() {
  const { user, loading } = useAuth();
  const allowed = useHasRole("vendor", "sales", "admin");
  const isSales = useHasRole("sales");
  const isVendor = useHasRole("vendor");
  const isAdmin = useHasRole("admin");
  const search = useSearch({ from: "/leads/new" });
  const dropToShark = search.as === "shark" && !isVendor;
  const submitAsAnchorline = isSales && !isVendor && !dropToShark;
  const navigate = useNavigate();
  const [mode, setMode] = useState<"single" | "import">("single");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  if (!allowed) {
    return (
      <AppShell>
        <PageHeader title="Submit a new lead" description="" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Your account hasn't been approved yet.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const adminToggle = isAdmin ? (
    <div className="inline-flex rounded-lg border bg-muted p-1">
      <button
        type="button"
        onClick={() => setMode("single")}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          mode === "single"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Single lead
      </button>
      <button
        type="button"
        onClick={() => setMode("import")}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          mode === "import"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Import list
      </button>
    </div>
  ) : null;

  if (isAdmin && mode === "import") {
    return (
      <AppShell>
        <PageHeader
          title="Submit a new lead"
          description="Import a list of leads from a CSV file."
          action={adminToggle}
        />
        <ImportListFlow onDone={() => navigate({ to: "/my-leads" })} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      {adminToggle && (
        <div className="mb-4 flex justify-end">{adminToggle}</div>
      )}
      <LeadForm
        userId={user.id}
        submitAsAnchorline={submitAsAnchorline}
        dropToShark={dropToShark}
        vendorOnly={isVendor && !isSales && !isAdmin}
        onDone={() => navigate({ to: "/my-leads" })}
      />
    </AppShell>
  );
}

function LeadForm({
  userId,
  submitAsAnchorline,
  dropToShark,
  vendorOnly,
  onDone,
}: {
  userId: string;
  submitAsAnchorline: boolean;
  dropToShark: boolean;
  vendorOnly: boolean;
  onDone: () => void;
}) {
  const checkLitigatorFn = useServerFn(checkLitigator);
  const findDupesFn = useServerFn(findDuplicatePhone);
  const { refreshRoles } = useAuth();
  const [parentVendorId, setParentVendorId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("parent_vendor_id")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) setParentVendorId((data?.parent_vendor_id as string | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const [selectedTypes, setSelectedTypes] = useState<LeadType[]>(["auto"]);
  const hasType = (t: LeadType) => selectedTypes.includes(t);
  const [housingStatus, setHousingStatus] = useState<"homeowner" | "renter" | "">("");
  const leadSource: LeadSource = vendorOnly ? "live_transfer" : "internet";
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    zip: "",
    county: "",
    current_carrier: "",
    num_vehicles: "1",
    vendor_notes: "",
    date_of_birth: "",
  });
  const [vehicles, setVehicles] = useState<Vehicle[]>([{ year: "", make: "", model: "" }]);
  const [home, setHome] = useState({
    current_home_carrier: "",
    year_built: "",
    square_feet: "",
    construction_type: "",
    roof_type: "",
    roof_year: "",
    num_stories: "1",
    num_bedrooms: "",
    num_bathrooms: "",
    dwelling_value: "",
    has_pool: false,
    has_trampoline: false,
    claims_last_5y: "0",
    mortgage_company: "",
  });
  const setH = <K extends keyof typeof home>(k: K, v: (typeof home)[K]) =>
    setHome((p) => ({ ...p, [k]: v }));
  const [submitting, setSubmitting] = useState(false);
  const [dncBlocked, setDncBlocked] = useState(false);
  const [optinProofPath, setOptinProofPath] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [dupeBlocked, setDupeBlocked] = useState(false);
  const [waitLeadId, setWaitLeadId] = useState<string | null>(null);
  const [sharkClaimLeadId, setSharkClaimLeadId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const navigate = useNavigate();
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Keep vehicles array length in sync with num_vehicles
  const setNumVehicles = (v: string) => {
    const n = Math.max(0, Math.min(20, parseInt(v, 10) || 0));
    set("num_vehicles", String(n));
    setVehicles((prev) => {
      if (n === prev.length) return prev;
      if (n > prev.length) {
        return [...prev, ...Array.from({ length: n - prev.length }, () => ({ year: "", make: "", model: "" }))];
      }
      return prev.slice(0, n);
    });
  };

  const setVehicle = (i: number, patch: Partial<Vehicle>) => {
    setVehicles((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidUsPhone(f.phone)) {
      toast.error("Please enter a valid 10-digit phone number.");
      return;
    }
    if (selectedTypes.length === 0) {
      toast.error("Please select at least one lead type.");
      return;
    }
    if (hasType("home") && !housingStatus) {
      toast.error("Please mark this lead as Homeowner or Renter.");
      return;
    }
    const needsAuto = hasType("auto");
    const needsHome = hasType("home");
    if (needsAuto) {
      if (!f.current_carrier) {
        toast.error("Please select the current auto carrier.");
        return;
      }
      if (vehicles.length === 0) {
        toast.error("Please add at least one vehicle.");
        return;
      }
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        if (!v.year || !v.make || !v.model) {
          toast.error(`Please complete year, make, and model for vehicle ${i + 1}.`);
          return;
        }
      }
    }
    // Home details (carrier, year built, sqft, construction, roof type) are
    // intentionally optional at create time — agents often need to save the
    // lead and look up property info later. The side pane auto-saves these
    // fields on blur, so nothing downstream depends on them being set here.
    setSubmitting(true);
    // Duplicate phone check — hard block, no override
    try {
      const res = await findDupesFn({ data: { phone: f.phone.trim() } });
      if (res.matches && res.matches.length > 0) {
        setDuplicates(res.matches);
        setDupeBlocked(true);
        setSubmitting(false);
        toast.error(`Duplicate blocked — this phone is already in the system (${res.matches.length} match${res.matches.length === 1 ? "" : "es"}).`);
        return;
      }
      setDupeBlocked(false);
    } catch (err) {
      console.warn("Duplicate check failed:", err);
    }
    // TCPA litigator verification — block submission on hit (no override).
    try {
      const lit = await checkLitigatorFn({ data: { phone: f.phone.trim() } });
      if (lit?.is_litigator) {
        setSubmitting(false);
        setDncBlocked(true);
        toast.error("This phone number is flagged as a TCPA litigator. Do not call.");
        await refreshRoles();
        return;
      }
      setDncBlocked(false);
      if ((lit as { bypassed?: boolean })?.bypassed) {
        toast.success("Litigator check bypassed for your account.");
      }
      if (lit?.error) {
        console.error("Litigator check unavailable:", lit.error);
        setSubmitting(false);
        toast.error(
          `Lead not saved — litigator scrub unavailable (${lit.error}). Admins have been notified.`,
        );
        return;
      }
    } catch (err: any) {
      console.error("Litigator check failed:", err);
      setSubmitting(false);
      toast.error("Lead not saved — litigator scrub failed. Admins have been notified.");
      return;
    }
    // Pick a representative single value for the legacy `lead_type` enum column.
    const legacyLeadType: LeadType =
      hasType("auto") && hasType("home")
        ? ("both" as LeadType)
        : hasType("auto")
          ? "auto"
          : hasType("home")
            ? "home"
            : selectedTypes[0];
    const basePayload = {
      lead_type: legacyLeadType,
      lead_types: selectedTypes,
      first_name: f.first_name.trim(),
      last_name: f.last_name.trim(),
      phone: f.phone.trim(),
      email: f.email.trim() || null,
      date_of_birth: f.date_of_birth || null,
      street: f.street.trim(),
      city: f.city.trim(),
      state: "FL",
      zip: f.zip.trim(),
      county: f.county.trim(),
      current_carrier: needsAuto ? f.current_carrier : null,
      num_vehicles: needsAuto ? vehicles.length : 0,
      vehicles: needsAuto ? vehicles : [],
      current_home_carrier: needsHome ? home.current_home_carrier : null,
      year_built: needsHome && home.year_built ? Number(home.year_built) : null,
      square_feet: needsHome && home.square_feet ? Number(home.square_feet) : null,
      construction_type: needsHome ? home.construction_type || null : null,
      roof_type: needsHome ? home.roof_type || null : null,
      roof_year: needsHome && home.roof_year ? Number(home.roof_year) : null,
      num_stories: needsHome && home.num_stories ? Number(home.num_stories) : null,
      num_bedrooms: needsHome && home.num_bedrooms ? Number(home.num_bedrooms) : null,
      num_bathrooms: needsHome && home.num_bathrooms ? Number(home.num_bathrooms) : null,
      dwelling_value: needsHome && home.dwelling_value ? Number(home.dwelling_value) : null,
      has_pool: needsHome ? home.has_pool : null,
      has_trampoline: needsHome ? home.has_trampoline : null,
      claims_last_5y: needsHome && home.claims_last_5y !== "" ? Number(home.claims_last_5y) : null,
      mortgage_company: needsHome ? home.mortgage_company.trim() || null : null,
      vendor_notes: f.vendor_notes.trim() || null,
      housing_status: housingStatus || null,
      lead_source: leadSource,
      referred_by: parentVendorId ? userId : null,
    };
    const { data: inserted, error } = submitAsAnchorline
      ? await supabase.from("list_leads").insert({
          ...basePayload,
          vendor_id: null,
          list_type: "anchorline",
          claimed_by: userId,
          claimed_at: new Date().toISOString(),
        }).select("id").maybeSingle()
      : dropToShark
      ? await supabase.from("list_leads").insert({
          ...basePayload,
          vendor_id: null,
          list_type: "manual_upload",
        }).select("id").maybeSingle()
      : await supabase.from("leads").insert({
          ...basePayload,
          vendor_id: parentVendorId ?? userId,
          optin_proof_path: optinProofPath,
        }).select("id").maybeSingle();
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lead submitted");
    if (dropToShark && inserted?.id) {
      setSharkClaimLeadId(inserted.id as string);
    } else if (!submitAsAnchorline && inserted?.id) {
      // Vendor flow: open wait-for-claim dialog
      setWaitLeadId(inserted.id as string);
    } else {
      onDone();
    }
  };

  const handleOptinUpload = async (file: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10MB).");
      return;
    }
    setUploadingProof(true);
    const ext = file.name.split(".").pop() || "bin";
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("optin-proofs").upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    setUploadingProof(false);
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      return;
    }
    setOptinProofPath(path);
    toast.success("Jornaya LeadID uploaded. You can now submit the lead.");
  };


  // ---- derived completion / progress ----
  const autoNeeded = hasType("auto");
  const homeNeeded = hasType("home");
  const contactValid =
    !!f.first_name.trim() &&
    !!f.last_name.trim() &&
    isValidUsPhone(f.phone) &&
    !!f.date_of_birth &&
    !!f.street.trim() &&
    !!f.city.trim() &&
    !!f.zip.trim() &&
    !!f.county.trim();
  const coverageTypeValid = selectedTypes.length > 0 && (!homeNeeded || !!housingStatus);
  const detailsValid =
    !autoNeeded ||
    (!!f.current_carrier &&
      vehicles.length > 0 &&
      vehicles.every((v) => v.year && v.make && v.model));

  const completedCount = [contactValid, coverageTypeValid, detailsValid].filter(Boolean).length;
  const pct = Math.round((completedCount / 3) * 100);
  const allValid = contactValid && coverageTypeValid && detailsValid;

  return (
    <>
      <div className="mx-auto w-full max-w-[720px] pb-32">
        {/* Page header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
              Lead intake
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              New lead
            </h1>
          </div>
        </div>

        {/* Thin progress bar */}
        <div className="mb-8 h-[2px] w-full overflow-hidden rounded-full bg-border/60">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Coverage type toggle */}
        <div className="mb-6">
          <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-foreground">
            Coverage type
          </Label>
          <div className="flex flex-wrap gap-2">
            <SegButton selected={hasType("auto") && !hasType("home")} onClick={() => { setSelectedTypes(["auto"]); setHousingStatus(""); }}>
              Auto
            </SegButton>
            <SegButton selected={hasType("home") && !hasType("auto")} onClick={() => { setSelectedTypes(["home"]); setHousingStatus(""); }}>
              Home
            </SegButton>
            <SegButton selected={hasType("auto") && hasType("home")} onClick={() => setSelectedTypes(["auto", "home"])}>
              Both
            </SegButton>
          </div>
        </div>

        {/* Blocker alerts */}
        {dncBlocked && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border-4 border-destructive bg-destructive p-6 text-destructive-foreground shadow-lg animate-pulse"
          >
            <div className="flex items-start gap-4">
              <AlertOctagon className="h-12 w-12 shrink-0" />
              <div className="space-y-2">
                <h2 className="text-3xl font-extrabold uppercase tracking-wide">
                  ⚠ TCPA Litigator — Do Not Call
                </h2>
                <p className="text-lg font-semibold">
                  This phone number is flagged as a known TCPA litigator.
                </p>
                <p className="text-base font-bold uppercase">
                  End the call immediately. Do NOT submit or transfer.
                </p>
              </div>
            </div>
          </div>
        )}
        {duplicates.length > 0 && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border-4 border-destructive bg-destructive p-6 text-destructive-foreground shadow-lg"
          >
            <div className="flex items-start gap-4">
              <AlertOctagon className="h-10 w-10 shrink-0" />
              <div className="flex-1 space-y-2">
                <h3 className="text-2xl font-extrabold uppercase tracking-wide">
                  ⚠ Duplicate lead — blocked
                </h3>
                <p className="text-sm font-semibold">
                  This phone is already in the system on {duplicates.length} lead
                  {duplicates.length === 1 ? "" : "s"}.
                </p>
                <ul className="text-xs space-y-1 max-h-32 overflow-y-auto rounded bg-background/10 p-2">
                  {duplicates.map((d) => (
                    <li key={`${d.source}-${d.id}`} className="rounded bg-background/20 px-2 py-1">
                      <span className="font-medium">{d.first_name} {d.last_name}</span>
                      <span className="opacity-80">
                        {" "}· {d.source === "list_leads" ? "List lead" : "Lead"} ·{" "}
                        {new Date(d.created_at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-12 rounded-2xl border border-border bg-card text-card-foreground p-6 sm:p-8 shadow-sm">
          {/* 01 · Contact */}
          <section id="contact" className="space-y-6">
            <div className="space-y-7">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <ModernText
                        label="First name"
                        required
                        value={f.first_name}
                        onChange={(v) => set("first_name", v)}
                        leadingIcon={<User className="h-4 w-4" />}
                      />
                      <ModernText
                        label="Last name"
                        required
                        value={f.last_name}
                        onChange={(v) => set("last_name", v)}
                        leadingIcon={<User className="h-4 w-4" />}
                      />
                      <ModernText
                        label="Phone number"
                        required
                        type="tel"
                        value={f.phone}
                        onChange={(v) => set("phone", formatPhone(v))}
                        leadingIcon={<PhoneIcon className="h-4 w-4" />}
                        inputMode="tel"
                        maxLength={14}
                      />
                      <ModernText
                        label="Date of birth"
                        required
                        type="date"
                        value={f.date_of_birth}
                        onChange={(v) => set("date_of_birth", v)}
                        leadingIcon={<Calendar className="h-4 w-4" />}
                        max={new Date().toISOString().slice(0, 10)}
                      />
                      <div className="sm:col-span-2">
                        <ModernText
                          label="Email (optional)"
                          type="email"
                          value={f.email}
                          onChange={(v) => set("email", v)}
                          leadingIcon={<Mail className="h-4 w-4" />}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <AddressAutocomplete
                          value={f.street}
                          onChange={(v) => set("street", v)}
                          onSelect={(parts) => {
                            setF((p) => ({
                              ...p,
                              street: parts.street || p.street,
                              city: parts.city || p.city,
                              zip: parts.zip || p.zip,
                              county: parts.county || p.county,
                            }));
                          }}
                          required
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <ModernText label="City" required value={f.city} onChange={(v) => set("city", v)} />
                        <ModernText label="ZIP" required value={f.zip} onChange={(v) => set("zip", v)} />
                        <ModernText label="County" required value={f.county} onChange={(v) => set("county", v)} />
                      </div>
                    </div>
            </div>
          </section>


          {(autoNeeded || homeNeeded) && (
            <>
              <div className="h-px bg-border/40" />
              <section id="details" className="space-y-6">
                <SectionHeader
                  number="03"
                  label="Details"
                  icon={autoNeeded ? <Car className="h-4 w-4" /> : <HomeIcon className="h-4 w-4" />}
                  valid={detailsValid}
                />
                <div className="space-y-8">
                    {autoNeeded && (
                      <div className="space-y-5">
                        {autoNeeded && homeNeeded && (
                          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-brand">
                            <Car className="h-3.5 w-3.5" /> Auto
                          </div>
                        )}
                        <div>
                          <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-foreground">
                            Current carrier <span className="text-destructive">*</span>
                          </Label>
                          <CarrierGrid
                            options={CARRIERS as unknown as string[]}
                            topOptions={TOP_AUTO_CARRIERS}
                            value={f.current_carrier}
                            onChange={(v) => set("current_carrier", v)}
                          />
                        </div>

                        <div>
                          <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-foreground">
                            Vehicles on policy <span className="text-destructive">*</span>
                          </Label>
                          <div className="flex flex-wrap items-center gap-2">
                            {["1", "2", "3", "4"].map((n) => (
                              <SegButton
                                key={n}
                                selected={f.num_vehicles === n}
                                onClick={() => setNumVehicles(n)}
                              >
                                {n}
                              </SegButton>
                            ))}
                            <SegButton
                              selected={Number(f.num_vehicles) >= 5}
                              onClick={() =>
                                setNumVehicles(String(Math.max(5, Number(f.num_vehicles) || 0)))
                              }
                            >
                              5+
                            </SegButton>
                            {Number(f.num_vehicles) >= 5 && (
                              <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-background/60 px-1.5 py-1">
                                <button
                                  type="button"
                                  className="grid h-7 w-7 place-items-center rounded-lg text-sm hover:bg-accent"
                                  onClick={() =>
                                    setNumVehicles(String(Math.max(5, Number(f.num_vehicles) - 1)))
                                  }
                                >
                                  −
                                </button>
                                <span className="min-w-[1.75rem] text-center text-sm font-semibold">
                                  {f.num_vehicles}
                                </span>
                                <button
                                  type="button"
                                  className="grid h-7 w-7 place-items-center rounded-lg text-sm hover:bg-accent"
                                  onClick={() =>
                                    setNumVehicles(String(Math.min(20, Number(f.num_vehicles) + 1)))
                                  }
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3">
                          {vehicles.map((v, i) => {
                            const models = v.make ? VEHICLE_MODELS_BY_MAKE[v.make] ?? [] : [];
                            return (
                              <div
                                key={i}
                                className="rounded-2xl border-2 border-input bg-background p-4 space-y-3"
                              >
                                <div className="flex items-center gap-2 text-sm font-semibold">
                                  <span className="grid h-6 w-6 place-items-center rounded-md bg-brand/15 text-xs text-brand">
                                    {i + 1}
                                  </span>
                                  Vehicle {i + 1}
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                   <div className="space-y-2">
                                     <Select value={v.year} onValueChange={(val) => setVehicle(i, { year: val })}>
                                      <SelectTrigger className="h-12 rounded-xl border-2 border-input bg-background text-base font-medium [&>span]:font-medium data-[placeholder]:[&>span]:text-muted-foreground"><SelectValue placeholder="Year" /></SelectTrigger>
                                      <SelectContent className="max-h-72">
                                        {VEHICLE_YEARS.map((y) => (<SelectItem key={y} value={y}>{y}</SelectItem>))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <Select value={v.make} onValueChange={(val) => setVehicle(i, { make: val, model: "" })}>
                                      <SelectTrigger className="h-12 rounded-xl border-2 border-input bg-background text-base font-medium [&>span]:font-medium data-[placeholder]:[&>span]:text-muted-foreground"><SelectValue placeholder="Make" /></SelectTrigger>
                                      <SelectContent className="max-h-72">
                                        {VEHICLE_MAKES.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <Select value={v.model} onValueChange={(val) => setVehicle(i, { model: val })} disabled={!v.make}>
                                      <SelectTrigger className="h-12 rounded-xl border-2 border-input bg-background text-base font-medium [&>span]:font-medium data-[placeholder]:[&>span]:text-muted-foreground"><SelectValue placeholder={v.make ? "Model" : "Select make first"} /></SelectTrigger>
                                      <SelectContent className="max-h-72">
                                        {models.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {autoNeeded && homeNeeded && <div className="h-px bg-border/60" />}

                    {homeNeeded && (
                      <div className="space-y-5">
                        {autoNeeded && homeNeeded && (
                          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-brand">
                            <HomeIcon className="h-3.5 w-3.5" /> Home <span className="ml-1 normal-case tracking-normal text-muted-foreground">(optional)</span>
                          </div>
                        )}
                        <div>
                          <Label className="mb-3 block text-xs font-semibold uppercase tracking-wide text-foreground">
                            Housing status <span className="text-destructive">*</span>
                          </Label>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <OptionCard
                              selected={housingStatus === "homeowner"}
                              onClick={() => setHousingStatus("homeowner")}
                              icon={<HomeIcon className="h-5 w-5" />}
                              label="Homeowner"
                              hint="Owns their residence"
                            />
                            <OptionCard
                              selected={housingStatus === "renter"}
                              onClick={() => setHousingStatus("renter")}
                              icon={<MapPin className="h-5 w-5" />}
                              label="Renter"
                              hint="Rents their residence"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-foreground">Current home carrier</Label>
                          <CarrierGrid
                            options={HOME_CARRIERS as unknown as string[]}
                            topOptions={TOP_HOME_CARRIERS}
                            value={home.current_home_carrier}
                            onChange={(v) => setH("current_home_carrier", v)}
                          />
                        </div>
                        <div className="grid gap-5 sm:grid-cols-2">
                          <ModernText label="Year built" value={home.year_built} onChange={(v) => setH("year_built", v)} type="number" min={1800} />
                          <ModernText label="Square footage" value={home.square_feet} onChange={(v) => setH("square_feet", v)} type="number" min={100} />
                        </div>
                        <FieldBlock label="Construction type">
                          <ChipGroup options={CONSTRUCTION_TYPES as unknown as string[]} value={home.construction_type} onChange={(v) => setH("construction_type", v)} />
                        </FieldBlock>
                        <FieldBlock label="Roof type">
                          <ChipGroup options={ROOF_TYPES as unknown as string[]} value={home.roof_type} onChange={(v) => setH("roof_type", v)} />
                        </FieldBlock>
                        <div className="grid gap-5 sm:grid-cols-2">
                          <ModernText label="Year roof replaced" value={home.roof_year} onChange={(v) => setH("roof_year", v)} type="number" min={1900} />
                          <ModernText label="Estimated dwelling value ($)" value={home.dwelling_value} onChange={(v) => setH("dwelling_value", v)} type="number" min={0} />
                        </div>
                        <div className="grid gap-5 sm:grid-cols-3">
                          <FieldBlock label="# Stories">
                            <div className="flex flex-wrap gap-2">
                              {["1", "2"].map((n) => (
                                <SegButton key={n} selected={home.num_stories === n} onClick={() => setH("num_stories", n)}>{n}</SegButton>
                              ))}
                              <SegButton selected={Number(home.num_stories) >= 3} onClick={() => setH("num_stories", "3")}>3+</SegButton>
                            </div>
                          </FieldBlock>
                          <FieldBlock label="# Bedrooms">
                            <div className="flex flex-wrap gap-2">
                              {["1", "2", "3", "4", "5"].map((n) => (
                                <SegButton key={n} selected={home.num_bedrooms === n} onClick={() => setH("num_bedrooms", n)}>{n}</SegButton>
                              ))}
                              <SegButton selected={Number(home.num_bedrooms) >= 6} onClick={() => setH("num_bedrooms", "6")}>6+</SegButton>
                            </div>
                          </FieldBlock>
                          <FieldBlock label="# Bathrooms">
                            <div className="flex flex-wrap gap-2">
                              {["1", "2", "3"].map((n) => (
                                <SegButton key={n} selected={home.num_bathrooms === n} onClick={() => setH("num_bathrooms", n)}>{n}</SegButton>
                              ))}
                              <SegButton selected={Number(home.num_bathrooms) >= 3.5} onClick={() => setH("num_bathrooms", "3.5")}>3.5+</SegButton>
                            </div>
                          </FieldBlock>
                        </div>
                        <FieldBlock label="Claims in last 5 years">
                          <div className="flex flex-wrap gap-2">
                            {["0", "1", "2"].map((n) => (
                              <SegButton key={n} selected={home.claims_last_5y === n} onClick={() => setH("claims_last_5y", n)}>{n}</SegButton>
                            ))}
                            <SegButton selected={Number(home.claims_last_5y) >= 3} onClick={() => setH("claims_last_5y", "3")}>3+</SegButton>
                          </div>
                        </FieldBlock>
                        <ModernText label="Mortgage company" optional value={home.mortgage_company} onChange={(v) => setH("mortgage_company", v)} />
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Chip selected={home.has_pool} onClick={() => setH("has_pool", !home.has_pool)}>
                            {home.has_pool ? "✓ " : ""}Pool
                          </Chip>
                          <Chip selected={home.has_trampoline} onClick={() => setH("has_trampoline", !home.has_trampoline)}>
                            {home.has_trampoline ? "✓ " : ""}Trampoline
                          </Chip>
                        </div>
                      </div>
                    )}
                </div>
              </section>
            </>
          )}

          {/* Notes */}
          <div className="h-px bg-border/40" />
          <section className="space-y-4">
            <FieldBlock label="Notes for the closer" optional>
              <Textarea
                rows={3}
                value={f.vendor_notes}
                onChange={(e) => set("vendor_notes", e.target.value)}
                className="rounded-xl border-border bg-background text-base placeholder:font-medium placeholder:text-foreground/70"
                placeholder="Coverage gaps, callback windows, special context…"
              />
            </FieldBlock>
            {(optinProofPath || uploadingProof) && (
              <p className="text-xs text-muted-foreground">
                {optinProofPath ? "Jornaya LeadID attached." : null}
                {uploadingProof ? "Uploading proof…" : null}
              </p>
            )}
          </section>

          {/* Floating submit footer */}
          <div className="sticky bottom-4 z-20 -mx-4 sm:mx-0">
            <Button
              type="submit"
              disabled={submitting || !allValid}
              className="w-full rounded-2xl bg-gradient-to-br from-brand to-brand/85 py-4 text-base font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all hover:shadow-xl hover:shadow-brand/35 hover:-translate-y-0.5 disabled:translate-y-0 disabled:shadow-none disabled:from-muted disabled:to-muted disabled:text-muted-foreground"
            >
              {submitting ? "Submitting…" : "Submit lead"}
            </Button>
            {!allValid && !submitting && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {!autoNeeded
                  ? "Auto is required — select Auto or Auto + Home above."
                  : !detailsValid
                    ? "Add the current auto carrier and at least one vehicle (year, make, model)."
                    : "Complete all required fields to submit."}
              </p>
            )}
          </div>
        </form>
      </div>

      <VendorLeadWaitDialog
        leadId={waitLeadId}
        open={!!waitLeadId}
        onClose={() => {
          setWaitLeadId(null);
          onDone();
        }}
      />

      <AlertDialog open={!!sharkClaimLeadId}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lead dropped into the Shark Tank</AlertDialogTitle>
            <AlertDialogDescription>
              This lead is now sitting in the Shark Tank. Do you want to claim it
              for yourself, or leave it for the team?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={claiming}
              onClick={() => {
                setSharkClaimLeadId(null);
                navigate({ to: "/shark-tank" });
              }}
            >
              Leave in Shark Tank
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={claiming}
              onClick={async () => {
                if (!sharkClaimLeadId) return;
                setClaiming(true);
                const { error } = await supabase
                  .from("list_leads")
                  .update({
                    claimed_by: userId,
                    claimed_at: new Date().toISOString(),
                  })
                  .eq("id", sharkClaimLeadId)
                  .is("claimed_by", null);
                setClaiming(false);
                if (error) {
                  toast.error(`Couldn't claim: ${error.message}`);
                  return;
                }
                toast.success("Lead claimed");
                setSharkClaimLeadId(null);
                navigate({ to: "/my-leads" });
              }}
            >
              {claiming ? "Claiming…" : "Claim it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ───────── Helper UI primitives ─────────

function SectionCard({
  number,
  icon,
  title,
  subtitle,
  complete,
  optional,
  children,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  complete?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm transition-colors hover:border-border">
      <header className="flex items-start justify-between gap-4 border-b border-border/50 bg-gradient-to-r from-card to-card/50 px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Step {number}
              </span>
              {optional && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Optional
                </span>
              )}
            </div>
            <h2 className="truncate text-base font-semibold leading-tight">{title}</h2>
            {subtitle && (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        {complete && (
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/25">
            <CheckCircle2 className="h-3.5 w-3.5" /> Complete
          </div>
        )}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}

function FieldBlock({
  label,
  hint,
  required,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
        {optional && (
          <span className="ml-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/70">
            (optional)
          </span>
        )}
      </Label>
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
      {children}
    </div>
  );
}

function ModernText({
  label,
  value,
  onChange,
  required,
  optional,
  type = "text",
  min,
  placeholder,
  leadingIcon,
  inputMode,
  maxLength,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  optional?: boolean;
  type?: string;
  min?: number;
  placeholder?: string;
  leadingIcon?: React.ReactNode;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
  max?: string;
}) {
  void optional;
  const isDate = type === "date";
  return (
    <div className="relative">
      {leadingIcon && (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {leadingIcon}
        </div>
      )}
      {isDate && (
        <span className="pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 text-base font-medium text-foreground/70 transition-opacity data-[filled=true]:opacity-0"
              data-filled={value ? "true" : "false"}>
          {label}{required ? " *" : ""}
        </span>
      )}
      <Input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        type={type}
        min={min}
        placeholder={placeholder ?? `${label}${required ? " *" : ""}`}
        inputMode={inputMode}
        maxLength={maxLength}
        max={max}
        className={`h-12 rounded-xl border-2 border-input bg-background text-base font-medium text-foreground placeholder:font-medium placeholder:text-muted-foreground ${leadingIcon ? "pl-10" : ""} ${isDate && !value ? "text-transparent" : ""}`}
      />
    </div>
  );
}

function OptionCard({
  selected,
  onClick,
  icon,
  label,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
        selected
          ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-sm"
          : "border-border/70 bg-background/40 hover:border-border hover:bg-background/70"
      }`}
    >
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors ${
          selected
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground group-hover:bg-muted/80"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-tight">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {selected && (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
      )}
    </button>
  );
}

function SegButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 min-w-[3rem] rounded-xl border px-4 text-sm font-semibold transition-all ${
        selected
          ? "border-primary bg-primary/15 text-foreground ring-2 ring-primary/30"
          : "border-border/70 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function CarrierGrid({
  options,
  topOptions,
  value,
  onChange,
}: {
  options: string[];
  topOptions?: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = topOptions
    ? expanded
      ? options
      : Array.from(
          new Set([
            ...topOptions,
            ...(options.includes("Other") ? ["Other"] : []),
            ...(options.includes("None") ? ["None"] : []),
            ...(value && !topOptions.includes(value) ? [value] : []),
          ]),
        )
    : options;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((opt) => {
          const selected = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                selected
                  ? "border-primary bg-primary/12 text-foreground ring-2 ring-primary/25"
                  : "border-border/70 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {topOptions && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-medium text-primary hover:underline"
        >
          Show all carriers…
        </button>
      )}
    </div>
  );
}

function SectionHeader({
  number,
  label,
  icon,
  valid,
}: {
  number: string;
  label: string;
  icon: React.ReactNode;
  valid: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
        {number}
      </span>
      <span className="text-muted-foreground/70">{icon}</span>
      <h2 className="text-base font-semibold tracking-tight text-foreground">{label}</h2>
      {valid && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-brand">
          <CheckCircle2 className="h-3 w-3" /> Done
        </span>
      )}
      <div className="ml-2 h-px flex-1 bg-border/40" />
    </div>
  );
}
