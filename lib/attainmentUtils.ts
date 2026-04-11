import { WeeklyScorecard } from './scorecardStore';

export interface ShiftAttainmentData {
  shift: string;
  attainment: number;
}

/**
 * Calculates Capped Attainment by Shift for a given week.
 * 
 * Formula: (SUM of Math.min(Actual, Target) / SUM of Target) * 100
 * Records with Target = 0 or null are excluded.
 */
export function calculateShiftAttainment(weekData: WeeklyScorecard | null): ShiftAttainmentData[] {
  if (!weekData || !weekData.parts) return [];

  const shiftTotals: Record<string, { cappedActual: number; totalTarget: number }> = {};

  weekData.parts.forEach(part => {
    const shift = part.shift || 'Unknown';
    if (!shiftTotals[shift]) {
      shiftTotals[shift] = { cappedActual: 0, totalTarget: 0 };
    }

    part.dailyRecords.forEach(record => {
      const actual = record.actual;
      const target = record.target ?? 0;

      // STRICT RULE: Only include day if actual is recorded (not null)
      // This ensures WTD (Week-to-Date) attainment doesn't penalize 
      // future days where production hasn't happened yet.
      if (actual !== null && actual !== undefined && target > 0) {
        shiftTotals[shift].cappedActual += Math.min(actual, target);
        shiftTotals[shift].totalTarget += target;
      }
    });
  });

  // Standard production shifts
  const shiftOrder = ['A', 'B', 'C', 'D'];
  
  return shiftOrder.map(shift => {
    const totals = shiftTotals[shift];
    const attainment = totals && totals.totalTarget > 0 
      ? (totals.cappedActual / totals.totalTarget) * 100 
      : 0;
    
    return {
      shift,
      attainment: parseFloat(attainment.toFixed(1))
    };
  });
}
