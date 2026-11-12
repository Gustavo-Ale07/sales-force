import { act, fireEvent, screen } from "@testing-library/react-native";

async function press(element: unknown, delayMs = 60) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

/**
 * Test helper for the Negociação step: negotiation type, freight and carrier are mandatory (owner ruling 2026-11-12),
 * so a test that walks the wizard picks them before "Avançar". Touches only what is still empty.
 */
export async function fillMandatoryHeader(): Promise<void> {
  const negotiationChips = await screen.findAllByLabelText(/^Negociação /);
  if (!negotiationChips.some((chip) => chip.props.accessibilityState?.selected === true)) await press(negotiationChips[0]);
  const cif = screen.getByLabelText("Frete CIF");
  const anyFreight = ["Frete CIF", "Frete FOB", "Frete Sem frete"].some((label) => screen.getByLabelText(label).props.accessibilityState?.selected === true);
  if (!anyFreight) await press(cif);
  // The carrier button shows "Escolher transportadora" while nothing is chosen; the sheet lists the carriers.
  if (screen.queryByText("Escolher transportadora") !== null) {
    await press(await screen.findByLabelText("Escolher transportadora"));
    await press((await screen.findAllByLabelText(/^Transportadora Transportes/))[0]);
  }
}
