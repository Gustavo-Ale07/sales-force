/** Date presets of the sales list (same as the app: Hoje, Últimos 7 dias, Últimos 30 dias, Personalizado). Calendar dates, inclusive. */
export type PeriodPreset = "all" | "today" | "7d" | "30d" | "custom";

export const PERIOD_PRESET_OPTIONS = [
  { value: "all", label: "Todo o período" },
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "custom", label: "Personalizado" },
] as const;

/** `YYYY-MM-DD` of the business day (America/Sao_Paulo). */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function presetRange(preset: Exclude<PeriodPreset, "custom">, today: string): { from?: string; to?: string } {
  switch (preset) {
    case "all":
      return {};
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
  }
}

export function detectPreset(from: string | undefined, to: string | undefined, today: string): PeriodPreset {
  if (from === undefined && to === undefined) return "all";
  for (const preset of ["today", "7d", "30d"] as const) {
    const range = presetRange(preset, today);
    if (range.from === from && range.to === to) return preset;
  }
  return "custom";
}
