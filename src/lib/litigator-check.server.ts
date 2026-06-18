// Server-only helper: checks whether a phone number is on the TCPA
// litigator list. Uses the litigator_cache table and falls back to
// Trestle when the cache row is missing or stale. No auth required —
// public API ingest endpoints call this before persisting a lead.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CACHE_TTL_DAYS = 30;

/**
 * Raise an admin-visible alert about litigator-scrub infrastructure
 * problems. Deduped: if there's already an unresolved alert of the
 * same kind in the last hour, we don't insert another row.
 */
async function alertAdmins(
  kind: "litigator_key_missing" | "litigator_api_failure",
  title: string,
  body: Record<string, unknown>,
) {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from("ai_alerts")
      .select("id")
      .eq("kind", kind)
      .is("resolved_at", null)
      .gte("created_at", oneHourAgo)
      .limit(1)
      .maybeSingle();
    if (existing) return;
    await supabaseAdmin.from("ai_alerts").insert({
      kind,
      severity: "critical",
      title,
      body: body as any,
    });
  } catch (err) {
    console.error("[litigator] failed to raise admin alert", err);
  }
}

/** Resolve any open litigator-infra alerts after a successful call. */
async function clearLitigatorAlerts() {
  try {
    await supabaseAdmin
      .from("ai_alerts")
      .update({ resolved_at: new Date().toISOString() })
      .in("kind", ["litigator_key_missing", "litigator_api_failure"])
      .is("resolved_at", null);
  } catch {
    /* non-fatal */
  }
}

export function normalizePhone(input: string): string {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export type LitigatorCheckResult = {
  isLitigator: boolean;
  cached: boolean;
  /** Set when the lookup itself failed; treat as "unknown, allow". */
  error?: string;
};

export async function checkPhoneForLitigator(rawPhone: string): Promise<LitigatorCheckResult> {
  const phone = normalizePhone(rawPhone);
  if (phone.length !== 10) {
    return { isLitigator: false, cached: false, error: "Phone must be a 10-digit US number" };
  }

  const { data: cached } = await supabaseAdmin
    .from("litigator_cache")
    .select("is_litigator, checked_at")
    .eq("phone", phone)
    .maybeSingle();

  if (cached) {
    const ageMs = Date.now() - new Date(cached.checked_at as string).getTime();
    if (ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      return { isLitigator: !!cached.is_litigator, cached: true };
    }
  }

  const apiKey = process.env.TRESTLE_API_KEY;
  if (!apiKey) {
    console.warn("[litigator] TRESTLE_API_KEY not configured; skipping live check");
    await alertAdmins(
      "litigator_key_missing",
      "Litigator scrub disabled: TRESTLE_API_KEY not configured",
      { phone },
    );
    return { isLitigator: false, cached: false, error: "Litigator check unavailable" };
  }

  try {
    const url = `https://api.trestleiq.com/3.0/phone_intel?phone=${phone}&add_ons=litigator_checks`;
    const res = await fetch(url, { headers: { "x-api-key": apiKey } });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("[litigator] Trestle error", res.status, json);
      await alertAdmins(
        "litigator_api_failure",
        `Litigator scrub failing (HTTP ${res.status})`,
        { phone, status: res.status, response: json },
      );
      return { isLitigator: false, cached: false, error: `Litigator check unavailable (${res.status})` };
    }

    const isLitigator =
      json?.add_ons?.litigator_checks?.["phone.is_litigator_risk"] === true;

    await supabaseAdmin.from("litigator_cache").upsert({
      phone,
      is_litigator: isLitigator,
      raw_response: json,
      checked_at: new Date().toISOString(),
    });

    await clearLitigatorAlerts();
    return { isLitigator, cached: false };
  } catch (err) {
    console.error("[litigator] fetch failed", err);
    await alertAdmins(
      "litigator_api_failure",
      "Litigator scrub failing: fetch threw",
      { phone, error: String((err as Error)?.message ?? err) },
    );
    return { isLitigator: false, cached: false, error: "Litigator check failed" };
  }
}

export async function logVendorPostRejection(args: {
  vendorId: string | null;
  tokenId: string | null;
  endpoint: string;
  reason: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    await supabaseAdmin.from("vendor_post_rejections").insert({
      vendor_id: args.vendorId,
      token_id: args.tokenId,
      endpoint: args.endpoint,
      reason: args.reason,
      phone: args.phone ?? null,
      first_name: args.firstName ?? null,
      last_name: args.lastName ?? null,
      details: (args.details ?? {}) as any,
    });
  } catch (err) {
    console.error("[vendor-post-rejection] failed to log", err);
  }
}