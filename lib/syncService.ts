import Papa from 'papaparse';
import { DepartmentScorecard } from './scorecardStore';

/**
 * Serializes the entire departments state into a single CSV string.
 * Format: Department, WeekIdentifier, PartNumber, DayOfWeek, Target, Actual, ReasonCode
 */
export function serializeStoreToCsv(departments: Record<string, DepartmentScorecard>): string {
  const csvData: any[][] = [
    ["Department", "WeekIdentifier", "PartNumber", "DayOfWeek", "Target", "Actual", "ReasonCode"]
  ];

  Object.values(departments).forEach(dept => {
    Object.values(dept.weeks).forEach(week => {
      week.parts.forEach(part => {
        part.dailyRecords.forEach(record => {
          csvData.push([
            dept.departmentName,
            week.weekLabel,
            part.partNumber,
            record.dayOfWeek,
            record.target !== null ? record.target : "",
            record.actual !== null ? record.actual : "",
            record.reasonCode || ""
          ]);
        });
      });
    });
  });

  return Papa.unparse(csvData);
}

/**
 * Writes the serialized CSV data to the specified file path using Tauri's FS API.
 */
export async function syncStoreToFile(path: string, departments: Record<string, DepartmentScorecard>): Promise<void> {
  // Check if we are in a Tauri environment
  // @ts-ignore
  const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
  
  if (isTauri) {
    try {
      console.log('Syncing to:', path);
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const csv = serializeStoreToCsv(departments);
      await writeTextFile(path, csv);
      console.log('Sync successful');
    } catch (error: any) {
      console.error('Failed to sync to file:', error);
      throw new Error(`Tauri FS Error: ${error?.message || error}`);
    }
  } else {
    console.warn('Sync requested but not in a Tauri environment.');
    throw new Error('Sync only available in Tauri desktop environment');
  }
}
