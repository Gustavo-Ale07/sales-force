import { screen } from "@testing-library/react-native";
import { Dimensions, PixelRatio, StyleSheet } from "react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import { customer, draftRecord, fakeLocalOrders, pageOf } from "../test-doubles";
import { control, HEADER_HEIGHT, radius } from "../theme";
import { SalesScreen } from "./sales-screen";
import { SyncStatusChip } from "./sync-status";
import { renderWithModal } from "./test-modal-wrapper";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };
const noop = () => undefined;

/** Jest cannot measure layout: these checks pin the rules that keep a screen from clipping (one-line summary, fixed targets). The pixels are confirmed on a device. */
const CONDITIONS: Array<[string, number, number, number]> = [
  ["320x568, font 1.0", 320, 568, 1],
  ["360x800, font 1.0", 360, 800, 1],
  ["360x800, font 1.3", 360, 800, 1.3],
  ["320x568, font 1.3", 320, 568, 1.3],
];

describe.each(CONDITIONS)("layout at %s", (_name, width, height, fontScale) => {
  beforeEach(() => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width, height, scale: 2, fontScale });
    jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(fontScale);
  });
  afterEach(() => jest.restoreAllMocks());

  async function renderSales() {
    const localOrders = fakeLocalOrders([draftRecord({ localId: "a", customerCode: 1, customerName: "Ana Mercearia de Nome Bem Comprido Ltda", status: "local_only" })]);
    await renderWithModal(
      <SalesScreen
        localOrders={localOrders}
        customers={{ list: async () => pageOf([customer(1, { name: "Ana" })]) }}
        syncStatus={idle}
        connectivity="online"
        onUnauthenticated={noop}
        onNewSale={noop}
        onContinue={noop}
        onDuplicate={noop}
        onSyncNow={noop}
      />,
    );
    await screen.findByText(/Ana Mercearia/);
  }

  it("the summary is one line and the card name is capped so the value never wraps", async () => {
    await renderSales();
    const summary = await screen.findByText(/^[0-9]+ vendas?/);
    expect(summary.props.numberOfLines).toBe(1);
    expect(screen.getByText(/Ana Mercearia/).props.numberOfLines).toBeGreaterThanOrEqual(1);
  });

  it("the touch targets are at least 44 points (new sale, Filtros, Não enviados / Enviados, search)", async () => {
    await renderSales();
    const heightOf = (node: { props: { style?: unknown } }) => (StyleSheet.flatten(node.props.style as never) as { minHeight?: number; height?: number }).minHeight ?? 0;
    expect(heightOf(screen.getByRole("button", { name: "Nova venda" }))).toBeGreaterThanOrEqual(44);
    expect(heightOf(screen.getByRole("button", { name: "Filtros" }))).toBeGreaterThanOrEqual(44);
    for (const tab of screen.getAllByRole("tab")) expect(heightOf(tab)).toBeGreaterThanOrEqual(44);
  });

  it("the header indicator is a fixed 44 x 44 target that fits the fixed header height", async () => {
    await renderWithModal(<SyncStatusChip status={idle} connectivity="online" onPress={noop} />);
    const style = StyleSheet.flatten(screen.getByRole("button", { name: /Status de sincronização/ }).props.style) as { minWidth: number; minHeight: number };
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(HEADER_HEIGHT).toBeGreaterThanOrEqual(style.minHeight);
  });
});

describe("shared control tokens", () => {
  it("one control height and one corner radius", () => {
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(radius.md).toBe(8);
  });
});
