import { render, screen } from "@testing-library/react-native";
import type { LocalOrdersPort } from "../offline/local-orders";
import { fakeLocalOrders } from "../test-doubles";
import { SaleDetailScreen } from "./sale-detail-screen";

const noop = () => undefined;

function renderDetail(localOrders: LocalOrdersPort) {
  return render(<SaleDetailScreen localId="x" localOrders={localOrders} connectivity="online" onBack={noop} onChanged={noop} onContinue={noop} onDuplicate={noop} onSyncNow={noop} />);
}

describe("SaleDetailScreen loading", () => {
  it("shows a spinner with a label while the sale is being read, not a blank view", async () => {
    await renderDetail(fakeLocalOrders([], { open: () => new Promise(() => undefined) }));
    expect(screen.getByText("Carregando venda...")).toBeTruthy();
    expect(screen.getByLabelText("Carregando venda")).toBeTruthy();
  });

  it("replaces the loading state with the not-found message when the sale is gone", async () => {
    await renderDetail(fakeLocalOrders([], { open: async () => null }));
    expect(await screen.findByText("Esta venda não está mais neste aparelho.")).toBeTruthy();
    expect(screen.queryByText("Carregando venda...")).toBeNull();
  });
});
