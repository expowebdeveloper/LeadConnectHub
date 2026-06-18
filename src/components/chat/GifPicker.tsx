import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { gifSearch } from "@/lib/chat-stage2.functions";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";

type GifResult = { id: string; preview: string; url: string; alt: string };

/** Tenor-powered GIF picker. Calls onPick with the full GIF URL. */
export function GifPicker({ onPick }: { onPick: (url: string, alt: string) => void }) {
  const search = useServerFn(gifSearch);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await search({ data: { query, limit: 24 } });
        if (cancelled) return;
        setConfigured(res.configured);
        setResults(res.results);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, search]);

  return (
    <div className="w-[340px]">
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Tenor…"
          className="h-8 pl-7 text-xs"
        />
      </div>
      {configured === false ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          GIF search isn't configured yet. Ask an admin to add a <span className="font-mono">TENOR_API_KEY</span> secret to enable it.
        </div>
      ) : (
        <div className="h-[260px] overflow-y-auto rounded-md border border-border bg-background p-1">
          {loading && results.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No GIFs found
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onPick(r.url, r.alt)}
                  className="overflow-hidden rounded-sm border border-transparent transition-colors hover:border-primary/50"
                >
                  <img src={r.preview} alt={r.alt} className="h-24 w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-1 text-[10px] text-muted-foreground">Powered by Tenor</div>
    </div>
  );
}