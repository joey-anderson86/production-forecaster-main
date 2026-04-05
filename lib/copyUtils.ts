import { WeeklyScorecard, PartScorecard, DailyScorecardRecord } from '@/lib/scorecardStore';
import { getWeekDates, getISODateForDay } from '@/lib/dateUtils';
import { distributeDemand } from '@/components/WeeklyPlanTable';

export function generateSmartCopy(
  sourceWeek: WeeklyScorecard,
  targetWeekId: string,
  anchorDates: Record<string, string>,
  departmentName: string
) {
  const targetWeekDates = getWeekDates(targetWeekId);

  // Group total target demand by partNumber
  const demandByPart = new Map<string, number>();
  
  sourceWeek.parts.forEach(part => {
    if (!part.partNumber) return;
    const partSum = part.dailyRecords.reduce((sum, rec) => sum + (rec.target || 0), 0);
    demandByPart.set(part.partNumber, (demandByPart.get(part.partNumber) || 0) + partSum);
  });

  const dbRecordsToUpsert: any[] = [];
  const newPartsForStore: PartScorecard[] = [];

  // For each unique part, generate 4 standard shifts
  demandByPart.forEach((totalDemand, partNumber) => {
    const groupId = crypto.randomUUID();
    
    // Generate the 4-shift child rows
    const childRows: PartScorecard[] = ['A', 'B', 'C', 'D'].map(shift => {
      const dailyRecords: DailyScorecardRecord[] = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map(day => ({
        dayOfWeek: day,
        actual: null,
        target: null,
        date: getISODateForDay(targetWeekId, day),
      }));

      return {
        id: crypto.randomUUID(),
        partNumber,
        shift,
        groupId,
        dailyRecords
      };
    });

    // Level-load if there is demand
    if (totalDemand > 0) {
      const distributions = distributeDemand(Math.floor(totalDemand), childRows, targetWeekDates, anchorDates);

      // Apply distribution back to the child rows
      distributions.forEach(d => {
        const row = childRows.find(r => r.id === d.rowId);
        if (row) {
          const rec = row.dailyRecords.find(r => r.dayOfWeek === d.day);
          if (rec) {
             rec.target = d.value;
          }
        }
      });
    }

    // Prepare flat payload for database upsert
    childRows.forEach(part => {
      part.dailyRecords.forEach(record => {
        dbRecordsToUpsert.push({
          department: departmentName,
          weekIdentifier: targetWeekId,
          partNumber: part.partNumber,
          dayOfWeek: record.dayOfWeek,
          target: record.target,
          actual: record.actual,
          date: record.date,
          shift: part.shift,
          reasonCode: record.reasonCode || null
        });
      });
    });

    newPartsForStore.push(...childRows);
  });

  return { dbRecordsToUpsert, newPartsForStore };
}
