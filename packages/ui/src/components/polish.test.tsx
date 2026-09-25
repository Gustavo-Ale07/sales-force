import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, type CommandItem } from "./command-palette";
import { StatusDot } from "./badge";
import { PageHeader } from "./page-header";
import { StatGrid, StatTile } from "./stat";

const items = (onSelect: (id: string) => void): CommandItem[] => [
  { id: "home", label: "Início", group: "Páginas", onSelect: () => onSelect("home") },
  { id: "customers", label: "Clientes", group: "Páginas", keywords: "carteira", onSelect: () => onSelect("customers") },
  { id: "new-order", label: "Novo pedido", group: "Ações", onSelect: () => onSelect("new-order") },
];

function Harness({ onSelect }: { onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  return <CommandPalette open={open} onOpenChange={setOpen} items={items(onSelect)} />;
}

describe("CommandPalette", () => {
  it("focuses the search, preselects the first result and groups the items", () => {
    render(<Harness onSelect={vi.fn()} />);
    const search = screen.getByRole("combobox");
    expect(search).toHaveFocus();
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Início", "Clientes", "Novo pedido"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(search).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-labelledby") !== null)).toEqual([true, true]);
  });

  it("filters ignoring case and diacritics, also by keyword, and opens the highlighted item with Enter", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "CARTEIRA");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("customers");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("moves with the arrow keys (wrapping) and closes with Escape", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const user = userEvent.setup();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: "Novo pedido" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Início" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows an empty state instead of an empty list", async () => {
    render(<Harness onSelect={vi.fn()} />);
    await userEvent.setup().type(screen.getByRole("combobox"), "zzzz");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Nenhum resultado/i);
  });
});

describe("StatusDot", () => {
  it("always renders the text; the dot is decorative", () => {
    render(<StatusDot tone="success">Ativo</StatusDot>);
    const status = screen.getByText("Ativo");
    expect(status.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});

describe("PageHeader", () => {
  it("renders the count next to the title inside the heading", () => {
    render(<PageHeader title="Clientes" count="128" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Clientes128");
  });
});

describe("StatGrid", () => {
  it("groups the metrics in one card by default and keeps separate tiles on request", () => {
    const { container, rerender } = render(
      <StatGrid>
        <StatTile label="A" value="1" />
        <StatTile label="B" value="2" />
      </StatGrid>,
    );
    expect(container.querySelector("[data-stat-strip]")).not.toBeNull();
    rerender(
      <StatGrid variant="tiles">
        <StatTile label="A" value="1" />
      </StatGrid>,
    );
    expect(container.querySelector("[data-stat-strip]")).toBeNull();
    expect(within(container).getByText("A")).toBeInTheDocument();
  });
});
