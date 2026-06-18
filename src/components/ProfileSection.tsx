import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2, Upload, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  direct_phone: string | null;
  avatar_url: string | null;
};

export function ProfileSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Profile | null>({
    queryKey: ["my_profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return null;
      const { data } = await supabase
        .from("profiles" as never)
        .select("id,full_name,email,direct_phone,avatar_url")
        .eq("id", uid)
        .maybeSingle();
      return (data ?? null) as Profile | null;
    },
  });

  const [draft, setDraft] = useState<Profile | null>(null);
  const [savedProfile, setSavedProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;

    setSavedProfile(data);
    setDraft((current) => current ?? data);
  }, [data]);

  if (isLoading || !draft) {
    return (
      <Card>
        <CardHeader><CardTitle>My profile</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedProfile);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("profiles" as never)
      .update({
        full_name: draft.full_name?.trim() || null,
        direct_phone: draft.direct_phone?.trim() || null,
      } as never)
      .eq("id", draft.id);
    setSaving(false);
    if (error) { toast.error(error.message || "Failed to save"); return; }
    const normalizedDraft: Profile = {
      ...draft,
      full_name: draft.full_name?.trim() || null,
      direct_phone: draft.direct_phone?.trim() || null,
    };
    setDraft(normalizedDraft);
    setSavedProfile(normalizedDraft);
    toast.success("Profile updated");
    qc.invalidateQueries({ queryKey: ["my_profile"] });
    qc.invalidateQueries({ queryKey: ["call_guide_agent"] });
  };

  const uploadHeadshot = async (file: File) => {
    if (!draft) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be 5 MB or smaller");
      return;
    }
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${draft.id}/headshot-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setUploading(false);
      toast.error(upErr.message || "Upload failed");
      return;
    }
    // Best-effort cleanup of any previous file.
    if (draft.avatar_url && draft.avatar_url !== path) {
      await supabase.storage.from("avatars").remove([draft.avatar_url]);
    }
    const { error } = await supabase
      .from("profiles" as never)
      .update({ avatar_url: path } as never)
      .eq("id", draft.id);
    setUploading(false);
    if (error) { toast.error(error.message || "Failed to save photo"); return; }
    toast.success("Headshot updated");
    setDraft((d) => (d ? { ...d, avatar_url: path } : d));
    setSavedProfile((d) => (d ? { ...d, avatar_url: path } : d));
    qc.invalidateQueries({ queryKey: ["my_profile"] });
    qc.invalidateQueries({ queryKey: ["agent_avatar_paths"] });
  };

  const removeHeadshot = async () => {
    if (!draft?.avatar_url) return;
    setUploading(true);
    await supabase.storage.from("avatars").remove([draft.avatar_url]);
    const { error } = await supabase
      .from("profiles" as never)
      .update({ avatar_url: null } as never)
      .eq("id", draft.id);
    setUploading(false);
    if (error) { toast.error(error.message || "Failed to remove photo"); return; }
    toast.success("Headshot removed");
    setDraft((d) => (d ? { ...d, avatar_url: null } : d));
    setSavedProfile((d) => (d ? { ...d, avatar_url: null } : d));
    qc.invalidateQueries({ queryKey: ["my_profile"] });
    qc.invalidateQueries({ queryKey: ["agent_avatar_paths"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><User className="h-4 w-4" /> My profile</CardTitle>
        <CardDescription>
          These details are merged into your call scripts (e.g. “this is {`[Agent]`} calling from…
          give me a call back at {`[Phone]`}”).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 flex items-center gap-4 rounded-md border bg-muted/30 p-3">
          <AgentAvatar name={draft.full_name} path={draft.avatar_url} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Headshot</div>
            <p className="text-xs text-muted-foreground">
              Shown next to your name on leaderboards and across the app. Square images
              work best. If you don't upload one, your initials are used instead.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                )}
                {draft.avatar_url ? "Replace photo" : "Upload photo"}
              </Button>
              {draft.avatar_url && (
                <Button size="sm" variant="ghost" onClick={removeHeadshot} disabled={uploading}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadHeadshot(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf_name">Your name</Label>
          <Input
            id="pf_name"
            value={draft.full_name ?? ""}
            onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
            placeholder="Jane Doe"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf_email">Email</Label>
          <Input id="pf_email" value={draft.email ?? ""} disabled />
          <p className="text-xs text-muted-foreground">Managed by your sign-in account.</p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pf_phone">Direct line</Label>
          <Input
            id="pf_phone"
            value={draft.direct_phone ?? ""}
            onChange={(e) => setDraft({ ...draft, direct_phone: e.target.value })}
            placeholder="(555) 555-5555"
          />
          <p className="text-xs text-muted-foreground">
            Used as your callback number in scripts. If blank, scripts show
            <span className="mx-1 rounded bg-muted px-1 font-mono text-[11px]">(your number)</span>
            instead of a fake number.
          </p>
        </div>
        <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => setDraft(savedProfile!)} disabled={!dirty || saving}>Reset</Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}