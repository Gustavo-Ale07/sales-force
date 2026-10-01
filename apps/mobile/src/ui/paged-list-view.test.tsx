import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
import { networkError } from "../test-doubles";
import { PagedListView } from "./paged-list-view";

describe("PagedListView retry", () => {
  it("offers a retry control with a 44-point touch target", async () => {
    const load = jest.fn(async () => {
      throw networkError();
    });
    await render(
      <PagedListView<string>
        load={load}
        keyOf={(item) => item}
        renderItem={(item) => <Text>{item}</Text>}
        searchLabel="Buscar"
        emptyText="Vazio"
        onUnauthenticated={() => undefined}
      />,
    );
    const retry = await screen.findByRole("button", { name: "Tentar novamente" });
    const style = StyleSheet.flatten(retry.props.style) as { minHeight?: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    const before = load.mock.calls.length;
    await fireEvent.press(retry);
    expect(load.mock.calls.length).toBeGreaterThan(before);
  });
});
