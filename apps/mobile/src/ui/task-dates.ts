/** `dd/mm/aaaa` + `hh:mm` typed by the seller -> ISO instant in the device time zone; null when invalid. */
export function parseTaskDateTime(date: string, time: string): string | null {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (d === null || t === null) return null;
  const [day, month, year, hour, minute] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])] as const;
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day || hour > 23 || minute > 59) return null;
  return value.toISOString();
}

export function formatTaskDateTime(iso: string): string {
  const v = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(v.getDate())}/${p(v.getMonth() + 1)}/${v.getFullYear()} ${p(v.getHours())}:${p(v.getMinutes())}`;
}

export const TASK_TYPE_LABEL = { call: "Ligação", visit: "Visita", email: "E-mail", whatsapp: "WhatsApp", meeting: "Reunião", other: "Outro" } as const;
export const TASK_REMINDER_OPTIONS: readonly { readonly value: number | null; readonly label: string }[] = [
  { value: null, label: "Sem lembrete" },
  { value: 0, label: "No horário" },
  { value: 15, label: "15 min antes" },
  { value: 30, label: "30 min antes" },
  { value: 60, label: "1 h antes" },
  { value: 1440, label: "1 dia antes" },
];
