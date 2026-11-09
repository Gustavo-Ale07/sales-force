import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FullScreenLoading } from "./full-screen-loading";

const base = { open: true, onClose: () => undefined, title: "Atualizando dados", label: "Progresso da atualização", action: "Lendo transportadoras…", busy: true };

describe("FullScreenLoading", () => {
  it("is a modal dialog named by its title, covering the viewport with an opaque background", () => {
    render(<FullScreenLoading {...base} percent={40} />);
    const dialog = screen.getByRole("dialog", { name: "Atualizando dados" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("fixed", "inset-0");
    expect(dialog.className).not.toMatch(/backdrop|blur|opacity|\/\d|shadow|border|rounded/);
    expect(dialog.getAttribute("style")).not.toMatch(/rgba|transparent/);
    const overlay = document.querySelector("[data-full-screen-overlay]");
    expect(overlay?.className).not.toMatch(/blur|\/\d/);
  });

  it("puts the initial focus on the screen itself, not on a button", async () => {
    render(<FullScreenLoading {...base} percent={10} details={<p>x</p>} onDetailsToggle={() => undefined} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("shows the percentage and the action line", () => {
    render(<FullScreenLoading {...base} percent={40} meta="7 de 11 · 2 s" />);
    expect(screen.getByTestId("hero-percent")).toHaveTextContent("40%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("Lendo transportadoras…")).toBeInTheDocument();
    expect(screen.getByText("7 de 11 · 2 s")).toBeInTheDocument();
  });

  it("is indeterminate at 0% and with no percentage (send icon)", () => {
    const { rerender } = render(<FullScreenLoading {...base} percent={0} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("data-indeterminate", "true");
    rerender(<FullScreenLoading {...base} />);
    expect(screen.getByTestId("hero-icon")).toBeInTheDocument();
    expect(screen.queryByTestId("hero-percent")).toBeNull();
  });

  it("completes the ring for ok and warn outcomes", () => {
    const { rerender } = render(<FullScreenLoading {...base} busy={false} percent={20} outcome="ok" action="Dados atualizados às 10:00" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(document.querySelector('[data-outcome="ok"]')).not.toBeNull();
    rerender(<FullScreenLoading {...base} busy={false} percent={20} outcome="warn" />);
    expect(document.querySelector('[data-outcome="warn"]')).not.toBeNull();
  });

  it("does not close with Esc while busy, and closes when not busy", () => {
    const onClose = vi.fn();
    const { rerender } = render(<FullScreenLoading {...base} onClose={onClose} percent={10} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<FullScreenLoading {...base} onClose={onClose} busy={false} percent={10} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has no X", () => {
    render(<FullScreenLoading {...base} percent={10} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers details only when given; the panel is a dark group inside the screen", () => {
    const toggle = vi.fn();
    const { rerender } = render(<FullScreenLoading {...base} percent={10} />);
    expect(screen.queryByText("Ver detalhes")).toBeNull();
    rerender(<FullScreenLoading {...base} percent={10} details={<p>linhas</p>} detailsOpen={false} onDetailsToggle={toggle} />);
    fireEvent.click(screen.getByText("Ver detalhes"));
    expect(toggle).toHaveBeenCalled();
    expect(screen.queryByText("linhas")).toBeNull();
    rerender(<FullScreenLoading {...base} percent={10} details={<p>linhas</p>} detailsOpen onDetailsToggle={toggle} />);
    expect(screen.getByRole("group", { name: "Andamento por informação" })).toContainElement(screen.getByText("linhas"));
    expect(screen.getByText("Ocultar detalhes")).toBeInTheDocument();
  });

  it("renders the end actions on the screen itself", () => {
    render(<FullScreenLoading {...base} busy={false} percent={100} outcome="ok" actions={<button type="button">Concluir</button>} />);
    expect(screen.getByRole("button", { name: "Concluir" })).toBeInTheDocument();
  });
});
