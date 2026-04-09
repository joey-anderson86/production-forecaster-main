/**
 * Utility functions for date manipulation in the context of the Production Forecaster.
 */

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

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
 * Formats a Date object as YYYYMMDD string for SQL Server compatibility.
 */
export function formatSqlDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Formats an ISO date string (YYYY-MM-DD) as YYYYMMDD string for SQL Server compatibility.
 * Safe from timezone shifts because it avoids the Date constructor.
 */
export function formatSqlDateFromIso(dateStr: string): string {
  return dateStr.replace(/-/g, '');
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
/**
 * Gets the current ISO week ID (e.g., "2026-w13").
 */
export function getCurrentWeekId(): string {
  const now = new Date();
  const year = now.getFullYear();
  
  // ISO-8601 week number
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  
  return `${year}-w${String(weekNo).padStart(2, '0')}`;
}

/**
 * Gets the ISO week identifier (e.g., "2026-w13") for a specific Date object.
 */
export function getWeekIdentifier(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-w${String(weekNo).padStart(2, '0')}`;
}

/**
 * Gets the abbreviated DayOfWeek label (e.g. "Mon") for a specific Date object.
 */
export function getDayOfWeekLabel(date: Date): DayOfWeek {
  // Sunday is 0, Monday is 1, etc. in JS
  const index = (date.getDay() + 6) % 7; 
  return DAYS_OF_WEEK[index];
}

/**
 * Determines if a given date is a working day for a shift based on a 14-day 2-2-3 Panama schedule.
 * Cycle (14 days): 2 ON, 2 OFF, 3 ON, 2 OFF, 2 ON, 3 OFF
 * Working days: Day 0, 1, 4, 5, 6, 9, 10
 */
export function isWorkingDay(targetDate: Date, anchorDateString: string): boolean {
  if (!anchorDateString) return true; // Default to working if no anchor is set
  
  const PANAMA_WORKING_DAYS = [0, 1, 4, 5, 6, 9, 10];
  const anchor = new Date(anchorDateString);
  
  // Normalize both to midnight local time to avoid DST and time-of-day issues
  const t = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  
  const diffTime = t.getTime() - a.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  // Handle cycle (0-13)
  const cycleDay = ((diffDays % 14) + 14) % 14;
  
  return PANAMA_WORKING_DAYS.includes(cycleDay);
}

/**
 * Parses a YYYY-MM-DD string as a local Date object (midnight).
 * Avoids the "UTC trap" of new Date('YYYY-MM-DD').
 */
export function parseISOLocal(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Generates a display label for a week identifier (e.g., "2026-w14").
 * Format: Week {WW} ({M/D/YYYY} - {M/D/YYYY})
 */
export function generateWeekLabel(weekString: string): string {
  const isoWeekRegex = /^\d{4}-w\d{2}$/i;
  
  if (!weekString || !isoWeekRegex.test(weekString)) {
    return 'Enter a valid week identifier...';
  }

  try {
    const [yearStr, weekStr] = weekString.split('-w');
    const year = parseInt(yearStr);
    const week = parseInt(weekStr);

    // Use dayjs with isoWeek to find the Monday and Sunday
    const monday = dayjs().year(year).isoWeek(week).startOf('isoWeek');
    const sunday = monday.endOf('isoWeek');

    // Format: Week 14 (3/30/2026 - 4/5/2026)
    return `Week ${week} (${monday.format('M/D/YYYY')} - ${sunday.format('M/D/YYYY')})`;
  } catch (err) {
    console.error("Failed to generate week label:", err);
    return 'Invalid week identifier';
  }
}
