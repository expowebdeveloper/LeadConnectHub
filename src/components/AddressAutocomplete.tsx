import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export type AddressParts = {
  street: string;
  city: string;
  zip: string;
  county: string;
  state: string;
};

type Suggestion = {
  label: string;
  parts: AddressParts;
};

async function addressLookup(q: string, signal: AbortSignal): Promise<Suggestion[]> {
  const res = await fetch(`/api/public/address-suggest?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`Lookup failed with status ${res.status}`);
  const json: { suggestions?: Suggestion[] } = await res.json();
  return json.suggestions ?? [];
}

export function AddressAutocomplete({
  label = "Street address",
  value,
  onChange,
  onSelect,
  required,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onSelect: (parts: AddressParts) => void;
  required?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const skipNextFetch = useRef(false);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 4 || !/\d/.test(q) || !/[a-zA-Z]/.test(q)) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const items = await addressLookup(q, ctrl.signal);
        setSuggestions(items);
        setOpen(items.length > 0);
      } catch (err: any) {
        if (err?.name !== "AbortError") console.warn("Address lookup failed", err);
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [value]);

  const pick = (s: Suggestion) => {
    skipNextFetch.current = true;
    onSelect(s.parts);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          required={required}
          autoComplete="off"
          placeholder="Street address"
          className="h-12 rounded-xl border-2 border-input bg-background text-base font-medium text-foreground placeholder:font-medium placeholder:text-muted-foreground"
        />
        {loading && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-64 overflow-auto">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}