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
  
  sourceWeek.parts.forEach(part => {
    if (!part.partNumber) return;
    const partSum = part.dailyRecords.reduce((sum, rec) => sum + (rec.target || 0), 0);
    demandByPart.set(part.partNumber, (demandByPart.get(part.partNumber) || 0) + partSum);
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
      const processingTimeMin = partInfo.find(p => p.partNumber === partNumber && p.process === departmentName)?.processingTime || 0;
      
      const req = {
         totalDemand: Math.floor(totalDemand),
         childRows: childRows.map(r => ({ id: r.id, shift: r.shift })),
         weekDates: weekDateStrings,
         anchorDates,
         shiftCapacities,
         processingTimeMin
      };

      const distributions = await invoke<any[]>('calculate_demand_distribution', { req });

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
          Department: departmentName,
          WeekIdentifier: targetWeekId,
          PartNumber: part.partNumber,
          DayOfWeek: record.dayOfWeek,
          Target: record.target,
          Actual: record.actual,
          Date: record.date,
          Shift: part.shift,
          ReasonCode: record.reasonCode || null
        });
      });
    });

    newPartsForStore.push(...childRows);
  }

  return { dbRecordsToUpsert, newPartsForStore };
}
