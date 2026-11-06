import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent } from "./dialog";
import { OutcomeMark, ProgressSteps, StepGroup, StepRow } from "./progress-steps";

describe("ProgressSteps", () => {
  it("exposes one progressbar with a clamped value, caption and summary", () => {
    render(<ProgressSteps value={140} label="Progresso" caption="Atualizando preços…" summary="5 de 10" />);
    const bar = screen.getByRole("progressbar", { name: "Progresso" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("Atualizando preços…")).toBeInTheDocument();
    expect(screen.getByText("5 de 10")).toBeInTheDocument();
  });

  it("rounds and never goes below zero", () => {
    render(<ProgressSteps value={-3} label="P" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("StepRow", () => {
  it("shows state, name, count and note, with the state as accessible text", () => {
    render(
      <ul>
        <StepRow state="failed" label="Clientes" value="12" note="Sankhya indisponível" />
        <StepRow state="skipped" label="Pedidos" />
      </ul>,
    );
    const failed = screen.getByText("Clientes").closest("li");
    expect(failed).toHaveAttribute("data-state", "failed");
    expect(screen.getByRole("img", { name: "Falhou" })).toBeInTheDocument();
    expect(screen.getByText("12")).toHaveClass("tabular-nums");
    expect(screen.getByText("Sankhya indisponível")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Não aplicável" })).toBeInTheDocument();
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
});

describe("StepGroup / OutcomeMark", () => {
  it("renders a titled list", () => {
    render(
      <StepGroup title="Cadastros">
        <StepRow state="done" label="Vendedores" />
      </StepGroup>,
    );
    expect(screen.getByRole("heading", { name: "Cadastros" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("labels the outcome", () => {
    render(<OutcomeMark tone="warn" />);
    expect(screen.getByRole("img", { name: "Atenção" })).toBeInTheDocument();
  });
});

describe("DialogContent dismissible=false", () => {
  it("has no close button and focuses the dialog itself", async () => {
    render(
      <Dialog open>
        <DialogContent title="Atualizando" dismissible={false}>
          corpo
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole("button", { name: "Fechar" })).toBeNull();
    const dialog = screen.getByRole("dialog");
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(dialog);
  });

  it("keeps the X by default", () => {
    render(
      <Dialog open>
        <DialogContent title="T">corpo</DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
  });
});
