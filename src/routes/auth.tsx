import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Shield, Upload, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listVendorCompanies } from "@/lib/vendors.functions";
import { resolveInviteToken } from "@/lib/vendor-team.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — LeadVault" },
      { name: "description", content: "Sign in or request vendor access to LeadVault." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { invite } = useSearch({ from: "/auth" });
  useEffect(() => {
    if (!loading && user) navigate({ to: "/", replace: true });
  }, [user, loading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-sidebar-foreground">
          <Shield className="h-7 w-7 text-sidebar-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">LeadVault</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Account access</CardTitle>
            <CardDescription>
              Vendors and sales agents sign in here. New vendors can request access — an admin will approve your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={invite ? "signup" : "signin"}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">{invite ? "Accept invite" : "Request access"}</TabsTrigger>
              </TabsList>
              <TabsContent value="signin">
                <SignInForm />
              </TabsContent>
              <TabsContent value="signup">
                <SignUpForm inviteToken={invite} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) toast.error(error.message);
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = resetEmail.trim();
    if (!trimmed || trimmed.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address");
      return;
    }
    setResetSubmitting(true);
    await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetSubmitting(false);
    // Always show generic success to avoid leaking which emails are registered.
    toast.success("If that email exists, a reset link has been sent.");
    setShowForgot(false);
    setResetEmail("");
  };

  if (showForgot) {
    return (
      <form onSubmit={handleForgot} className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">
          Enter your account email and we'll send a password reset link.
        </p>
        <div className="space-y-2">
          <Label htmlFor="fp-email">Email</Label>
          <Input
            id="fp-email"
            type="email"
            required
            maxLength={255}
            value={resetEmail}
            onChange={(e) => setResetEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <Button type="submit" className="w-full" disabled={resetSubmitting}>
          {resetSubmitting ? "Sending…" : "Send reset link"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => setShowForgot(false)}
        >
          Back to sign in
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="si-email">Email</Label>
        <Input id="si-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="si-password">Password</Label>
        <Input id="si-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
      <button
        type="button"
        onClick={() => {
          setResetEmail(email);
          setShowForgot(true);
        }}
        className="block w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Forgot your password?
      </button>
    </form>
  );
}

function SignUpForm({ inviteToken }: { inviteToken?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [requestedRole, setRequestedRole] = useState<"vendor" | "sales" | "telemarketer">("vendor");
  const [submitting, setSubmitting] = useState(false);
  const [vendorMode, setVendorMode] = useState<"existing" | "new">("new");
  const [existingVendor, setExistingVendor] = useState("");
  const [directPhone, setDirectPhone] = useState("");
  const [headshot, setHeadshot] = useState<File | null>(null);
  const [headshotPreview, setHeadshotPreview] = useState<string | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  const isSalesAgent = requestedRole === "sales" && !inviteToken;
  const phoneDigits = directPhone.replace(/\D/g, "");
  const phoneValid = phoneDigits.length >= 10;
  const salesProfileComplete =
    !isSalesAgent || (!!headshot && phoneValid && !!dateOfBirth && !!startDate);
  const todayIso = new Date().toISOString().slice(0, 10);

  const handleHeadshotChange = (file: File | null) => {
    if (!file) {
      setHeadshot(null);
      setHeadshotPreview(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Headshot must be an image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Headshot must be under 5MB");
      return;
    }
    setHeadshot(file);
    setHeadshotPreview(URL.createObjectURL(file));
  };

  const fetchVendorCompanies = useServerFn(listVendorCompanies);
  const { data: vendorList } = useQuery({
    queryKey: ["vendor-companies"],
    queryFn: () => fetchVendorCompanies(),
    staleTime: 60_000,
  });

  const resolveInvite = useServerFn(resolveInviteToken);
  const { data: inviteInfo } = useQuery({
    queryKey: ["resolve-invite", inviteToken],
    queryFn: () => resolveInvite({ data: { token: inviteToken! } }),
    enabled: !!inviteToken,
    staleTime: 60_000,
  });
  const inviteValid = inviteInfo?.valid === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inviteToken && !inviteValid) {
      toast.error("This invite link is invalid or expired.");
      return;
    }
    if (isSalesAgent) {
      if (!headshot) {
        toast.error("Sales agents must upload a headshot to continue.");
        return;
      }
      if (!phoneValid) {
        toast.error("Enter a valid direct phone line (10+ digits).");
        return;
      }
      if (!dateOfBirth) {
        toast.error("Date of birth is required.");
        return;
      }
      if (!startDate) {
        toast.error("Start date is required.");
        return;
      }
    }
    const effectiveCompany =
      inviteValid
        ? (inviteInfo?.vendor_company ?? "")
        : requestedRole === "vendor" && vendorMode === "existing"
          ? existingVendor
          : company;
    if (!inviteValid && !effectiveCompany.trim()) {
      toast.error("Please select or enter a company");
      return;
    }
    setSubmitting(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName,
          company_name: effectiveCompany,
          requested_role: inviteValid ? "vendor" : requestedRole,
          vendor_invite_token: inviteValid ? inviteToken : undefined,
          direct_phone: isSalesAgent ? directPhone.trim() : undefined,
          date_of_birth: isSalesAgent ? dateOfBirth : undefined,
          start_date: isSalesAgent ? startDate : undefined,
        },
      },
    });
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }

    // For sales agents, persist headshot + direct phone to the profile now
    // that the user (and session) exists.
    if (isSalesAgent && signUpData.user) {
      const userId = signUpData.user.id;
      try {
        const ext = (headshot!.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${userId}/headshot.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, headshot!, { upsert: true, contentType: headshot!.type });
        if (upErr) throw upErr;
        const { error: profErr } = await supabase
          .from("profiles")
          .update({
            avatar_url: path,
            direct_phone: directPhone.trim(),
            date_of_birth: dateOfBirth || null,
            start_date: startDate || null,
          })
          .eq("id", userId);
        if (profErr) throw profErr;
      } catch (err) {
        // Don't block account creation, but warn loudly so they fix it on first login.
        toast.warning(
          "Account created, but your headshot or direct line didn't save. Please update them in Settings after signing in.",
        );
      }
    }
    setSubmitting(false);
    if (inviteValid) {
      toast.success("Account created. You can sign in now.");
    } else {
      // Fire-and-forget admin alert. Don't block the user if it fails.
      fetch('/api/public/notify-access-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          fullName,
          company: effectiveCompany,
          requestedRole,
        }),
      }).catch(() => {});
      toast.success("Account created. Waiting on admin approval.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-4">
      {inviteToken && (
        <div
          className={`rounded-md border p-3 text-sm ${
            inviteValid
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-destructive bg-destructive/10 text-destructive"
          }`}
        >
          {inviteValid
            ? `You're joining ${inviteInfo?.vendor_company} as a team agent. You'll be able to submit leads under their account.`
            : "This invite link is invalid or has expired."}
        </div>
      )}
      {!inviteToken && (
      <div className="space-y-2">
        <Label>I am a…</Label>
        <RadioGroup
          value={requestedRole}
          onValueChange={(v) => setRequestedRole(v as "vendor" | "sales" | "telemarketer")}
          className="grid grid-cols-3 gap-2"
        >
          <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
            <RadioGroupItem value="vendor" id="role-vendor" />
            Call center / vendor
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
            <RadioGroupItem value="sales" id="role-sales" />
            Sales agent
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
            <RadioGroupItem value="telemarketer" id="role-telemarketer" />
            Telemarketer
          </label>
        </RadioGroup>
      </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="su-name">Full name</Label>
        <Input id="su-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      {inviteToken ? null : requestedRole === "vendor" ? (
        <div className="space-y-2">
          <Label>Vendor company</Label>
          <RadioGroup
            value={vendorMode}
            onValueChange={(v) => setVendorMode(v as "existing" | "new")}
            className="grid grid-cols-2 gap-2"
          >
            <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
              <RadioGroupItem value="existing" id="vm-existing" />
              Existing vendor
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm">
              <RadioGroupItem value="new" id="vm-new" />
              New vendor
            </label>
          </RadioGroup>
          {vendorMode === "existing" ? (
            <Select value={existingVendor} onValueChange={setExistingVendor}>
              <SelectTrigger>
                <SelectValue placeholder="Select your vendor company" />
              </SelectTrigger>
              <SelectContent>
                {(vendorList?.companies ?? []).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                {(vendorList?.companies ?? []).length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No vendors yet
                  </div>
                )}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="su-company"
              placeholder="Company / call center name"
              required
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="su-company">Company / agency</Label>
          <Input id="su-company" required value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="su-email">Email</Label>
        <Input id="su-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="su-password">Password</Label>
        <Input id="su-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {isSalesAgent && (
        <div className="space-y-4 rounded-md border-2 border-primary/50 bg-primary/5 p-4">
          <div className="flex items-start gap-2 text-sm font-medium text-primary">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Sales agents must provide a professional headshot and direct phone
              line before submitting. These appear on sale alerts and customer
              touchpoints — accounts without them cannot be approved.
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="su-headshot">
              Headshot photo <span className="text-destructive">*required</span>
            </Label>
            <div className="flex items-center gap-3">
              {headshotPreview ? (
                <img
                  src={headshotPreview}
                  alt="Headshot preview"
                  className="h-16 w-16 rounded-full border object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 bg-background text-muted-foreground">
                  <Upload className="h-5 w-5" />
                </div>
              )}
              <Input
                id="su-headshot"
                type="file"
                accept="image/*"
                required
                onChange={(e) => handleHeadshotChange(e.target.files?.[0] ?? null)}
                className="cursor-pointer"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Clear, well-lit photo of your face. JPG or PNG, under 5MB.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="su-phone">
              Direct phone line <span className="text-destructive">*required</span>
            </Label>
            <Input
              id="su-phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="(555) 123-4567"
              value={directPhone}
              onChange={(e) => setDirectPhone(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The number customers will call you back on. Used on quotes and
              sale notifications.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="su-dob">
                Date of birth <span className="text-destructive">*required</span>
              </Label>
              <Input
                id="su-dob"
                type="date"
                required
                max={todayIso}
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="su-start">
                Start date <span className="text-destructive">*required</span>
              </Label>
              <Input
                id="su-start"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={submitting || !salesProfileComplete}
      >
        {submitting ? "Submitting…" : "Request access"}
      </Button>
      {isSalesAgent && !salesProfileComplete && (
        <p className="text-center text-xs text-muted-foreground">
          Upload a headshot and add your direct phone line to continue.
        </p>
      )}
    </form>
  );
}