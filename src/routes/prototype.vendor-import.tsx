import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef, KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ArrowLeft, Check, Sparkles, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/prototype/vendor-import")({
  head: () => ({
    meta: [
      { title: "Vendor Lead Intake — Prototype" },
      { name: "description", content: "Typeform-style guided lead intake prototype for vendors." },
    ],
  }),
  component: VendorImportPrototype,
});

type LeadType = "auto" | "home" | "boat";
type Housing = "own" | "rent";

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  state: string;
  leadTypes: LeadType[];
  housing: Housing | "";
  notes: string;
};

const initial: FormState = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  state: "",
  leadTypes: [],
  housing: "",
  notes: "",
};

function VendorImportPrototype() {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [data, setData] = useState<FormState>(initial);
  const [submitted, setSubmitted] = useState(false);

  const steps = useMemo(
    () => buildSteps(data, setData),
    [data]
  );

  const total = steps.length;
  const current = steps[step];
  const progress = ((step) / total) * 100;

  const canAdvance = current?.isValid?.(data) ?? true;

  const next = () => {
    if (!canAdvance) return;
    if (step < total - 1) {
      setDir(1);
      setStep((s) => s + 1);
    } else {
      setSubmitted(true);
    }
  };
  const back = () => {
    if (step > 0) {
      setDir(-1);
      setStep((s) => s - 1);
    }
  };

  const reset = () => {
    setData(initial);
    setStep(0);
    setSubmitted(false);
    setDir(1);
  };

  if (submitted) {
    return <SuccessScreen onReset={reset} name={data.firstName} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/40 text-foreground flex flex-col">
      {/* Progress */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-muted/40 z-50">
        <motion.div
          className="h-full bg-gradient-to-r from-primary to-primary/60"
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>

      {/* Top bar */}
      <header className="flex items-center justify-between px-6 md:px-12 py-5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Vendor Lead Intake</span>
        </div>
        <div>
          {step + 1} <span className="opacity-50">/ {total}</span>
        </div>
      </header>

      {/* Slide area */}
      <main className="flex-1 flex items-center justify-center px-6 md:px-12 overflow-hidden">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, y: dir === 1 ? 40 : -40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: dir === 1 ? -40 : 40 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <StepShell
                index={step}
                total={total}
                question={current.question}
                description={current.description}
              >
                {current.render({ next, canAdvance })}
              </StepShell>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Footer controls */}
      <footer className="px-6 md:px-12 py-6 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={back}
          disabled={step === 0}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-xs text-muted-foreground">
            press <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground/80">Enter ↵</kbd>
          </span>
          <Button
            size="lg"
            onClick={next}
            disabled={!canAdvance}
            className="gap-2 rounded-full px-6 shadow-lg shadow-primary/20"
          >
            {step === total - 1 ? "Submit" : "OK"}
            {step === total - 1 ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function StepShell({
  index,
  question,
  description,
  children,
}: {
  index: number;
  total: number;
  question: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start gap-3 mb-6">
        <span className="mt-1 text-primary text-sm font-mono tabular-nums">
          {String(index + 1).padStart(2, "0")}
          <span className="ml-1 opacity-50">→</span>
        </span>
        <div>
          <h1 className="text-2xl md:text-4xl font-semibold tracking-tight leading-tight">
            {question}
          </h1>
          {description && (
            <p className="mt-2 text-muted-foreground text-base">{description}</p>
          )}
        </div>
      </div>
      <div className="pl-0 md:pl-9">{children}</div>
    </div>
  );
}

/* ----------------- Steps ----------------- */

type StepDef = {
  question: string;
  description?: string;
  isValid?: (d: FormState) => boolean;
  render: (ctx: { next: () => void; canAdvance: boolean }) => React.ReactNode;
};

function buildSteps(
  data: FormState,
  setData: React.Dispatch<React.SetStateAction<FormState>>
): StepDef[] {
  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  return [
    {
      question: "Let's add a new lead 👋",
      description: "Takes about 60 seconds. Press Enter to begin.",
      render: ({ next }) => (
        <EnterCatcher onEnter={next}>
          <Button size="lg" onClick={next} className="rounded-full px-6 gap-2">
            Start <ArrowRight className="h-4 w-4" />
          </Button>
        </EnterCatcher>
      ),
    },
    {
      question: "What's their first name?",
      isValid: (d) => d.firstName.trim().length > 0,
      render: ({ next }) => (
        <BigInput
          value={data.firstName}
          onChange={(v) => update("firstName", v)}
          placeholder="Jane"
          onEnter={next}
        />
      ),
    },
    {
      question: "And their last name?",
      isValid: (d) => d.lastName.trim().length > 0,
      render: ({ next }) => (
        <BigInput
          value={data.lastName}
          onChange={(v) => update("lastName", v)}
          placeholder="Doe"
          onEnter={next}
        />
      ),
    },
    {
      question: "Best phone number to reach them?",
      description: "Digits only, we'll format it.",
      isValid: (d) => d.phone.replace(/\D/g, "").length >= 10,
      render: ({ next }) => (
        <BigInput
          value={data.phone}
          onChange={(v) => update("phone", v)}
          placeholder="(555) 123-4567"
          inputMode="tel"
          onEnter={next}
        />
      ),
    },
    {
      question: "Email address?",
      isValid: (d) => /.+@.+\..+/.test(d.email),
      render: ({ next }) => (
        <BigInput
          value={data.email}
          onChange={(v) => update("email", v)}
          placeholder="jane@example.com"
          type="email"
          onEnter={next}
        />
      ),
    },
    {
      question: "Which state are they in?",
      isValid: (d) => d.state.trim().length >= 2,
      render: ({ next }) => (
        <BigInput
          value={data.state}
          onChange={(v) => update("state", v.toUpperCase().slice(0, 2))}
          placeholder="FL"
          onEnter={next}
          maxLength={2}
        />
      ),
    },
    {
      question: "What lead type(s)?",
      description: "Pick all that apply. Tap a letter or click.",
      isValid: (d) => d.leadTypes.length > 0,
      render: () => (
        <MultiChoice
          options={[
            { value: "auto", label: "Auto", key: "A" },
            { value: "home", label: "Home", key: "H" },
            { value: "boat", label: "Boat", key: "B" },
          ]}
          selected={data.leadTypes}
          onToggle={(v) =>
            update(
              "leadTypes",
              data.leadTypes.includes(v as LeadType)
                ? data.leadTypes.filter((x) => x !== v)
                : [...data.leadTypes, v as LeadType]
            )
          }
        />
      ),
    },
    {
      question: "Do they own or rent?",
      isValid: (d) => d.housing !== "",
      render: ({ next }) => (
        <SingleChoice
          options={[
            { value: "own", label: "Own", key: "O" },
            { value: "rent", label: "Rent", key: "R" },
          ]}
          selected={data.housing}
          onSelect={(v) => {
            update("housing", v as Housing);
            setTimeout(next, 220);
          }}
        />
      ),
    },
    {
      question: "Anything else worth noting?",
      description: "Optional. Skip with Enter.",
      render: ({ next }) => (
        <BigTextarea
          value={data.notes}
          onChange={(v) => update("notes", v)}
          placeholder="They mentioned shopping their renewal in March…"
          onEnter={next}
        />
      ),
    },
    {
      question: "Looks good?",
      description: "Quick review before we drop this into the tank.",
      render: () => <ReviewCard data={data} />,
    },
  ];
}

/* ----------------- Inputs ----------------- */

function BigInput({
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  maxLength,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "tel" | "text" | "email" | "numeric";
  maxLength?: number;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
      placeholder={placeholder}
      type={type}
      inputMode={inputMode}
      maxLength={maxLength}
      className="h-14 md:h-16 text-2xl md:text-3xl border-0 border-b-2 border-muted rounded-none bg-transparent px-0 focus-visible:ring-0 focus-visible:border-primary placeholder:text-muted-foreground/50"
    />
  );
}

function BigTextarea({
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
          e.preventDefault();
          onEnter();
        }
      }}
      placeholder={placeholder}
      rows={3}
      className="text-lg md:text-xl border-0 border-b-2 border-muted rounded-none bg-transparent px-0 focus-visible:ring-0 focus-visible:border-primary placeholder:text-muted-foreground/50 resize-none"
    />
  );
}

type ChoiceOption = { value: string; label: string; key: string };

function ChoiceCard({
  option,
  selected,
  onClick,
}: {
  option: ChoiceOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-5 py-4 rounded-xl border-2 text-left transition-colors",
        "bg-card/50 backdrop-blur",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border hover:border-primary/50"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "h-7 w-7 rounded-md border-2 flex items-center justify-center text-xs font-mono font-semibold",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground"
          )}
        >
          {selected ? <Check className="h-4 w-4" /> : option.key}
        </span>
        <span className="text-lg font-medium">{option.label}</span>
      </div>
      {selected && (
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-xs text-primary uppercase tracking-wider"
        >
          Selected
        </motion.span>
      )}
    </motion.button>
  );
}

function MultiChoice({
  options,
  selected,
  onToggle,
}: {
  options: ChoiceOption[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      const opt = options.find((o) => o.key.toLowerCase() === e.key.toLowerCase());
      if (opt) onToggle(opt.value);
    };
    window.addEventListener("keydown", handler as any);
    return () => window.removeEventListener("keydown", handler as any);
  }, [options, onToggle]);
  return (
    <div className="space-y-3">
      {options.map((o) => (
        <ChoiceCard
          key={o.value}
          option={o}
          selected={selected.includes(o.value)}
          onClick={() => onToggle(o.value)}
        />
      ))}
      <p className="text-xs text-muted-foreground flex items-center gap-1 pt-2">
        <CornerDownLeft className="h-3 w-3" /> Press Enter to continue
      </p>
    </div>
  );
}

function SingleChoice({
  options,
  selected,
  onSelect,
}: {
  options: ChoiceOption[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const opt = options.find((o) => o.key.toLowerCase() === e.key.toLowerCase());
      if (opt) onSelect(opt.value);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [options, onSelect]);
  return (
    <div className="space-y-3">
      {options.map((o) => (
        <ChoiceCard
          key={o.value}
          option={o}
          selected={selected === o.value}
          onClick={() => onSelect(o.value)}
        />
      ))}
    </div>
  );
}

function EnterCatcher({ onEnter, children }: { onEnter: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Enter") onEnter();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEnter]);
  return <>{children}</>;
}

/* ----------------- Review & Success ----------------- */

function ReviewCard({ data }: { data: FormState }) {
  const rows: [string, string][] = [
    ["Name", `${data.firstName} ${data.lastName}`.trim() || "—"],
    ["Phone", data.phone || "—"],
    ["Email", data.email || "—"],
    ["State", data.state || "—"],
    ["Lead types", data.leadTypes.map(capitalize).join(", ") || "—"],
    ["Housing", data.housing ? capitalize(data.housing) : "—"],
    ["Notes", data.notes || "—"],
  ];
  return (
    <div className="rounded-2xl border bg-card/50 backdrop-blur divide-y">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 px-5 py-3 text-sm">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-medium text-right max-w-[70%]">{v}</span>
        </div>
      ))}
    </div>
  );
}

function SuccessScreen({ onReset, name }: { onReset: () => void; name: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/10 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-md"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 14 }}
          className="mx-auto mb-6 h-16 w-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl shadow-primary/30"
        >
          <Check className="h-8 w-8" />
        </motion.div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Lead submitted{name ? `, thanks!` : "!"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {name ? `${name}'s info is in the queue for review.` : "Your lead is in the queue for review."}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button onClick={onReset} className="rounded-full px-6">
            Add another
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}