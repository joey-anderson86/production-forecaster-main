import { WeeklyScorecard, PartScorecard, DailyScorecardRecord } from '@/lib/scorecardStore';
import { getWeekDates, getISODateForDay, formatISODate } from '@/lib/dateUtils';

export async function generateSmartCopy(
  sourceWeek: WeeklyScorecard,
  targetWeekId: string,
  anchorDates: Record<string, string>,
  departmentName: string,
  getAvailableCapacity: (dayIndex: number, shift: string) => number,
  partInfo: any[]
) {
  const targetWeekDates = getWeekDates(targetWeekId);

  // Group total target demand by partNumber
  const demandByPart = new Map<string, number>();
  
  sourceWeek.Parts.forEach(part => {
    if (!part.PartNumber) return;
    const partSum = part.DailyRecords.reduce((sum, rec) => sum + (rec.Target || 0), 0);
    demandByPart.set(part.PartNumber, (demandByPart.get(part.PartNumber) || 0) + partSum);
  });

  const dbRecordsToUpsert: any[] = [];
  const newPartsForStore: PartScorecard[] = [];

  const shiftCapacities = [0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
      const capacities: Record<string, number> = {};
      ['A', 'B', 'C', 'D'].forEach(shift => {
         capacities[shift] = getAvailableCapacity(dayIdx, shift);
      });
      return capacities;
  });
  const weekDateStrings = targetWeekDates.map(d => d ? formatISODate(d) : null);
  const { invoke } = await import('@tauri-apps/api/core');

  // For each unique part, generate 4 standard shifts
  for (const [partNumber, totalDemand] of Array.from(demandByPart.entries())) {
    const groupId = crypto.randomUUID();
    
    // Generate the 4-shift child rows
    const childRows: PartScorecard[] = ['A', 'B', 'C', 'D'].map(shift => {
      const DailyRecords: DailyScorecardRecord[] = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map(day => ({
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

    // Level-load if there is demand
    if (totalDemand > 0) {
      const processingTimeMin = partInfo.find(p => p.PartNumber === partNumber && p.Process === departmentName)?.ProcessingTime || 0;
      
      const req = {
         totalDemand: Math.floor(totalDemand),
         childRows: childRows.map(r => ({ id: r.Id, shift: r.Shift })),
         weekDates: weekDateStrings,
         anchorDates,
         shiftCapacities,
         processingTimeMin
      };

      const distributions = await invoke<any[]>('calculate_demand_distribution', { req });

      // Apply distribution back to the child rows
      distributions.forEach(d => {
        const row = childRows.find(r => r.Id === d.rowId);
        if (row) {
          const rec = row.DailyRecords.find(r => r.DayOfWeek === d.day);
          if (rec) {
             rec.Target = d.value;
          }
        }
      });
    }

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
