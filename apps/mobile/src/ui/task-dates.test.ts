import { formatTaskDateTime, parseTaskDateTime } from "./task-dates";

describe("task dates", () => {
  it("parses a valid local date and time", () => {
    const iso = parseTaskDateTime("27/11/2026", "14:30");
    expect(iso).not.toBeNull();
    expect(formatTaskDateTime(iso as string)).toBe("27/11/2026 14:30");
  });
  it("rejects impossible dates and times", () => {
    expect(parseTaskDateTime("31/02/2026", "10:00")).toBeNull();
    expect(parseTaskDateTime("27/11/2026", "25:00")).toBeNull();
    expect(parseTaskDateTime("2026-11-27", "10:00")).toBeNull();
  });
});
