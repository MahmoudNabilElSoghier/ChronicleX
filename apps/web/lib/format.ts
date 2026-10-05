const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toArabicDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)] ?? d);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = n / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const rounded = size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const loc = locale === 'ar' ? 'ar-EG' : 'en-US';
  const fmt = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
  const table: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [86400 * 30, 'day'],
    [86400 * 365, 'month'],
    [Infinity, 'year'],
  ];
  for (const [limit, unit] of table) {
    if (seconds < limit) {
      const div = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : unit === 'day' ? 86400 : unit === 'month' ? 2592000 : 31536000;
      return fmt.format(-Math.floor(seconds / div), unit);
    }
  }
  return iso;
}

export function formatSerial(serial: string): string {
  return serial;
}
