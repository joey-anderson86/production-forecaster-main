/**
 * Utility functions for date manipulation in the context of the Production Forecaster.
 */

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Parses a week identifier (e.g., "2026-w41") and returns the Monday of that week.
 * Follows ISO-8601 week numbering.
 */
export function getMondayOfWeek(weekId: string): Date {
  const parts = weekId.split('-w');
  if (parts.length !== 2) {
    // Fallback: if format is "week-1742549717123", we can't easily get a real date.
    // However, for numeric date requirements, we should try our best.
    if (weekId.startsWith('week-')) {
       const timestamp = parseInt(weekId.replace('week-', ''));
       if (!isNaN(timestamp)) {
         const date = new Date(timestamp);
         // Move to Monday of that week
         const day = date.getDay();
         const diff = date.getDate() - day + (day === 0 ? -6 : 1);
         return new Date(date.setDate(diff));
       }
    }
    return new Date(); // Default fallback
  }

  const year = parseInt(parts[0]);
  const weekNumber = parseInt(parts[1]);

  // Create a date for January 4th of that year (which is always in week 1)
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay();
  // ISO Monday of week 1
  const mon1 = new Date(year, 0, 4 - (day === 0 ? 6 : day - 1));
  
  // Add (weekNumber - 1) weeks
  const targetMonday = new Date(mon1.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);
  return targetMonday;
}

/**
 * Returns an array of Date objects for each day in the week starting from the given Monday.
 */
export function getWeekDates(weekId: string): Date[] {
  const monday = getMondayOfWeek(weekId);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getTime());
    d.setDate(monday.getDate() + i);
    return d;
  });
}

/**
 * Formats a Date object as YYYYMMDD numeric value.
 */
export function formatNumericDate(date: Date): number {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return parseInt(`${y}${m}${d}`);
}

/**
 * Formats a Date object as YYYY-MM-DD string.
 */
export function formatISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns current date as numeric YYYYMMDD
 */
export function getTodayNumeric(): number {
  return formatNumericDate(new Date());
}

/**
 * Gets the numeric date for a specific day of the week within a week ID.
 */
export function getNumericDateForDay(weekId: string, day: DayOfWeek): number {
  const dates = getWeekDates(weekId);
  const index = DAYS_OF_WEEK.indexOf(day);
  return formatNumericDate(dates[index]);
}

/**
 * Gets the ISO date for a specific day of the week within a week ID.
 */
export function getISODateForDay(weekId: string, day: DayOfWeek): string {
  const dates = getWeekDates(weekId);
  const index = DAYS_OF_WEEK.indexOf(day);
  return formatISODate(dates[index]);
}
