import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Alert } from "./alert";
import { Button } from "./button";
import { Combobox } from "./combobox";
import { FormField } from "./form";
import { Input } from "./input";
import { Money } from "./money";
import { Pagination, pageWindow } from "./pagination";
import { EmptyState, ErrorState } from "./states";
import { SortableHead, Table, TableBody, TableCell, TableHeader, TableRow } from "./table";

describe("Button", () => {
  it("is busy and not clickable while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Entrar
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Entrar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("defaults to type=button", () => {
    render(<Button>Ok</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("FormField", () => {
  it("wires label, error and hint to the control", () => {
    render(
      <FormField label="E-mail" required error="Informe o e-mail" hint="Use o e-mail corporativo">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText(/E-mail/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toHaveLength(2);
    expect(document.getElementById(described[0]!)).toHaveTextContent("Informe o e-mail");
  });
});

describe("Money", () => {
  it("renders the fallback for missing prices, not zero", () => {
    render(<Money value={null} fallback="Sem preço" />);
    expect(screen.getByText("Sem preço")).toHaveAttribute("data-missing", "true");
  });
});

describe("Alert", () => {
  it("uses role=alert for danger and role=status for info", () => {
    render(
      <>
        <Alert tone="danger" title="Erro" />
        <Alert tone="info" title="Aviso" />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Erro");
    expect(screen.getByRole("status")).toHaveTextContent("Aviso");
  });
});

describe("states", () => {
  it("ErrorState offers retry", async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} correlationId="c-1" />);
    await userEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText("c-1")).toBeInTheDocument();
  });
  it("EmptyState renders title and description", () => {
    render(<EmptyState title="Em construção" description="Chega em breve" />);
    expect(screen.getByText("Em construção")).toBeInTheDocument();
  });
});

describe("Table", () => {
  it("exposes aria-sort and supports arrow-key row navigation", async () => {
    const onSort = vi.fn();
    render(
      <Table label="Clientes">
        <TableHeader>
          <tr>
            <SortableHead direction="asc" onSort={onSort}>
              Cliente
            </SortableHead>
          </tr>
        </TableHeader>
        <TableBody>
          <TableRow interactive>
            <TableCell>A</TableCell>
          </TableRow>
          <TableRow interactive>
            <TableCell>B</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: /Cliente/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /Cliente/ }));
    expect(onSort).toHaveBeenCalled();
    const rows = screen.getAllByRole("row").slice(1);
    rows[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(rows[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(rows[0]).toHaveFocus();
  });
});

describe("Pagination", () => {
  it("shows the range and navigates", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageSize={25} total={38} onPageChange={onPageChange} />);
    expect(screen.getByText("Mostrando 1–25 de 38")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
  });
  it("collapses long page lists", () => {
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("Combobox", () => {
  function Harness() {
    const [value, setValue] = useState<string | null>(null);
    return (
      <Combobox
        aria-label="Cliente"
        value={value}
        onValueChange={setValue}
        options={[
          { value: "1", label: "Metalúrgica Vale Azul" },
          { value: "2", label: "Comercial Serra" },
        ]}
      />
    );
  }
  it("filters, navigates by keyboard and selects", async () => {
    render(<Harness />);
    const box = screen.getByRole("combobox", { name: "Cliente" });
    await userEvent.click(box);
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(2);
    await userEvent.type(box, "serra");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(box).toHaveValue("Comercial Serra");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
