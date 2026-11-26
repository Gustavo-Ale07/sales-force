import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SellerPicker } from "./seller-picker";

const sellers = [
  { code: 3, name: "José Álvares", active: true },
  { code: 1, name: "Ana Paula", active: true },
  { code: 4, name: "Inativo", active: false },
];

function Harness({ onPick }: { onPick: (code: number | null) => void }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <SellerPicker
      aria-label="Vendedor"
      sellers={sellers}
      value={value}
      onChange={(code) => {
        setValue(code);
        onPick(code);
      }}
    />
  );
}

describe("SellerPicker", () => {
  it("lists active sellers alphabetically on focus", async () => {
    render(<Harness onPick={() => undefined} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Vendedor" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ana Paula", "José Álvares"]);
  });

  it("filters by typed text ignoring case and accent, and picks on click", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole("combobox", { name: "Vendedor" });
    await userEvent.type(input, "JOSE");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.click(screen.getByRole("option", { name: "José Álvares" }));
    expect(onPick).toHaveBeenCalledWith(3);
    expect(input).toHaveValue("José Álvares");
  });

  it("shows an empty list without matches", async () => {
    render(<Harness onPick={() => undefined} />);
    await userEvent.type(screen.getByRole("combobox", { name: "Vendedor" }), "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByText("Nenhum resultado")).not.toBeInTheDocument();
  });

  it("keeps the chosen seller shown after a search that hid it was abandoned", async () => {
    render(<Harness onPick={() => undefined} />);
    const input = screen.getByRole("combobox", { name: "Vendedor" });
    await userEvent.click(input);
    await userEvent.click(screen.getByRole("option", { name: "Ana Paula" }));
    await userEvent.click(input);
    await userEvent.type(input, "jose");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("Ana Paula");
  });
});
