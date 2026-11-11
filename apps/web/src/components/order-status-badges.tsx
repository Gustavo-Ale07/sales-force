import type { ApiSchema } from "@salesforce/contracts/client";
import { StatusBadge, StatusDot, type Tone } from "@salesforce/ui";
import { Ban, CheckCircle2, CircleHelp, Clock, FilePen, FileCheck2, Hourglass, PackageCheck, Send, ShieldCheck, ShieldX, XCircle, type LucideIcon } from "lucide-react";
import { erpBillingLabels, erpReleaseLabels, orderStatusView } from "../lib/labels";

/**
 * Presentation only: one place that pairs every order / Sankhya status with an icon. Labels, tones and hints come
 * from `lib/labels.ts`; colour is never the only signal (the icon is decorative, the text always renders).
 */
type OrderStatus = ApiSchema<"OrderStatus">;
type ReleaseState = keyof typeof erpReleaseLabels;
type BillingState = keyof typeof erpBillingLabels;

export const orderStatusIcons: Record<OrderStatus, LucideIcon> = {
  draft: FilePen,
  awaiting_approval: Hourglass,
  approved: ShieldCheck,
  approval_rejected: ShieldX,
  queued: Send,
  sent: CheckCircle2,
  rejected: XCircle,
  unknown: CircleHelp,
};

export const erpReleaseIcons: Record<ReleaseState, LucideIcon> = {
  awaiting: Clock,
  released: CheckCircle2,
  denied: Ban,
};

export const erpBillingIcons: Record<BillingState, LucideIcon> = {
  cancelled: Ban,
  denied: XCircle,
  awaiting_release: Clock,
  invoiced: FileCheck2,
  awaiting_billing: PackageCheck,
  sent: Send,
};

interface Presentation {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  title?: string;
}

type Variant = "badge" | "dot";

function Shown({ presentation, variant, className }: { presentation: Presentation; variant: Variant; className?: string }) {
  const Icon = presentation.icon;
  const size = variant === "badge" ? 13 : 15;
  const icon = <Icon size={size} strokeWidth={2} aria-hidden="true" />;
  return variant === "badge" ? (
    <StatusBadge tone={presentation.tone} icon={icon} title={presentation.title} className={className}>
      {presentation.label}
    </StatusBadge>
  ) : (
    <StatusDot tone={presentation.tone} icon={icon} title={presentation.title} className={className}>
      {presentation.label}
    </StatusDot>
  );
}

/** Sales Force situation of the order (draft, awaiting approval, sent, ...). */
export function OrderStatusBadge({
  order,
  variant = "badge",
  className,
}: {
  order: { status: OrderStatus; erpNumber?: number | null; updatedAt?: string };
  variant?: Variant;
  className?: string;
}) {
  const view = orderStatusView(order);
  // An overdue queued delivery is shown as "waiting" (amber), so it gets the clock instead of the paper plane.
  const icon = order.status === "queued" && view.tone === "warning" ? Clock : orderStatusIcons[order.status];
  return <Shown presentation={{ label: view.label, tone: view.tone, icon, title: view.hint }} variant={variant} className={className} />;
}

/** Release (liberação) in Sankhya: awaiting, released or denied. */
export function ErpReleaseBadge({ state, variant = "badge", className }: { state: ReleaseState; variant?: Variant; className?: string }) {
  const { label, tone } = erpReleaseLabels[state];
  return <Shown presentation={{ label, tone, icon: erpReleaseIcons[state] }} variant={variant} className={className} />;
}

/** Billing (faturamento) in Sankhya: awaiting release, invoiced, denied, cancelled, ... */
export function ErpBillingBadge({ state, variant = "badge", className }: { state: BillingState; variant?: Variant; className?: string }) {
  const { label, tone, hint } = erpBillingLabels[state];
  return <Shown presentation={{ label, tone, icon: erpBillingIcons[state], title: hint }} variant={variant} className={className} />;
}
