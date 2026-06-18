import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function initialsOf(name?: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || n[0].toUpperCase();
}

// Deterministic color from name so each agent has a consistent fallback tint.
function hueOf(name?: string | null): number {
  const s = (name ?? "?").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function useSignedAvatar(path: string | null | undefined) {
  return useQuery<string | null>({
    queryKey: ["avatar_signed_url", path ?? ""],
    enabled: !!path,
    staleTime: 50 * 60_000,
    gcTime: 60 * 60_000,
    queryFn: async () => {
      if (!path) return null;
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrl(path, 60 * 60);
      return data?.signedUrl ?? null;
    },
  });
}

const SIZE_CLASSES: Record<string, string> = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
  xl: "h-16 w-16 text-base",
};

export type AgentAvatarSize = keyof typeof SIZE_CLASSES;

export type AgentStatus =
  | "on_call"
  | "available"
  | "meeting"
  | "lunch"
  | "break"
  | "dnd"
  | "idle"
  | "offline";

const STATUS_RING: Record<AgentStatus, string> = {
  on_call: "ring-emerald-400 shadow-[0_0_0_2px_hsl(var(--background)),0_0_10px_rgba(52,211,153,0.6)]",
  available: "ring-emerald-500/80",
  meeting: "ring-sky-400",
  lunch: "ring-amber-400",
  break: "ring-amber-400",
  dnd: "ring-rose-500",
  idle: "ring-zinc-400/70",
  offline: "ring-muted-foreground/30",
};

export function AgentAvatar({
  name,
  path,
  signedUrl,
  size = "sm",
  className,
  status,
}: {
  name?: string | null;
  /** Storage object path inside the `avatars` bucket, e.g. "<uid>/headshot.png". */
  path?: string | null;
  /** Pre-resolved signed URL — skips the async signing fetch when provided. */
  signedUrl?: string | null;
  size?: AgentAvatarSize;
  className?: string;
  /** Optional status ring color around the avatar. */
  status?: AgentStatus | null;
}) {
  const { data: fetched } = useSignedAvatar(signedUrl ? null : path);
  const url = signedUrl ?? fetched;
  const hue = hueOf(name);
  const fallbackStyle = {
    backgroundColor: `hsl(${hue} 60% 85%)`,
    color: `hsl(${hue} 70% 25%)`,
  };
  const ring = status ? `ring-2 ring-offset-2 ring-offset-background ${STATUS_RING[status]}` : "";
  return (
    <Avatar className={cn("shrink-0", SIZE_CLASSES[size], ring, className)}>
      {url ? <AvatarImage src={url} alt={name ?? "Agent"} /> : null}
      <AvatarFallback style={fallbackStyle} className="font-semibold">
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}