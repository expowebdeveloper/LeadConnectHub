import { Phone, Ban } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * Renders a prospect phone number as a tap-to-call chip.
 * Pill-shaped, primary color, with a phone icon so it clearly reads as clickable.
 */
export function PhoneLink({
  phone,
  className,
  showIcon = true,
  stopPropagation = true,
  fallback = "—",
  dnc = false,
  leadId,
  leadSource,
  onOpenLead,
  nested = false,
}: {
  phone?: string | null;
  className?: string;
  showIcon?: boolean;
  stopPropagation?: boolean;
  fallback?: string;
  dnc?: boolean;
  /** Lead id — when provided (with leadSource), clicking opens lead detail. */
  leadId?: string;
  /** Accepts either the table name or the detail-route source enum. */
  leadSource?: "leads" | "list_leads" | "live" | "list";
  /** Override default open-lead behavior. Pass false to disable. */
  onOpenLead?: (() => void) | false;
  /** Set when this control is rendered inside another link/anchor — renders a button instead of an <a> to avoid invalid nested-anchor markup. */
  nested?: boolean;
}) {
  const navigate = useNavigate();
  if (!phone) return <span className="text-muted-foreground">{fallback}</span>;
  if (dnc) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-medium",
          "bg-destructive/10 text-destructive border border-destructive/30 cursor-not-allowed line-through decoration-destructive/60",
          className,
        )}
        title="Do Not Call"
        aria-label={`Do not call ${phone}`}
      >
        <Ban className="h-3.5 w-3.5 shrink-0" />
        <span>DNC · {phone}</span>
      </span>
    );
  }
  const tel = `tel:${phone.replace(/\D/g, "")}`;
  const className_ = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-medium text-primary",
    "bg-primary/10 hover:bg-primary/15 hover:underline underline-offset-2 transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    className,
  );
  const handleClick = (e: React.MouseEvent) => {
        if (stopPropagation) e.stopPropagation();
        const openLead = () => {
          if (onOpenLead === false) {
            return;
          }
          if (typeof onOpenLead === "function") {
            try { onOpenLead(); } catch { /* noop */ }
            return;
          }
          if (leadId && leadSource) {
            const source =
              leadSource === "leads" ? "live"
              : leadSource === "list_leads" ? "list"
              : leadSource;
            void navigate({
              to: "/leads/$leadId",
              params: { leadId },
              search: { source },
            });
          }
        };
        openLead();
  };
  if (nested) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={className_}
        aria-label={`Call ${phone}`}
      >
        {showIcon && <Phone className="h-3.5 w-3.5 shrink-0" />}
        <span>{phone}</span>
      </button>
    );
  }
  return (
    <a
      href={tel}
      onClick={handleClick}
      className={className_}
      aria-label={`Call ${phone}`}
    >
      {showIcon && <Phone className="h-3.5 w-3.5 shrink-0" />}
      <span>{phone}</span>
    </a>
  );
}