import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle, Bell, Mail, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";

export type SaleType = "monoline" | "bundled" | "bundled_preferred";

export type SaleConfirm = {
  saleType: SaleType;
  /** Premium of motor-club membership sold alongside an auto policy. Adds to sold premium but is not a policy/item. */
  motorClubPremium?: number | null;
  /** Final quoted premium for this side, edited inline at sale-confirmation time. */
  premium: number;
};

const TYPE_LABEL: Record<SaleType, string> = {
  monoline: "Monoline",
  bundled: "Bundled",
  bundled_preferred: "Bundled (Preferred)",
};

export function SaleTypeDialog({
  open,
  side,
  defaultValue,
  defaultMotorClubPremium,
  premium,
  leadName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  side: "auto" | "home";
  defaultValue?: SaleType | null;
  defaultMotorClubPremium?: number | null;
  premium?: number | null;
  leadName?: string | null;
  onCancel: () => void;
  onConfirm: (result: SaleConfirm) => void;
}) {
  const [value, setValue] = useState<SaleType>(defaultValue ?? "monoline");
  const [ack, setAck] = useState(false);
  const [premiumInput, setPremiumInput] = useState<string>(
    premium != null && Number.isFinite(premium) ? String(premium) : "",
  );
  const [motorClubSold, setMotorClubSold] = useState<boolean>(
    (defaultMotorClubPremium ?? 0) > 0,
  );
  const [motorClubPremium, setMotorClubPremium] = useState<string>(
    defaultMotorClubPremium != null ? String(defaultMotorClubPremium) : "",
  );

  useEffect(() => {
    if (open) {
      setValue(defaultValue ?? "monoline");
      setAck(false);
      setPremiumInput(
        premium != null && Number.isFinite(premium) ? String(premium) : "",
      );
      setMotorClubSold((defaultMotorClubPremium ?? 0) > 0);
      setMotorClubPremium(
        defaultMotorClubPremium != null ? String(defaultMotorClubPremium) : "",
      );
    }
  }, [open, defaultValue, defaultMotorClubPremium, premium]);

  const sideLabel = side === "auto" ? "Auto" : "Home";
  const fmtMoney = (n?: number | null) =>
    typeof n === "number" && Number.isFinite(n)
      ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : "—";

  const parsedMcp = (() => {
    const t = motorClubPremium.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const mcpInvalid = side === "auto" && motorClubSold && parsedMcp === null;
  const parsedPremium = (() => {
    const t = premiumInput.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const premiumInvalid = parsedPremium === null;


  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Mark {sideLabel} as sold
          </DialogTitle>
          <DialogDescription>
            This broadcasts a team-wide sales alert and sends a celebratory
            email. Please verify the policy is bound before continuing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Policy type
            </Label>
            <RadioGroup
              value={value}
              onValueChange={(v) => setValue(v as SaleType)}
              className="mt-2 space-y-2"
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
                <RadioGroupItem value="monoline" id="sale-mono" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="sale-mono" className="cursor-pointer text-sm font-medium">
                    Monoline
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Standalone policy, not part of a bundle.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
                <RadioGroupItem value="bundled" id="sale-bundle" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="sale-bundle" className="cursor-pointer text-sm font-medium">
                    Bundled
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Written with at least one other policy.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
                <RadioGroupItem value="bundled_preferred" id="sale-pref" className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="sale-pref" className="cursor-pointer text-sm font-medium">
                    Bundled (Preferred)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Preferred-tier bundle — also counts toward bundle rate.
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="grid grid-cols-2 gap-y-1.5">
              <span className="text-muted-foreground">Lead</span>
              <span className="text-right font-medium">{leadName || "—"}</span>
              <span className="text-muted-foreground">Side</span>
              <span className="text-right font-medium">{sideLabel}</span>
              <span className="text-muted-foreground">Sale type</span>
              <span className="text-right font-medium">{TYPE_LABEL[value]}</span>
              <span className="text-muted-foreground">Premium</span>
              <span className="text-right font-medium">{fmtMoney(parsedPremium)}</span>
              {side === "auto" && motorClubSold && (
                <>
                  <span className="text-muted-foreground">Motor club</span>
                  <span className="text-right font-medium">{fmtMoney(parsedMcp)}</span>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sale-premium" className="text-xs uppercase tracking-wide text-muted-foreground">
              {sideLabel} premium
            </Label>
            <Input
              id="sale-premium"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={premiumInput}
              onChange={(e) => setPremiumInput(e.target.value)}
              placeholder="$0"
            />
            <p className="text-[11px] text-muted-foreground">
              Adjust the quoted premium if it changed at bind. This updates the lead.
            </p>
          </div>

          {side === "auto" && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Did you sell a motor club membership with this policy?
              </div>
              <RadioGroup
                value={motorClubSold ? "yes" : "no"}
                onValueChange={(v) => setMotorClubSold(v === "yes")}
                className="mt-2 flex gap-4"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="no" id="mc-no" />
                  No
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="yes" id="mc-yes" />
                  Yes
                </label>
              </RadioGroup>
              {motorClubSold && (
                <div className="mt-3 space-y-1">
                  <Label htmlFor="mc-premium" className="text-xs">
                    Motor club premium
                  </Label>
                  <Input
                    id="mc-premium"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={motorClubPremium}
                    onChange={(e) => setMotorClubPremium(e.target.value)}
                    placeholder="$0"
                  />
                  {mcpInvalid ? (
                    <p className="text-[11px] text-destructive font-medium">
                      Enter a valid premium amount to confirm the sale.
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Counts toward total sold premium. Does not count as a policy or item.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <Bell className="h-3.5 w-3.5" /> On-screen alert to all agents
            </div>
            <div className="flex items-center gap-2 font-medium">
              <Mail className="h-3.5 w-3.5" /> Celebratory email to the team
            </div>
          </div>

          {premiumInvalid && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <span className="font-medium">Premium required:</span> Enter a valid premium amount before confirming this sale.
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2 rounded-md border-2 border-primary/40 bg-primary/5 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span className="font-medium">
              I confirm this policy is bound and the details above are correct.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                saleType: value,
                motorClubPremium: side === "auto" && motorClubSold ? parsedMcp : null,
                premium: parsedPremium as number,
              })
            }
            disabled={!ack || mcpInvalid || premiumInvalid}
          >
            Confirm sale & notify team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

