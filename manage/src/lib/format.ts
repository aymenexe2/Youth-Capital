import type { Lang } from "./i18n";

const locale = (lang: Lang) => (lang === "fr" ? "fr-MA" : lang === "ar" ? "ar-MA" : "en-GB");

// Dates are shown in the organisation's configured timezone.
export function formatDate(value: string | Date | null | undefined, lang: Lang, tz?: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "—";
  // Plain YYYY-MM-DD values are calendar dates, not instants: don't shift them.
  const isDateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = isDateOnly ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (isNaN(+d)) return "—";
  return new Intl.DateTimeFormat(locale(lang), { ...opts, timeZone: isDateOnly ? "UTC" : tz }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, lang: Lang, tz?: string) {
  return formatDate(value, lang, tz, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatNumber(n: number, lang: Lang) {
  return new Intl.NumberFormat(locale(lang)).format(n);
}

export function relativeTime(value: string | Date | null | undefined, lang: Lang) {
  if (!value) return "—";
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function isOverdue(due: string | null | undefined, status: string) {
  return Boolean(due && due < todayISO() && status !== "completed" && status !== "cancelled");
}

export function initials(name?: string | null) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(","))].join("\n");
}

export function downloadFile(name: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF" + content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Amounts arrive as exact decimal strings ("1234.50"); Number() is only used for display.
export function formatMoney(amount: string | number | null | undefined, currency: string, lang: Lang) {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat(locale(lang), { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
