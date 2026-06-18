import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  checkPhoneForLitigator,
  logVendorPostRejection,
} from "@/lib/litigator-check.server";

const LeadPostSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(32),
  state: z.string().trim().length(2),
  current_carrier: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255).optional().nullable(),
  date_of_birth: z.string().trim().optional().nullable(),
  street: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  zip: z.string().trim().max(20).optional().nullable(),
  county: z.string().trim().max(100).optional().nullable(),
  num_vehicles: z.coerce.number().int().min(0).max(20).optional().nullable(),
  vehicles: z.array(z.object({
    year: z.string().or(z.number()).optional(),
    make: z.string().optional(),
    model: z.string().optional(),
  })).max(20).optional(),
  current_home_carrier: z.string().trim().max(100).optional().nullable(),
  housing_status: z.string().trim().max(40).optional().nullable(),
  lead_types: z.array(z.string().min(1).max(40)).max(10).optional(),
  vendor_notes: z.string().trim().max(2000).optional().nullable(),
  lead_source: z
    .enum(["internet", "referral", "cold_call", "live_transfer", "other"])
    .optional(),
}).passthrough();

function normalizeHousingStatus(
  v: string | null | undefined,
): "homeowner" | "renter" | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["homeowner", "owner", "own", "home", "h", "true", "yes"].includes(s)) return "homeowner";
  if (["renter", "rent", "tenant", "r"].includes(s)) return "renter";
  return null;
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  } as Record<string, string>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

export const Route = createFileRoute("/api/public/leads/post/$token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),

      POST: async ({ request, params }) => {
        const token = (params.token || "").trim();
        if (!token || token.length < 16) return json({ error: "Invalid token" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tok, error: tokErr } = await supabaseAdmin
          .from("vendor_post_tokens")
          .select("id, vendor_id, active, destination, label")
          .eq("token", token)
          .maybeSingle();
        if (tokErr) return json({ error: "Server error" }, 500);
        if (!tok || !tok.active) return json({ error: "Invalid or inactive token" }, 401);

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          await logVendorPostRejection({
            vendorId: tok.vendor_id,
            tokenId: tok.id,
            endpoint: "leads/post",
            reason: "Invalid JSON body",
          });
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = LeadPostSchema.safeParse(payload);
        if (!parsed.success) {
          await logVendorPostRejection({
            vendorId: tok.vendor_id,
            tokenId: tok.id,
            endpoint: "leads/post",
            reason: "Validation failed",
            phone: (payload as any)?.phone ?? null,
            firstName: (payload as any)?.first_name ?? null,
            lastName: (payload as any)?.last_name ?? null,
            details: { fieldErrors: parsed.error.flatten().fieldErrors },
          });
          return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
        }
        const d = parsed.data;

        const phone = digitsOnly(d.phone);
        if (phone.length !== 10) {
          await logVendorPostRejection({
            vendorId: tok.vendor_id,
            tokenId: tok.id,
            endpoint: "leads/post",
            reason: "Phone must be 10-digit US number",
            phone: d.phone,
            firstName: d.first_name,
            lastName: d.last_name,
          });
          return json({ error: "phone must be a 10-digit US number" }, 400);
        }

        // TCPA litigator check — block before persisting.
        const lit = await checkPhoneForLitigator(phone);
        if (lit.error) {
          await logVendorPostRejection({
            vendorId: tok.vendor_id,
            tokenId: tok.id,
            endpoint: "leads/post",
            reason: `Litigator check unavailable: ${lit.error}`,
            phone,
            firstName: d.first_name,
            lastName: d.last_name,
          });
          return json(
            {
              error:
                "Lead ingest temporarily paused: litigator scrub unavailable. Admins have been notified.",
              retry: true,
            },
            503,
          );
        }
        if (lit.isLitigator) {
          await logVendorPostRejection({
            vendorId: tok.vendor_id,
            tokenId: tok.id,
            endpoint: "leads/post",
            reason: "TCPA litigator",
            phone,
            firstName: d.first_name,
            lastName: d.last_name,
            details: { cached: lit.cached },
          });
          return json(
            { error: "Phone is on the TCPA litigator list — lead rejected", phone },
            422,
          );
        }

        // Normalize vehicles: drop placeholder rows where year/make/model
        // are all blank. TMax (and possibly others) post `num_vehicles: 2`
        // with an empty or all-empty-strings `vehicles` array, which left
        // agents seeing a "2-car lead" badge with 0 cars listed.
        const rawVehicles = Array.isArray(d.vehicles) ? d.vehicles : [];
        const isBlank = (s: unknown) =>
          s == null || (typeof s === "string" && s.trim() === "");
        const rawTop = (payload ?? {}) as Record<string, unknown>;

        // Many vendors post vehicles using flat top-level keys instead of
        // a structured `vehicles` array — e.g. `vehicle1_year`,
        // `vehicle_make_1`, `auto2_model`, or just `vehicle_year`/`auto_make`
        // for a single car. Fold those aliases into the array before
        // cleaning so year/make/model actually land on the lead.
        const PART_RE = /^(?:vehicle|veh|auto|car)[_-]?(\d{1,2})?[_-]?(year|make|model)$/i;
        const ALT_PART_RE = /^(year|make|model)[_-]?(?:vehicle|veh|auto|car)[_-]?(\d{1,2})?$/i;
        const flatByIndex = new Map<number, { year?: string; make?: string; model?: string }>();
        let sawFlatAlias = false;
        for (const [k, v] of Object.entries(rawTop)) {
          if (v == null) continue;
          const str = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
          if (!str.trim()) continue;
          let m = k.match(PART_RE);
          let idx: number;
          let part: "year" | "make" | "model";
          if (m) {
            idx = m[1] ? Math.max(1, Math.min(20, parseInt(m[1], 10))) : 1;
            part = m[2].toLowerCase() as "year" | "make" | "model";
          } else {
            m = k.match(ALT_PART_RE);
            if (!m) continue;
            idx = m[2] ? Math.max(1, Math.min(20, parseInt(m[2], 10))) : 1;
            part = m[1].toLowerCase() as "year" | "make" | "model";
          }
          sawFlatAlias = true;
          const slot = flatByIndex.get(idx) ?? {};
          if (!slot[part]) slot[part] = str.trim();
          flatByIndex.set(idx, slot);
        }
        // Merge: array entries win, flat aliases fill missing slots.
        const maxIdx = Math.max(
          rawVehicles.length,
          ...Array.from(flatByIndex.keys()),
          0,
        );
        const mergedVehicles: Array<{ year: unknown; make?: string; model?: string }> = [];
        for (let i = 0; i < maxIdx; i++) {
          const fromArr = rawVehicles[i] ?? {};
          const fromFlat = flatByIndex.get(i + 1) ?? {};
          mergedVehicles.push({
            year: !isBlank(fromArr.year) ? fromArr.year : fromFlat.year,
            make: !isBlank(fromArr.make) ? fromArr.make : fromFlat.make,
            model: !isBlank(fromArr.model) ? fromArr.model : fromFlat.model,
          });
        }
        const cleanedVehicles = mergedVehicles
          .map((v) => ({
            year: typeof v.year === "number" ? String(v.year) : (v.year ?? ""),
            make: v.make ?? "",
            model: v.model ?? "",
          }))
          .filter((v) => !(isBlank(v.year) && isBlank(v.make) && isBlank(v.model)));

        // vehicles array wins when it has real entries; otherwise honour
        // the vendor's posted count but persist an empty array (no
        // placeholder rows).
        // Some vendors (notably TMax) post the auto count under a
        // non-standard key instead of `num_vehicles`. Look in a handful of
        // common aliases before giving up so we don't silently store 0.
        const raw = rawTop;
        const ALT_COUNT_KEYS = [
          "num_vehicles",
          "vehicle_count",
          "vehicles_count",
          "num_autos",
          "auto_count",
          "autos",
          "cars",
          "num_cars",
          "car_count",
          "number_of_vehicles",
          "number_of_cars",
          "num_drivers",
        ];
        let altCount: number | null = null;
        let altCountKey: string | null = null;
        for (const k of ALT_COUNT_KEYS) {
          const v = raw[k];
          const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
          if (Number.isFinite(n) && n > 0 && n <= 20) {
            altCount = Math.floor(n);
            altCountKey = k;
            break;
          }
        }
        const tokenLabel = String((tok as { label?: string | null }).label ?? "").toLowerCase();
        const isTmax =
          tok.vendor_id === "c6e39510-73cd-4945-bad9-6b0d290725b7" ||
          tokenLabel.includes("tmax") ||
          tokenLabel.includes("t max");
        const postedCount = d.num_vehicles ?? altCount ?? null;
        const vendorDefaultCount = isTmax ? Math.max(postedCount ?? 0, 2) : postedCount;
        const finalVehicles = cleanedVehicles;
        const finalNumVehicles =
          cleanedVehicles.length > 0 ? cleanedVehicles.length : vendorDefaultCount;

        // Non-blocking audit: log when vendor's count disagrees with the
        // itemized list so we can follow up on bad feeds without rejecting
        // the lead.
        const postedHadItems = rawVehicles.length > 0;
        if (
          postedCount != null &&
          (postedCount !== cleanedVehicles.length) &&
          (postedHadItems || postedCount > 0)
        ) {
          await logVendorPostRejection({
            vendorId: tok.vendor_id,
            tokenId: tok.id,
            endpoint: "leads/post",
            reason: "Vehicle count / list mismatch (lead still ingested)",
            phone,
            firstName: d.first_name,
            lastName: d.last_name,
            details: {
              posted_num_vehicles: postedCount,
              posted_vehicles_length: rawVehicles.length,
              cleaned_vehicles_length: cleanedVehicles.length,
              alt_count_key: altCountKey,
            },
          });
        }

        // Diagnostic: when we still end up with 0/null cars, capture the
        // raw payload key list so we can see what the vendor is actually
        // sending (especially TMax). Non-blocking — lead still ingests.
        if (!finalNumVehicles || finalNumVehicles <= 0) {
          await logVendorPostRejection({
            vendorId: tok.vendor_id,
            tokenId: tok.id,
            endpoint: "leads/post",
            reason: sawFlatAlias
              ? "Audit: flat vehicle aliases present but unparsed (lead still ingested)"
              : "Audit: zero vehicles ingested (lead still ingested)",
            phone,
            firstName: d.first_name,
            lastName: d.last_name,
            details: {
              payload_keys: Object.keys(raw),
              posted_num_vehicles: d.num_vehicles ?? null,
              vendor_default_count: vendorDefaultCount,
              alt_count_key: altCountKey,
              raw_vehicles_length: rawVehicles.length,
              flat_alias_seen: sawFlatAlias,
              flat_alias_indices: Array.from(flatByIndex.keys()),
              // Snapshot a few numeric-ish fields so we can spot the
              // vendor's count field on the next inbound lead.
              numeric_fields: Object.fromEntries(
                Object.entries(raw).filter(([, v]) => {
                  const n = typeof v === "number" ? v : Number(v);
                  return Number.isFinite(n);
                }),
              ),
            },
          });
        }

        const lead_types =
          d.lead_types && d.lead_types.length > 0 ? d.lead_types : ["auto"];

        const destination = (tok as any).destination === "live" ? "live" : "shark_tank";

        const baseRow = {
          vendor_id: tok.vendor_id,
          first_name: d.first_name,
          last_name: d.last_name,
          phone,
          email: d.email || null,
          date_of_birth: d.date_of_birth || null,
          street: d.street || "",
          city: d.city || "",
          state: d.state.toUpperCase(),
          zip: d.zip || "",
          county: d.county || "",
          current_carrier: d.current_carrier,
          current_home_carrier: d.current_home_carrier || null,
          num_vehicles: finalNumVehicles,
          vehicles: finalVehicles,
          vendor_notes: d.vendor_notes || null,
          housing_status: normalizeHousingStatus(d.housing_status),
          lead_types,
          lead_source: d.lead_source ?? "internet",
        };

        const targetTable = destination === "live" ? "leads" : "list_leads";
        const insertRow =
          destination === "live"
            ? baseRow
            : { ...baseRow, list_type: "vendor_post" };

        const { data: lead, error: insErr } = await supabaseAdmin
          .from(targetTable)
          .insert(insertRow as any)
          .select("id, created_at, composite_score, score_tier")
          .single();

        if (insErr) {
          console.warn("[leads/post] insert failed", {
            vendor_id: tok.vendor_id,
            token_id: tok.id,
            message: insErr.message,
          });
          await logVendorPostRejection({
            vendorId: tok.vendor_id,
            tokenId: tok.id,
            endpoint: "leads/post",
            reason: "Database insert failed",
            phone,
            firstName: d.first_name,
            lastName: d.last_name,
            details: { message: insErr.message },
          });
          return json({ error: "Failed to create lead", details: insErr.message }, 400);
        }

        const { data: cur } = await supabaseAdmin
          .from("vendor_post_tokens")
          .select("post_count")
          .eq("id", tok.id)
          .single();
        await supabaseAdmin
          .from("vendor_post_tokens")
          .update({
            last_used_at: new Date().toISOString(),
            post_count: (cur?.post_count ?? 0) + 1,
          })
          .eq("id", tok.id);

        return json({
          ok: true,
          lead_id: lead.id,
          destination,
          created_at: lead.created_at,
          score: lead.composite_score,
          tier: lead.score_tier,
        }, 201);
      },
    },
  },
});