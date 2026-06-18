import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CACHE_TTL_DAYS = 30;

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

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export const checkLitigator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ phone: z.string().min(7).max(20) }).parse)
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId?: string };
    if (userId) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("bypass_litigator")
        .eq("id", userId)
        .maybeSingle();
      const bypass = (prof as { bypass_litigator?: boolean } | null)?.bypass_litigator === true;
      if (bypass) {
        return { is_litigator: false, bypassed: true };
      }
    }

    const phone = normalizePhone(data.phone);
    if (phone.length !== 10) {
      return { is_litigator: false, error: "Phone must be a 10-digit US number" };
    }

    const { data: cached } = await supabaseAdmin
      .from("litigator_cache")
      .select("is_litigator, checked_at")
      .eq("phone", phone)
      .maybeSingle();

    if (cached) {
      const ageMs = Date.now() - new Date(cached.checked_at).getTime();
      if (ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
        if (cached.is_litigator && userId) {
          await supabaseAdmin
            .from("profiles")
            .update({
              frozen: true,
              frozen_reason: `Account frozen — submitted TCPA litigator number ${phone}.`,
              frozen_at: new Date().toISOString(),
            })
            .eq("id", userId);
        }
        return { is_litigator: cached.is_litigator, cached: true };
      }
    }

    const apiKey = process.env.TRESTLE_API_KEY;
    if (!apiKey) {
      console.error("TRESTLE_API_KEY not configured");
      await alertAdmins(
        "litigator_key_missing",
        "Litigator scrub disabled: TRESTLE_API_KEY not configured",
        { phone },
      );
      return { is_litigator: false, error: "Litigator check unavailable" };
    }

    try {
      const url = `https://api.trestleiq.com/3.0/phone_intel?phone=${phone}&add_ons=litigator_checks`;
      const res = await fetch(url, { headers: { "x-api-key": apiKey } });
      const json: any = await res.json();

      if (!res.ok) {
        console.warn("Trestle litigator check error:", res.status, json);
        await alertAdmins(
          "litigator_api_failure",
          `Litigator scrub failing (HTTP ${res.status})`,
          { phone, status: res.status, response: json },
        );
        return { is_litigator: false, error: `Litigator check unavailable (${res.status})` };
      }

      const isLitigator =
        json?.add_ons?.litigator_checks?.["phone.is_litigator_risk"] === true;

      await supabaseAdmin
        .from("litigator_cache")
        .upsert({
          phone,
          is_litigator: isLitigator,
          raw_response: json,
          checked_at: new Date().toISOString(),
        });

      await clearLitigatorAlerts();

      if (isLitigator && userId) {
        await supabaseAdmin
          .from("profiles")
          .update({
            frozen: true,
            frozen_reason: `Account frozen — submitted TCPA litigator number ${phone}.`,
            frozen_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }

      return { is_litigator: isLitigator, cached: false };
    } catch (err) {
      console.error("Trestle litigator check failed:", err);
      await alertAdmins(
        "litigator_api_failure",
        "Litigator scrub failing: fetch threw",
        { phone, error: String((err as Error)?.message ?? err) },
      );
      return { is_litigator: false, error: "Litigator check failed" };
    }
  });

/**
 * Bulk-check a list of phone numbers against the TCPA litigator list.
 * Uses the cache, then fetches misses from Trestle. Returns the set of
 * phones (normalized 10-digit) that came back as litigators. Also
 * persists results in the cache. Caller is responsible for flagging
 * rows in `leads` / `list_leads`.
 */
export const bulkCheckLitigators = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ phones: z.array(z.string()).max(10000) }).parse)
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId?: string };

    // Respect per-vendor bypass.
    if (userId) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("bypass_litigator")
        .eq("id", userId)
        .maybeSingle();
      if ((prof as { bypass_litigator?: boolean } | null)?.bypass_litigator === true) {
        return { hits: [] as string[], bypassed: true, checked: 0 };
      }
    }

    const normalized = Array.from(
      new Set(
        data.phones
          .map((p) => normalizePhone(p))
          .filter((p) => p.length === 10),
      ),
    );
    if (normalized.length === 0) return { hits: [] as string[], checked: 0 };

    const hits = new Set<string>();
    const cacheCutoffMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

    // 1) Look up cached results.
    const { data: cached } = await supabaseAdmin
      .from("litigator_cache")
      .select("phone, is_litigator, checked_at")
      .in("phone", normalized);
    const cachedFresh = new Map<string, boolean>();
    for (const row of cached ?? []) {
      const age = Date.now() - new Date(row.checked_at as string).getTime();
      if (age < cacheCutoffMs) {
        cachedFresh.set(row.phone as string, row.is_litigator as boolean);
        if (row.is_litigator) hits.add(row.phone as string);
      }
    }

    const toFetch = normalized.filter((p) => !cachedFresh.has(p));
    const apiKey = process.env.TRESTLE_API_KEY;
    if (apiKey && toFetch.length > 0) {
      const CONCURRENCY = 10;
      let cursor = 0;
      const upserts: { phone: string; is_litigator: boolean; raw_response: any; checked_at: string }[] = [];

      async function worker() {
        while (cursor < toFetch.length) {
          const i = cursor++;
          const phone = toFetch[i];
          try {
            const res = await fetch(
              `https://api.trestleiq.com/3.0/phone_intel?phone=${phone}&add_ons=litigator_checks`,
              { headers: { "x-api-key": apiKey! } },
            );
            const json: any = await res.json().catch(() => ({}));
            if (!res.ok) {
              console.warn("Trestle bulk error", phone, res.status);
              continue;
            }
            const isLit =
              json?.add_ons?.litigator_checks?.["phone.is_litigator_risk"] === true;
            upserts.push({
              phone,
              is_litigator: isLit,
              raw_response: json,
              checked_at: new Date().toISOString(),
            });
            if (isLit) hits.add(phone);
          } catch (err) {
            console.error("Trestle bulk fetch failed", phone, err);
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (upserts.length > 0) {
        await supabaseAdmin.from("litigator_cache").upsert(upserts);
      }
    } else if (!apiKey) {
      console.error("TRESTLE_API_KEY not configured");
    }

    // Freeze the uploader on any hit.
    if (hits.size > 0 && userId) {
      const list = Array.from(hits).slice(0, 5).join(", ");
      await supabaseAdmin
        .from("profiles")
        .update({
          frozen: true,
          frozen_reason: `Account frozen — submitted TCPA litigator number(s): ${list}.`,
          frozen_at: new Date().toISOString(),
        })
        .eq("id", userId);
    }

    return { hits: Array.from(hits), checked: normalized.length };
  });