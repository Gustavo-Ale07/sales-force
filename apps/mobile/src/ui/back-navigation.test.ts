import { EXIT_WINDOW_MS, resolveBack, type BackState } from "./back-navigation";

const base: BackState = { overlay: "none", tab: "home", wizardOpen: false, saleDetailOpen: false, customerDetailOpen: false, exitArmedAt: null, now: 10_000 };
const at = (over: Partial<BackState>): ReturnType<typeof resolveBack>["type"] => resolveBack({ ...base, ...over }).type;

describe("resolveBack: overlay > wizard > inner > tab root > home", () => {
  it("the sync screen swallows Back (safe: it never cancels or leaves by accident)", () => {
    expect(at({ overlay: "sync", tab: "sales", wizardOpen: true })).toBe("ignore");
  });

  it("the retained-orders screen closes first, before anything under it", () => {
    expect(at({ overlay: "quarantine", tab: "sales", wizardOpen: true })).toBe("close_quarantine");
  });

  it("an open order wizard takes Back (one step back, or save-and-leave on step 1, decided by the wizard)", () => {
    expect(at({ tab: "sales", wizardOpen: true, saleDetailOpen: true })).toBe("wizard_back");
  });

  it("inner screens go to the previous screen", () => {
    expect(at({ tab: "customers", customerDetailOpen: true })).toBe("close_customer_detail");
    expect(at({ tab: "sales", saleDetailOpen: true })).toBe("close_sale_detail");
  });

  it("the root of a tab other than Início goes to Início", () => {
    for (const tab of ["customers", "sales", "catalog", "profile"] as const) expect(at({ tab })).toBe("go_home");
  });

  it("a hidden wizard on another tab never takes Back", () => {
    expect(at({ tab: "catalog", wizardOpen: true, saleDetailOpen: true, customerDetailOpen: true })).toBe("go_home");
  });

  it("Início: the first press only shows the hint", () => {
    expect(at({})).toBe("arm_exit");
  });

  it("Início: a second press within 2 s exits", () => {
    expect(at({ exitArmedAt: base.now - 500 })).toBe("exit_app");
    expect(at({ exitArmedAt: base.now - EXIT_WINDOW_MS })).toBe("exit_app");
  });

  it("Início: after 2 s the hint shows again instead of exiting", () => {
    expect(at({ exitArmedAt: base.now - EXIT_WINDOW_MS - 1 })).toBe("arm_exit");
  });
});
