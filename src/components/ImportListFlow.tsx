import { useMemo, useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useHasRole } from "@/lib/auth";
import { useServerFn } from "@tanstack/react-start";
import { bulkCheckLitigators } from "@/lib/litigator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { formatPhone } from "@/lib/constants";
import { cn } from "@/lib/utils";

const LIST_TYPES: { value: string; label: string }[] = [
  { value: "winback", label: "Winback" },
  { value: "requote", label: "Requote" },
  { value: "ivantage_no_allstate", label: "iVantage no Allstate" },
  { value: "aged", label: "Aged" },
  { value: "boat_no_home", label: "Boat no Home" },
  { value: "auto_no_home", label: "Auto no Home" },
];

const SHARK_TANK_SIDES: { value: "auto" | "home"; label: string }[] = [
  { value: "auto", label: "Auto Shark Tank" },
  { value: "home", label: "Home Shark Tank" },
];

const IMPORT_BATCH_SIZE = 1000;
const PREVIEW_PAGE_SIZE = 100;
const WORKBOOK_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".numbers"] as const;
const TEXT_EXTENSIONS = [".csv", ".tsv", ".txt"] as const;

type Row = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  date_of_birth: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  current_carrier: string;
  vendor_notes: string;
  agent_notes: string;
  num_vehicles: string;
  vehicles_text: string;
};

const FIELDS: { key: keyof Row; label: string }[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "date_of_birth", label: "DOB" },
  { key: "street", label: "Street" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP" },
  { key: "county", label: "County" },
  { key: "current_carrier", label: "Carrier" },
  { key: "num_vehicles", label: "# Cars" },
  { key: "vehicles_text", label: "Vehicles" },
  { key: "agent_notes", label: "Agent notes" },
  { key: "vendor_notes", label: "Notes" },
];

// Targets selectable in the column-mapping editor. Includes the "__address"
// composite (splits into street/city/state/zip on parse) and an "ignore" option.
const MAP_TARGETS: { value: string; label: string }[] = [
  { value: "__ignore", label: "— Ignore —" },
  { value: "__address", label: "Full address (auto-split)" },
  ...FIELDS.map((f) => ({ value: f.key, label: f.label })),
];

const emptyRow = (): Row => ({
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  date_of_birth: "",
  street: "",
  city: "",
  state: "",
  zip: "",
  county: "",
  current_carrier: "",
  vendor_notes: "",
  agent_notes: "",
  num_vehicles: "",
  vehicles_text: "",
});

// Map common header aliases to our Row keys, or to a special token handled below.
type MapTarget = keyof Row | "__address";
const HEADER_ALIASES: Record<string, MapTarget> = {
  first_name: "first_name", firstname: "first_name", first: "first_name", fname: "first_name", given_name: "first_name",
  insured_first_name: "first_name", first_name_insured: "first_name", insured_first: "first_name", primary_first_name: "first_name", client_first_name: "first_name", customer_first_name: "first_name", insured_fname: "first_name",
  last_name: "last_name", lastname: "last_name", last: "last_name", lname: "last_name", surname: "last_name", family_name: "last_name",
  insured_last_name: "last_name", last_name_insured: "last_name", insured_last: "last_name", primary_last_name: "last_name", client_last_name: "last_name", customer_last_name: "last_name", insured_lname: "last_name",
  name: "first_name",
  insured_name: "first_name", insured_full_name: "first_name", full_name: "first_name", customer_name: "first_name", client_name: "first_name", primary_name: "first_name",
  phone: "phone", phone_number: "phone", phonenumber: "phone", mobile: "phone", cell: "phone", tel: "phone", telephone: "phone", number: "phone",
  dob: "date_of_birth", date_of_birth: "date_of_birth", birthdate: "date_of_birth", birth_date: "date_of_birth", birthday: "date_of_birth",
  dr1_dob: "date_of_birth", driver1_dob: "date_of_birth", driver_1_dob: "date_of_birth", d1_dob: "date_of_birth",
  address: "__address", full_address: "__address", mailing_address: "__address",
  street: "street", street_address: "street", address1: "street", addr: "street", address_1: "street",
  city: "city", town: "city",
  state: "state", st: "state", province: "state", region: "state",
  zip: "zip", zipcode: "zip", zip_code: "zip", postal: "zip", postal_code: "zip", postcode: "zip",
  county: "county",
  carrier: "current_carrier", current_carrier: "current_carrier", insurer: "current_carrier", insurance: "current_carrier", company: "current_carrier",
  current_ins: "current_carrier", current_insurance: "current_carrier", currentcarrier: "current_carrier", prior_carrier: "current_carrier",
  // Generic "notes" columns on these lists are written by agents → treat as agent notes.
  notes: "agent_notes", note: "agent_notes", comment: "agent_notes", comments: "agent_notes",
  agent_comments: "agent_notes", agent_notes: "agent_notes", agent_note: "agent_notes",
  vendor_notes: "vendor_notes", jack_comments: "vendor_notes",
  vehicle: "vehicles_text", vehicles: "vehicles_text",
  vehicle_info: "vehicles_text", vehicle_list: "vehicles_text", vehicle_details: "vehicles_text",
  car_details: "vehicles_text", car_detail: "vehicles_text", car_info: "vehicles_text", car_list: "vehicles_text",
  year_make_model: "vehicles_text", ymm: "vehicles_text", year_make: "vehicles_text", make_model: "vehicles_text",
  cars: "num_vehicles",
  number_of_cars: "num_vehicles", num_vehicles: "num_vehicles", num_cars: "num_vehicles", car_count: "num_vehicles",
  of_cars: "num_vehicles", cars_count: "num_vehicles", vehicle_count: "num_vehicles", autos: "num_vehicles", auto_count: "num_vehicles",
  no_of_cars: "num_vehicles", no_cars: "num_vehicles", num_of_cars: "num_vehicles", count_of_cars: "num_vehicles",
  numcars: "num_vehicles",
  number_of_vehicles: "num_vehicles", number_of_autos: "num_vehicles", total_vehicles: "num_vehicles", total_cars: "num_vehicles",
  no_of_vehicles: "num_vehicles", no_vehicles: "num_vehicles", num_of_vehicles: "num_vehicles", count_of_vehicles: "num_vehicles",
  email: "email", email_address: "email", emailaddress: "email", e_mail: "email", customer_email: "email", client_email: "email",
};

function resolveHeader(header: string): MapTarget | null {
  const direct = HEADER_ALIASES[header];
  if (direct) return direct;

  if (/^(vehicle|car|auto)_\d+$/.test(header)) {
    return "vehicles_text";
  }

  if ((header.includes("detail") || header.includes("info") || header.includes("list")) && (header.includes("car") || header.includes("vehicle") || header.includes("auto"))) {
    return "vehicles_text";
  }

  if ((header.includes("count") || header.includes("number") || header.startsWith("num_") || header.startsWith("no_")) && (header.includes("car") || header.includes("vehicle") || header.includes("auto"))) {
    return "num_vehicles";
  }

  if ((header.endsWith("_cars") || header.endsWith("_vehicles") || header.endsWith("_autos")) && !header.includes("detail") && !header.includes("info")) {
    return "num_vehicles";
  }

  return null;
}

// Parse a combined address like "8556 Helmsley Blvd, Jacksonville, FL 32219"
// or "2504 Nodosa Dr. Sarasota, FL 34232+4236" into pieces.
function parseAddress(input: string): { street: string; city: string; state: string; zip: string } {
  const out = { street: "", city: "", state: "", zip: "" };
  const raw = input.replace(/\s+/g, " ").trim();
  if (!raw) return out;
  // Pull state + zip from the tail.
  const tail = raw.match(/([A-Za-z]{2})\s+(\d{5})(?:[-+]\d{4})?\s*$/);
  let body = raw;
  if (tail) {
    out.state = tail[1].toUpperCase();
    out.zip = tail[2];
    body = raw.slice(0, tail.index).replace(/[,\s]+$/, "");
  }
  const parts = body.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    out.city = parts[parts.length - 1];
    out.street = parts.slice(0, -1).join(", ");
  } else if (parts.length === 1) {
    // Try to peel a trailing city (1-3 capitalized words) off the street.
    const m = parts[0].match(/^(.*?)[\s.]+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})$/);
    if (m) { out.street = m[1].trim(); out.city = m[2].trim(); }
    else out.street = parts[0];
  }
  return out;
}

function normHeader(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\s\-\.\/]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Minimal CSV parser supporting quoted fields, commas, and embedded newlines.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let i = 0;
  let inQuotes = false;
  // Auto-detect tab vs comma delimiter on first non-quoted line
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function hasExtension(fileName: string, extensions: readonly string[]) {
  return extensions.some((ext) => fileName.endsWith(ext));
}

function hasZipSignature(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function hasLegacyWorkbookSignature(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

async function readWorkbookMatrix(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: false,
    defval: "",
  });
  return rows.map((r) => r.map((c) => (c == null ? "" : String(c))));
}

function rowsFromMatrix(matrix: string[][]): Row[] {
  if (matrix.length === 0) return [];
  const header = matrix[0].map(normHeader);
  const looksLikeHeader = header.some((h) => resolveHeader(h));
  const dataRows = looksLikeHeader ? matrix.slice(1) : matrix;
  const mapping: (MapTarget | null)[] = looksLikeHeader
    ? header.map((h) => resolveHeader(h))
    : // positional default: assume order matches our FIELDS list
      (FIELDS.map((f) => f.key) as MapTarget[]);
  return projectRows(dataRows, header, mapping);
}

function projectRows(
  dataRows: string[][],
  header: string[],
  mapping: (MapTarget | null)[],
): Row[] {
  return dataRows.map((cells) => {
    const r = emptyRow();
    let inferredVehicleCount = 0;
    for (let i = 0; i < cells.length; i++) {
      const normalizedHeader = header[i] ?? "";
      const key = mapping[i];
      const val = (cells[i] ?? "").trim();
      const vehicleMatch = normalizedHeader.match(/^car(\d+)_(model_year|make|model|trim)$/);
      if (vehicleMatch && val) {
        inferredVehicleCount = Math.max(inferredVehicleCount, Number(vehicleMatch[1]));
      }
      if (!key) continue;
      if (!val) continue;
      if (key === "__address") {
        const parts = parseAddress(val);
        if (parts.street && !r.street) r.street = parts.street;
        if (parts.city && !r.city) r.city = parts.city;
        if (parts.state && !r.state) r.state = parts.state;
        if (parts.zip && !r.zip) r.zip = parts.zip;
      }
      else if (key === "phone") r.phone = formatPhone(val);
      else if (key === "state") r.state = val.slice(0, 2).toUpperCase() || val;
      else if (key === "date_of_birth") r.date_of_birth = normalizeDob(val);
      else if (key === "num_vehicles") {
        const n = val.match(/\d+/);
        r.num_vehicles = n ? n[0] : "";
      }
      else if (key === "vehicles_text") {
        r.vehicles_text = r.vehicles_text ? `${r.vehicles_text} / ${val}` : val;
      }
      else r[key] = val;
    }
    if (inferredVehicleCount >= 3) {
      r.num_vehicles = String(inferredVehicleCount);
    }
    // Split a single combined name into first/last when only "name" was provided
    if (r.first_name && !r.last_name && r.first_name.includes(" ")) {
      const parts = r.first_name.trim().split(/\s+/);
      r.first_name = parts[0];
      r.last_name = parts.slice(1).join(" ");
    }
    return r;
  });
}

function normalizeDob(v: string): string {
  // Accept YYYY-MM-DD, MM/DD/YYYY, M/D/YY, etc.
  const t = v.trim();
  let yy = "", mm = "", dd = "";
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    [yy, mm, dd] = t.split("-");
  } else {
    // Also accept space-separated like "5 14 1962".
    const m = t.match(/^(\d{1,2})[\/\-\s]+(\d{1,2})[\/\-\s]+(\d{2}|\d{4})$/);
    if (!m) return "";
    [, mm, dd, yy] = m;
    if (yy.length === 2) yy = (parseInt(yy, 10) > 30 ? "19" : "20") + yy;
  }
  let M = parseInt(mm, 10);
  let D = parseInt(dd, 10);
  // Recover YYYY-DD-MM (e.g. "1945-25-10" → month 10, day 25)
  if (M > 12 && D >= 1 && D <= 12) [M, D] = [D, M];
  if (!(M >= 1 && M <= 12 && D >= 1 && D <= 31)) return "";
  const iso = `${yy}-${String(M).padStart(2, "0")}-${String(D).padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (isNaN(dt.getTime()) || dt.getUTCMonth() + 1 !== M || dt.getUTCDate() !== D) return "";
  return iso;
}

// Sniff a target field from a sample of column values (used when the header
// is unrecognized or missing entirely).
const US_STATE_SET = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

function sniffColumn(values: string[]): MapTarget | null {
  const samples = values.map((v) => (v ?? "").trim()).filter(Boolean).slice(0, 25);
  if (samples.length === 0) return null;
  const pct = (pred: (s: string) => boolean) =>
    samples.filter(pred).length / samples.length;

   if (
    samples.length >= 2 &&
    pct((s) => /^[A-Za-z][A-Za-z'’\-]+(?:\s+[A-Za-z][A-Za-z'’\-]+){0,2}$/.test(s)) > 0.75
  ) {
    const multiWord = pct((s) => /\s+/.test(s));
    return multiWord > 0.35 ? "first_name" : "last_name";
  }

  if (pct((s) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) > 0.6) return "email";
  if (pct((s) => s.replace(/\D/g, "").length >= 10 && s.replace(/\D/g, "").length <= 11) > 0.6) return "phone";
  if (pct((s) => /^\d{5}(-\d{4})?$/.test(s)) > 0.6) return "zip";
  if (pct((s) => US_STATE_SET.has(s.toUpperCase()))> 0.6) return "state";
  if (pct((s) => !!normalizeDob(s)) > 0.6) return "date_of_birth";
  if (pct((s) => /\d+\s+[A-Za-z].*,\s*[A-Za-z]{2,}/.test(s)) > 0.5) return "__address";
  if (pct((s) => /^\d+\s+\w+/.test(s) && s.length > 6 && !/^\d{5}$/.test(s)) > 0.5) return "street";
  if (pct((s) => /^\d{1,2}$/.test(s)) > 0.6) return "num_vehicles";
  return null;
}

// Detect mapping from a parsed matrix using headers AND column data.
function detectFromMatrix(matrix: string[][]): {
  headers: string[];
  rawHeaders: string[];
  dataRows: string[][];
  mapping: (MapTarget | null)[];
  samples: string[];
} {
  if (matrix.length === 0) {
    return { headers: [], rawHeaders: [], dataRows: [], mapping: [], samples: [] };
  }
  const headerCandidates = matrix[0].map(normHeader);
  const looksLikeHeader = headerCandidates.some((h) => resolveHeader(h));
  const rawHeaders = looksLikeHeader
    ? matrix[0].map((c) => (c ?? "").trim() || "(empty)")
    : matrix[0].map((_, i) => `Column ${i + 1}`);
  const headers = looksLikeHeader ? headerCandidates : rawHeaders.map(normHeader);
  const dataRows = looksLikeHeader ? matrix.slice(1) : matrix;

  const colCount = matrix[0].length;
  const mapping: (MapTarget | null)[] = [];
  const samples: string[] = [];
  const used = new Set<string>();

  for (let c = 0; c < colCount; c++) {
    const colValues = dataRows.map((r) => r[c] ?? "");
    const firstSample = colValues.find((v) => (v ?? "").trim().length > 0) ?? "";
    samples.push(firstSample);

    let target: MapTarget | null = looksLikeHeader ? resolveHeader(headers[c]) : null;
    if (!target) target = sniffColumn(colValues);

    // Prevent collisions on singleton fields (phone, email, dob, state, zip, etc.)
    // by only auto-assigning once per target. User can override in the mapping UI.
    const SINGLETON: MapTarget[] = ["first_name","last_name","phone","email","date_of_birth","street","city","state","zip","county","current_carrier","num_vehicles","__address","agent_notes","vendor_notes"];
    if (target && SINGLETON.includes(target) && used.has(target)) {
      target = null;
    }
    if (target) used.add(target);
    mapping.push(target);
  }

  return { headers, rawHeaders, dataRows, mapping, samples };
}

// Parse any uploaded file (xlsx, xls, csv, tsv, txt) into a string matrix.
async function parseFileToMatrix(file: File): Promise<string[][]> {
  const lower = file.name.toLowerCase();
  if (hasExtension(lower, WORKBOOK_EXTENSIONS)) {
    return readWorkbookMatrix(file);
  }

  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (hasZipSignature(bytes) || hasLegacyWorkbookSignature(bytes)) {
    return readWorkbookMatrix(file);
  }

  if (!hasExtension(lower, TEXT_EXTENSIONS)) {
    throw new Error("Unsupported file type. Please upload .xlsx, .xls, .numbers, .csv, or .tsv.");
  }

  const text = await file.text();
  return parseCSV(text);
}

export function ImportListFlow({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const isAdmin = useHasRole("admin");
  const userId = user?.id ?? "";
  const checkLits = useServerFn(bulkCheckLitigators);
  const [rows, setRows] = useState<Row[]>([]);
  const [pasted, setPasted] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState("");
  const [listType, setListType] = useState<string>("");
  const [sharkTankSide, setSharkTankSide] = useState<"auto" | "home" | "">("");
  const [dragOver, setDragOver] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Source matrix + editable column mapping (auto-detected, user can override).
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(MapTarget | null)[]>([]);
  const [samples, setSamples] = useState<string[]>([]);

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Admin access only.
        </CardContent>
      </Card>
    );
  }

  const applyMatrix = (matrix: string[][], sourceLabel: string) => {
    const detected = detectFromMatrix(matrix);
    if (detected.dataRows.length === 0) {
      toast.error("No rows found.");
      return;
    }
    setRawHeaders(detected.rawHeaders);
    setHeaders(detected.headers);
    setDataRows(detected.dataRows);
    setMapping(detected.mapping);
    setSamples(detected.samples);
    setRows(projectRows(detected.dataRows, detected.headers, detected.mapping));
    setPreviewPage(0);
    const mappedCount = detected.mapping.filter(Boolean).length;
    toast.success(
      `Loaded ${detected.dataRows.length} row${detected.dataRows.length === 1 ? "" : "s"} from ${sourceLabel} · auto-mapped ${mappedCount} of ${detected.mapping.length} columns`,
    );
  };

  const setMappingFor = (colIndex: number, target: MapTarget | null) => {
    setMapping((prev) => {
      const next = prev.slice();
      next[colIndex] = target;
      // Re-derive rows from the source matrix with the new mapping.
      setRows(projectRows(dataRows, headers, next));
      return next;
    });
  };

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10MB).");
      return;
    }
    try {
      const matrix = await parseFileToMatrix(file);
      applyMatrix(matrix, file.name);
    } catch (err) {
      console.error(err);
      toast.error(`Couldn't read ${file.name}: ${(err as Error).message}`);
    }
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, []);

  const handleParsePasted = () => {
    const txt = pasted.trim();
    if (!txt) return;
    applyMatrix(parseCSV(txt), "pasted text");
    setPasted("");
  };

  const validCount = useMemo(
    () => rows.filter((r) => (r.first_name || r.last_name) && r.phone).length,
    [rows],
  );

  const previewPageCount = Math.max(1, Math.ceil(rows.length / PREVIEW_PAGE_SIZE));
  const currentPreviewPage = Math.min(previewPage, previewPageCount - 1);
  const previewStart = currentPreviewPage * PREVIEW_PAGE_SIZE;
  const previewEnd = Math.min(previewStart + PREVIEW_PAGE_SIZE, rows.length);
  const previewRows = useMemo(() => rows.slice(previewStart, previewEnd), [previewEnd, previewStart, rows]);

  const handleSubmit = async () => {
    if (rows.length === 0) {
      toast.error("No rows to import.");
      return;
    }
    if (!listType) {
      toast.error("Pick a list type for this import.");
      return;
    }
    if (!sharkTankSide) {
      toast.error("Pick which Shark Tank to drop these leads into.");
      return;
    }
    setSubmitting(true);
    setSubmitProgress("");
    const batchId = crypto.randomUUID();
    const payload = rows.map((r) => {
      const noteParts = [r.vendor_notes, r.vehicles_text ? `Vehicles: ${r.vehicles_text}` : ""].filter(Boolean);
      return ({
      vendor_id: userId,
      list_type: listType,
      shark_tank_side: sharkTankSide,
      import_batch_id: batchId,
      source_row: r as unknown as never,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      phone: r.phone || null,
      date_of_birth: r.date_of_birth || null,
      email: r.email || null,
      street: r.street || null,
      city: r.city || null,
      state: r.state || null,
      zip: r.zip || null,
      county: r.county || null,
      current_carrier: r.current_carrier || null,
      vendor_notes: noteParts.join("\n") || null,
      agent_notes: r.agent_notes || null,
      num_vehicles: r.num_vehicles ? parseInt(r.num_vehicles, 10) || 0 : 0,
      vehicles: [],
      });
    });
    const totalBatches = Math.ceil(payload.length / IMPORT_BATCH_SIZE);

    let inserted = 0;
    let skipped = 0;
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const start = batchIndex * IMPORT_BATCH_SIZE;
      const end = start + IMPORT_BATCH_SIZE;
      const batch = payload.slice(start, end);
      setSubmitProgress(`Importing batch ${batchIndex + 1} of ${totalBatches} (${Math.min(end, payload.length)} / ${payload.length})`);

      // Upsert with ignoreDuplicates skips rows whose phone already exists
      // (unique index `list_leads_phone_unique` on phone).
      const { data, error } = await supabase
        .from("list_leads")
        .upsert(batch, { onConflict: "phone", ignoreDuplicates: true })
        .select("id");
      if (error) {
        setSubmitting(false);
        setSubmitProgress("");
        toast.error(`Batch ${batchIndex + 1} failed: ${error.message}`);
        return;
      }
      const insertedThisBatch = data?.length ?? 0;
      inserted += insertedThisBatch;
      skipped += batch.length - insertedThisBatch;
    }

    setSubmitting(false);
    setSubmitProgress("");

    // Scrub imported phones against the TCPA litigator list and flag any hits.
    let litigatorHits = 0;
    if (inserted > 0) {
      try {
        const phones = payload.map((p) => p.phone).filter((p): p is string => !!p);
        const result = await checkLits({ data: { phones } });
        const hits = result.hits ?? [];
        litigatorHits = hits.length;
        if (hits.length > 0) {
          // Mark the matching rows in this batch as litigators.
          for (let i = 0; i < hits.length; i += 200) {
            const chunk = hits.slice(i, i + 200);
            await supabase
              .from("list_leads")
              .update({ litigator: true })
              .eq("import_batch_id", batchId)
              .in("phone", chunk);
          }
          toast.error(
            `Found ${hits.length} TCPA litigator${hits.length === 1 ? "" : "s"} in this import — flagged. Do not transfer these calls.`,
            { duration: 12000 },
          );
        }
      } catch (err) {
        console.error("Litigator scrub failed", err);
      }
    }

    let undone = false;
    toast.success(
      `Imported ${inserted} lead${inserted === 1 ? "" : "s"}` +
        (skipped > 0 ? ` — skipped ${skipped} duplicate phone${skipped === 1 ? "" : "s"}` : "") +
        (litigatorHits > 0 ? ` · ${litigatorHits} flagged as TCPA litigator${litigatorHits === 1 ? "" : "s"}` : ""),
      {
        duration: 10000,
        action: {
          label: "Undo",
          onClick: async () => {
            if (undone) return;
            undone = true;
            const { error } = await supabase
              .from("list_leads")
              .delete()
              .eq("import_batch_id", batchId);
            if (error) {
              toast.error(`Undo failed: ${error.message}`);
              return;
            }
            toast.success(`Removed ${inserted} imported lead${inserted === 1 ? "" : "s"}`);
            onDone();
          },
        },
      },
    );
    setRows([]);
    setPreviewPage(0);
    setRawHeaders([]);
    setHeaders([]);
    setDataRows([]);
    setMapping([]);
    setSamples([]);
    onDone();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Lead type</Label>
              <Select value={listType} onValueChange={setListType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a list type" />
                </SelectTrigger>
                <SelectContent>
                  {LIST_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Drop into Shark Tank</Label>
              <Select value={sharkTankSide} onValueChange={(v) => setSharkTankSide(v as "auto" | "home")}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto or Home" />
                </SelectTrigger>
                <SelectContent>
                  {SHARK_TANK_SIDES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Tag every row in this import so agents know which list it came from
            and which tank to surface it in. Searching by name or phone still
            finds leads from the other tank.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          className={cn(
            "relative transition-colors",
            dragOver && "border-primary ring-1 ring-primary bg-primary/5"
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <CardContent className="space-y-3 pt-6">
            <Label className="flex items-center gap-2"><Upload className="h-4 w-4" /> Upload CSV</Label>
            <div
              className={cn(
                "border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors",
                dragOver ? "border-primary bg-primary/10" : "border-muted-foreground/25 hover:border-muted-foreground/50"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">
                {dragOver ? "Drop file here" : "Drag & drop a file or click to browse"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv, .tsv</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              Supports .xlsx, .xls, .csv, .tsv. Columns are auto-detected from
              headers and a sample of values — you can adjust the mapping below
              before importing.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Label className="flex items-center gap-2"><FileText className="h-4 w-4" /> Paste rows</Label>
            <Textarea
              rows={5}
              placeholder={"first_name,last_name,phone,zip\nJane,Doe,(555) 123-4567,33101"}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={handleParsePasted}>
                Parse pasted rows
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {rows.length > 0 && (
        rawHeaders.length > 0 && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4" /> Column mapping
                </Label>
                <span className="text-xs text-muted-foreground">
                  {mapping.filter(Boolean).length} of {mapping.length} mapped
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                We auto-detected each column from its header and the first few
                values. Override any column below — changes update the preview
                instantly.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {rawHeaders.map((h, idx) => {
                  const current = mapping[idx];
                  const sample = (samples[idx] ?? "").slice(0, 40);
                  return (
                    <div key={`${h}-${idx}`} className="border rounded-md p-2 space-y-1 bg-muted/30">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium truncate" title={h}>{h}</div>
                        {current ? (
                          <span className="text-[10px] uppercase tracking-wide text-emerald-700">auto</span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">ignored</span>
                        )}
                      </div>
                      {sample && (
                        <div className="text-[11px] text-muted-foreground truncate" title={samples[idx]}>
                          {sample}
                        </div>
                      )}
                      <Select
                        value={current ?? "__ignore"}
                        onValueChange={(v) => setMappingFor(idx, v === "__ignore" ? null : (v as MapTarget))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MAP_TARGETS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm">
                <span className="font-medium">{rows.length}</span> row{rows.length === 1 ? "" : "s"} ready
                {validCount < rows.length && (
                  <span className="ml-2 text-amber-700">
                    ({rows.length - validCount} missing name or phone)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => {
                  setRows([]);
                  setPreviewPage(0);
                  setRawHeaders([]);
                  setHeaders([]);
                  setDataRows([]);
                  setMapping([]);
                  setSamples([]);
                }}>Clear all</Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Importing…" : `Import ${rows.length} lead${rows.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
            {submitProgress && (
              <div className="border-b px-4 py-2 text-sm text-muted-foreground">
                {submitProgress}
              </div>
            )}
            {rows.length > PREVIEW_PAGE_SIZE && (
              <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
                <span>Showing {previewStart + 1}-{previewEnd} of {rows.length}</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                    disabled={currentPreviewPage === 0}
                  >
                    Previous
                  </Button>
                  <span>Page {currentPreviewPage + 1} of {previewPageCount}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewPage((p) => Math.min(previewPageCount - 1, p + 1))}
                    disabled={currentPreviewPage >= previewPageCount - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {FIELDS.map((f) => (
                      <TableHead key={f.key}>{f.label}</TableHead>
                    ))}
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((r, i) => {
                    const rowIndex = previewStart + i;
                    return (
                    <TableRow key={rowIndex}>
                      {FIELDS.map((f) => (
                        <TableCell key={f.key} className="p-1">
                          <Input
                            value={r[f.key]}
                            onChange={(e) => setRow(rowIndex, { [f.key]: e.target.value } as Partial<Row>)}
                            className="h-8 min-w-[7rem]"
                          />
                        </TableCell>
                      ))}
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => removeRow(rowIndex)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );})}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
