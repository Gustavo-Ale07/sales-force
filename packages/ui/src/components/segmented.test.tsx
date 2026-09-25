import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SegmentedControl } from "./segmented";

const options = [
  { value: "any", label: "Qualquer selecionado" },
  { value: "all", label: "Todos selecionados" },
] as const;

function Harness() {
  const [value, setValue] = useState<"any" | "all">("any");
  return <SegmentedControl aria-label="Correspondência" value={value} onValueChange={setValue} options={options} />;
}

describe("SegmentedControl", () => {
  it("is a named radio group with the current choice checked and changes it on click", async () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Correspondência" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Qualquer selecionado" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Todos selecionados" }));
    expect(screen.getByRole("radio", { name: "Todos selecionados" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Qualquer selecionado" })).not.toBeChecked();
  });

  it("is a single tab stop and the arrow keys move between the choices", async () => {
    render(<Harness />);
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Qualquer selecionado" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Todos selecionados" })).toHaveFocus();
  });
});
