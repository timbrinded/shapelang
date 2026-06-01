export type IsoDateString = string & { readonly __isoDateString: unique symbol };

export function isIsoCalendarDate(value: string): value is IsoDateString {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= daysInMonth(year, month);
}

export function parseIsoCalendarDate(value: string): IsoDateString | undefined {
  return isIsoCalendarDate(value) ? value : undefined;
}

export function requireIsoCalendarDate(value: string, label = "date"): IsoDateString {
  const parsed = parseIsoCalendarDate(value);
  if (parsed === undefined) {
    throw new TypeError(`${label} must be an ISO YYYY-MM-DD calendar date`);
  }
  return parsed;
}

// Calendar days in a month, with Gregorian leap-year rules. Kept as pure
// arithmetic (no `Date`) so the checker reads no wall clock and stays
// deterministic; the no-clock-in-checker invariant is locked by a test.
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeapYear ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
