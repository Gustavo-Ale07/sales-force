import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingHero } from "./loading-hero";

describe("LoadingHero", () => {
  it("is a progressbar with the right value, a big percentage and the action line", () => {
    render(<LoadingHero percent={76} label="Progresso da atualização" action="Atualizando preços…" meta="3 de 11 · 12 s" />);
    const ring = screen.getByRole("progressbar", { name: "Progresso da atualização" });
    expect(ring).toHaveAttribute("aria-valuenow", "76");
    expect(ring).toHaveAttribute("aria-valuemin", "0");
    expect(ring).toHaveAttribute("aria-valuemax", "100");
    expect(ring).toHaveAttribute("data-indeterminate", "false");
    expect(screen.getByTestId("hero-percent")).toHaveTextContent("76%");
    expect(screen.getByTestId("hero-percent")).toHaveClass("tabular-nums");
    expect(screen.getByText("Atualizando preços…")).toBeInTheDocument();
    expect(screen.getByText("3 de 11 · 12 s")).toBeInTheDocument();
    expect(ring.querySelector('[data-arc="determinate"]')).not.toBeNull();
    expect(ring.querySelector('[data-arc="indeterminate"]')).toBeNull();
  });

  it("grows the determinate arc with the percentage (dashoffset shrinks)", () => {
    const offsetOf = (percent: number) => {
      const { container, unmount } = render(<LoadingHero percent={percent} label="p" action="a" />);
      const value = Number(container.querySelector('[data-arc="determinate"]')?.getAttribute("stroke-dashoffset"));
      unmount();
      return value;
    };
    expect(offsetOf(25)).toBeGreaterThan(offsetOf(50));
    expect(offsetOf(50)).toBeGreaterThan(offsetOf(76));
    expect(offsetOf(100)).toBeCloseTo(0, 5);
  });

  it("is indeterminate at 0%: a short arc that turns (hidden under reduced motion), with 0% in the middle", () => {
    render(<LoadingHero percent={0} label="p" action="Iniciando a atualização…" />);
    const ring = screen.getByRole("progressbar");
    expect(ring).toHaveAttribute("data-indeterminate", "true");
    expect(ring).toHaveAttribute("aria-valuenow", "0");
    expect(ring).toHaveAttribute("aria-valuetext", "Iniciando");
    expect(screen.getByTestId("hero-percent")).toHaveTextContent("0%");
    const arc = ring.querySelector('[data-arc="indeterminate"]');
    expect(arc).not.toBeNull();
    expect(arc).toHaveClass("animate-spin", "motion-reduce:hidden");
    expect(ring.querySelector('[data-arc="determinate"]')).toBeNull();
    expect(screen.getByText("Iniciando a atualização…")).toBeInTheDocument();
  });

  it("becomes a check with the ring complete at the end, or an attention mark with warnings", () => {
    const { rerender } = render(<LoadingHero percent={80} label="p" action="Dados atualizados às 14:05" outcome="ok" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar").querySelector('[data-outcome="ok"]')).not.toBeNull();
    expect(screen.queryByTestId("hero-percent")).toBeNull();
    rerender(<LoadingHero percent={80} label="p" action="Atenção" outcome="warn" />);
    expect(screen.getByRole("progressbar").querySelector('[data-outcome="warn"]')).not.toBeNull();
  });

  it("has a fixed size, so the dialog never grows or scrolls because of it", () => {
    render(<LoadingHero percent={10} label="p" action="a" />);
    expect(screen.getByRole("progressbar")).toHaveStyle({ width: "136px", height: "136px" });
  });

  it('without a percent (sending) it keeps turning, shows an icon instead of a number and never says 0%', () => {
    render(<LoadingHero label="Envio" action="Enviando o pedido ao Sankhya…" />);
    const ring = screen.getByRole('progressbar');
    expect(ring).toHaveAttribute('data-indeterminate', 'true');
    expect(ring).not.toHaveAttribute('aria-valuenow');
    expect(ring).toHaveAttribute('aria-valuetext', 'Em andamento');
    expect(ring.querySelector('[data-arc="indeterminate"]')).not.toBeNull();
    expect(screen.queryByTestId('hero-percent')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByTestId('hero-icon')).toBeInTheDocument();
    expect(screen.getByText('Enviando o pedido ao Sankhya…')).toBeInTheDocument();
  });

  it('without a percent, the outcome still completes the ring', () => {
    render(<LoadingHero label="Envio" action="Enviado" outcome="ok" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.queryByTestId('hero-icon')).toBeNull();
  });
});
