import { createFileRoute } from "@tanstack/react-router";
import { Phone, Mail, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/chip-preview")({
  head: () => ({ meta: [{ title: "Chip Style Preview" }] }),
  component: ChipPreviewPage,
});

const HEADERS = ["Type", "Score", "Name", "Phone / Email", "Location", "Carrier", "Veh.", "Quoted", "Received", ""] as const;

const mock = {
  type: "AGED INSURE",
  score: 142,
  first: "MARCUS",
  last: "REYNOLDS",
  phone: "(512) 555-0188",
  email: "marcus.r@gmail.com",
  city: "AUSTIN",
  state: "TX",
  zip: "78704",
  carrier: "PROGRESSIVE",
  vehicles: 2,
  quoted: 1280,
  time: "14:32",
  date: "JUN 10",
};

function CommonCells() {
  return (
    <>
      <TableCell className="align-middle">
        <div className="flex items-center gap-3">
          <div className="h-10 w-1 rounded-full bg-cyan-500 group-hover:shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
          <span className="text-xs font-bold uppercase tracking-wider text-foreground/90">{mock.type}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-cyan-500/50 bg-cyan-500/10 font-mono text-sm font-bold tabular-nums text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.25)]">
            {mock.score}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm font-bold uppercase tracking-tight text-foreground">{mock.first} {mock.last}</span>
          <Badge variant="destructive" className="mt-1 w-fit uppercase text-[9px]">TCPA Litigator</Badge>
        </div>
      </TableCell>
    </>
  );
}

function TrailingCells() {
  return (
    <>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-xs font-semibold uppercase text-foreground/90">{mock.city}, {mock.state}</span>
          <span className="text-[10px] font-mono text-muted-foreground/60">{mock.zip}</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="rounded border border-border/60 bg-card/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
          {mock.carrier}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <span className="font-mono text-base font-bold">{mock.vehicles}<span className="ml-1 text-[9px] uppercase tracking-widest text-muted-foreground/60">VEH</span></span>
      </TableCell>
      <TableCell className="text-right">
        <span className="font-mono text-sm font-bold text-emerald-400">${mock.quoted.toLocaleString()}</span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-cyan-400">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            {mock.time}
          </span>
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">{mock.date}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-all group-hover:border-cyan-400 group-hover:text-cyan-300 group-hover:shadow-[0_0_10px_rgba(34,211,238,0.4)]">
          <Pencil className="h-3.5 w-3.5" />
        </div>
      </TableCell>
    </>
  );
}

/* ---------- OPTION A: Ghost readout with PH/EM prefix ---------- */
function OptionA() {
  return (
    <TableCell>
      <div className="inline-flex w-fit flex-col items-stretch gap-1.5">
        <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-transparent px-2 py-1 transition-all group-hover:border-cyan-400/50 group-hover:shadow-[0_0_8px_rgba(34,211,238,0.2)]">
          <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">PH</span>
          <span className="h-3 w-px bg-border/60" />
          <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground/90 group-hover:text-cyan-200">{mock.phone}</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-transparent px-2 py-1 transition-all group-hover:border-cyan-400/50 group-hover:shadow-[0_0_8px_rgba(34,211,238,0.2)]">
          <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">EM</span>
          <span className="h-3 w-px bg-border/60" />
          <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground/90 group-hover:text-cyan-200">{mock.email}</span>
        </div>
      </div>
    </TableCell>
  );
}

/* ---------- OPTION B: Split chip with icon gutter ---------- */
function OptionB() {
  return (
    <TableCell>
      <div className="inline-flex w-fit flex-col items-stretch gap-1.5">
        <div className="inline-flex items-stretch overflow-hidden rounded-md border border-border/60 bg-card/40 transition-all group-hover:border-cyan-400/50 group-hover:shadow-[0_0_10px_rgba(34,211,238,0.18)]">
          <div className="flex w-7 items-center justify-center border-r border-border/60 bg-card/70 transition-colors group-hover:bg-cyan-500/15">
            <Phone className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-cyan-300" />
          </div>
          <span className="px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-foreground/90 group-hover:text-foreground">{mock.phone}</span>
        </div>
        <div className="inline-flex items-stretch overflow-hidden rounded-md border border-border/60 bg-card/40 transition-all group-hover:border-cyan-400/50 group-hover:shadow-[0_0_10px_rgba(34,211,238,0.18)]">
          <div className="flex w-7 items-center justify-center border-r border-border/60 bg-card/70 transition-colors group-hover:bg-cyan-500/15">
            <Mail className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-cyan-300" />
          </div>
          <span className="px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-foreground/90 group-hover:text-foreground">{mock.email}</span>
        </div>
      </div>
    </TableCell>
  );
}

/* ---------- OPTION C: Command-line rows with left accent rule ---------- */
function OptionC() {
  return (
    <TableCell>
      <div className="flex w-fit flex-col gap-1">
        <div className="inline-flex items-center gap-2 py-0.5">
          <span className="h-3.5 w-[3px] rounded-full bg-cyan-500/40 transition-all group-hover:bg-cyan-400 group-hover:shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          <Phone className="h-3 w-3 text-muted-foreground/70 group-hover:text-cyan-300" />
          <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground/90 underline-offset-2 group-hover:text-cyan-200 group-hover:underline">{mock.phone}</span>
        </div>
        <div className="inline-flex items-center gap-2 py-0.5">
          <span className="h-3.5 w-[3px] rounded-full bg-cyan-500/40 transition-all group-hover:bg-cyan-400 group-hover:shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          <Mail className="h-3 w-3 text-muted-foreground/70 group-hover:text-cyan-300" />
          <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground/90 underline-offset-2 group-hover:text-cyan-200 group-hover:underline">{mock.email}</span>
        </div>
      </div>
    </TableCell>
  );
}

function SampleRow({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-400">{label}</h2>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <div className="rounded-lg border border-border/60 bg-background/40 overflow-hidden">
        <Table className="[&_tr]:border-white/5">
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-transparent">
              {HEADERS.map((h, i) => {
                const align = h === "Score" || h === "Veh." || h === "Quoted" ? "text-right" : "";
                const w = h === "" ? "w-12" : "";
                return (
                  <TableHead key={i} className={`text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70 ${align} ${w}`}>{h}</TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="group cursor-pointer transition-all hover:bg-cyan-500/[0.05] [&>td]:align-middle [&>td]:py-4">
              <CommonCells />
              {children}
              <TrailingCells />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ChipPreviewPage() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header>
          <h1 className="text-2xl font-bold uppercase tracking-tight">Phone &amp; Email Chip Styles</h1>
          <p className="text-sm text-muted-foreground">Hover any row to see the active/hover state. Pick the one you want and I'll wire it into Shark Tank.</p>
        </header>
        <SampleRow label="Option A — Ghost readout" sub="Outline only, PH/EM mono prefix, hover brightens border to cyan.">
          <OptionA />
        </SampleRow>
        <SampleRow label="Option B — Split chip with icon gutter" sub="Filled chip, dedicated icon column, hover fills the gutter cyan.">
          <OptionB />
        </SampleRow>
        <SampleRow label="Option C — Command-line rows" sub="No chip container — left accent rule echoes the Type column bar.">
          <OptionC />
        </SampleRow>
      </div>
    </div>
  );
}