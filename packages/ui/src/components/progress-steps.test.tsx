import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent } from "./dialog";
import { StepGroup, StepRow } from "./progress-steps";

describe("StepRow", () => {
  it("shows state, name and note, with the state as accessible text and no count", () => {
    render(
      <ul>
        <StepRow state="failed" label="Clientes" note="Sankhya indisponível" />
        <StepRow state="skipped" label="Pedidos" />
      </ul>,
    );
    const failed = screen.getByText("Clientes").closest("li");
    expect(failed).toHaveAttribute("data-state", "failed");
    expect(screen.getByRole("img", { name: "Falhou" })).toBeInTheDocument();
    expect(screen.getByText("Sankhya indisponível")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Não aplicável" })).toBeInTheDocument();
    expect(document.querySelector(".tabular-nums")).toBeNull();
  });

  it("marks the running row with a background and an in-progress icon", () => {
    render(
      <ul>
        <StepRow state="running" label="Produtos" />
      </ul>,
    );
    expect(screen.getByText("Produtos").closest("li")).toHaveClass("bg-surface-2");
    expect(screen.getByRole("img", { name: "Em andamento" })).toBeInTheDocument();
  });

  it("has a dark tone for lists over the full-screen loading", () => {
    render(
      <ul>
        <StepRow state="running" label="Produtos" tone="dark" />
      </ul>,
    );
    expect(screen.getByText("Produtos").closest("li")).toHaveClass("bg-white/10");
  });
});

describe("StepGroup", () => {
  it("renders a titled list", () => {
    render(
      <StepGroup title="Cadastros">
        <StepRow state="done" label="Vendedores" />
      </StepGroup>,
    );
    expect(screen.getByRole("heading", { name: "Cadastros" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("DialogContent", () => {
  it("keeps the X", () => {
    render(
      <Dialog open>
        <DialogContent title="T">corpo</DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
  });
});
