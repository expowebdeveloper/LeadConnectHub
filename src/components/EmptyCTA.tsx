import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, type LucideIcon } from "lucide-react";

export type EmptyCTAAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "default" | "outline" | "secondary";
};

export function EmptyCTA({
  icon: Icon,
  title,
  description,
  actions = [],
  className = "",
  size = "md",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: EmptyCTAAction[];
  className?: string;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "p-4" : "p-6";
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/30 text-center ${pad} ${className}`}
    >
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="space-y-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description && (
          <p className="mx-auto max-w-xs text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {actions.map((a, i) => {
            const variant = a.variant ?? (i === 0 ? "default" : "outline");
            const inner = (
              <span className="inline-flex items-center gap-1.5">
                {a.label}
                {i === 0 && <ArrowRight className="h-3.5 w-3.5" />}
              </span>
            );
            if (a.to) {
              return (
                <Button key={i} asChild size="sm" variant={variant}>
                  <Link to={a.to}>{inner}</Link>
                </Button>
              );
            }
            return (
              <Button key={i} size="sm" variant={variant} onClick={a.onClick}>
                {inner}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}