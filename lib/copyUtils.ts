import { WeeklyScorecard, PartScorecard, DailyScorecardRecord } from '@/lib/scorecardStore';
import { getWeekDates, getISODateForDay, formatISODate, isWorkingDay } from '@/lib/dateUtils';

export async function generateSmartCopy(
  sourceWeek: WeeklyScorecard,
  targetWeekId: string,
  anchorDates: Record<string, string>,
  departmentName: string,
  getAvailableCapacity: (dayIndex: number, shift: string) => number,
  partInfo: any[]
) {
  // Group total target demand by partNumber to find all parts that have active schedule rows
  const uniquePartNumbers = Array.from(new Set(sourceWeek.Parts.map(p => p.PartNumber).filter(Boolean)));

  const dbRecordsToUpsert: any[] = [];
  const newPartsForStore: PartScorecard[] = [];

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

  // For each unique part, generate 4 standard shifts
  for (const partNumber of uniquePartNumbers) {
    const groupId = crypto.randomUUID();
    
    // Generate the 4-shift child rows
    const childRows: PartScorecard[] = ['A', 'B', 'C', 'D'].map(shift => {
      const DailyRecords: DailyScorecardRecord[] = DAYS.map(day => ({
        DayOfWeek: day,
        Actual: null,
        Target: null,
        Date: getISODateForDay(targetWeekId, day),
      }));

      return {
        Id: crypto.randomUUID(),
        PartNumber: partNumber,
        Shift: shift,
        GroupId: groupId,
        DailyRecords: DailyRecords
      };
    });

    // Transpose the daily target quantities from the source week to the correct shifts in the target week
    DAYS.forEach(day => {
      const targetDate = getISODateForDay(targetWeekId, day);

      const isABWorkingTarget = isWorkingDay(targetDate, anchorDates['A'] || '');
      const isCDWorkingTarget = isWorkingDay(targetDate, anchorDates['C'] || '');

      ['A', 'B', 'C', 'D'].forEach(sourceShift => {
        const sourcePart = sourceWeek.Parts.find(p => p.PartNumber === partNumber && p.Shift === sourceShift);
        const sourceRec = sourcePart?.DailyRecords.find(r => r.DayOfWeek === day);
        const val = sourceRec?.Target;

        if (val !== null && val !== undefined && val > 0) {
          let targetShift = sourceShift;
          const isSourceShiftWorkingTarget = isWorkingDay(targetDate, anchorDates[sourceShift] || '');

          if (!isSourceShiftWorkingTarget) {
            if (sourceShift === 'A' || sourceShift === 'C') {
              if (isABWorkingTarget) targetShift = 'A';
              else if (isCDWorkingTarget) targetShift = 'C';
            } else if (sourceShift === 'B' || sourceShift === 'D') {
              if (isABWorkingTarget) targetShift = 'B';
              else if (isCDWorkingTarget) targetShift = 'D';
            }
          }

          const targetRow = childRows.find(r => r.Shift === targetShift);
          if (targetRow) {
            const targetRec = targetRow.DailyRecords.find(r => r.DayOfWeek === day);
            if (targetRec) {
              targetRec.Target = val;
            }
          }
        }
      });
    });

    // Prepare flat payload for database upsert
    childRows.forEach(part => {
      part.DailyRecords.forEach(record => {
        dbRecordsToUpsert.push({
          Department: departmentName,
          WeekIdentifier: targetWeekId,
          PartNumber: part.PartNumber,
          DayOfWeek: record.DayOfWeek,
          Target: record.Target,
          Actual: record.Actual,
          Date: record.Date,
          Shift: part.Shift,
          ReasonCode: record.ReasonCode || null
        });
      });
    });

    newPartsForStore.push(...childRows);
  }

  return { dbRecordsToUpsert, newPartsForStore };
}
