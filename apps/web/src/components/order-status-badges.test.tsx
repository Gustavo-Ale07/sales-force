import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { erpBillingLabels, erpReleaseLabels, orderStatusLabels } from "../lib/labels";
import { ErpBillingBadge, ErpReleaseBadge, OrderStatusBadge, erpBillingIcons, erpReleaseIcons, orderStatusIcons } from "./order-status-badges";

const NOW_OLD = "2020-01-01T00:00:00.000Z";

describe("status badges: label + icon, colour never alone", () => {
  it.each(Object.keys(orderStatusLabels) as (keyof typeof orderStatusLabels)[])("order status %s shows its label and a decorative icon", (status) => {
    const { container } = render(<OrderStatusBadge order={{ status, updatedAt: new Date().toISOString() }} />);
    expect(screen.getByText(orderStatusLabels[status].label)).toBeInTheDocument();
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(orderStatusIcons[status]).toBeDefined();
  });

  it.each(Object.keys(erpReleaseLabels) as (keyof typeof erpReleaseLabels)[])("release %s uses the shared label, tone and an icon", (state) => {
    const { container } = render(<ErpReleaseBadge state={state} />);
    expect(screen.getByText(erpReleaseLabels[state].label)).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(erpReleaseIcons[state]).toBeDefined();
  });

  it.each(Object.keys(erpBillingLabels) as (keyof typeof erpBillingLabels)[])("billing %s uses the shared label, hint as tooltip and an icon", (state) => {
    const { container } = render(<ErpBillingBadge state={state} variant="dot" />);
    const label = screen.getByText(erpBillingLabels[state].label);
    expect(label.closest("[title]")).toHaveAttribute("title", erpBillingLabels[state].hint);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(erpBillingIcons[state]).toBeDefined();
  });

  it("covers the statuses the seller reads: liberado, negado, faturado, cancelado", () => {
    const { rerender } = render(<ErpReleaseBadge state="released" />);
    expect(screen.getByText("Liberado")).toBeInTheDocument();
    rerender(<ErpReleaseBadge state="denied" />);
    expect(screen.getByText("Negado")).toBeInTheDocument();
    rerender(<ErpBillingBadge state="invoiced" />);
    expect(screen.getByText("Faturado")).toBeInTheDocument();
    rerender(<ErpBillingBadge state="cancelled" />);
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
  });

  it("keeps the overdue-delivery wording from orderStatusView", () => {
    render(<OrderStatusBadge order={{ status: "queued", updatedAt: NOW_OLD }} />);
    expect(screen.getByText(/Aguardando envio/)).toBeInTheDocument();
  });
});
