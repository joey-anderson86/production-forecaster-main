import { useMemo } from 'react';
import { PartScorecard, DailyScorecardRecord } from '../scorecardStore';

export interface ShiftAttainmentData {
  shift: string;
  attainment: number;
}

export interface AttainmentMathResult {
  dailyAttainments: (number | null)[];
  cumulativeWTD: number;
  cappedShiftAttainment: ShiftAttainmentData[];
  hasData: boolean;
}

/**
 * Custom hook to calculate production attainment metrics with strict WTD logic.
 * 
 * Logic Rules:
 * - Denominator (Target) ONLY includes days where Numerator (Actual) is recorded.
 * - Recorded '0' is valid data.
 * - 'null' or 'undefined' Actual means the shift hasn't happened and is excluded.
 */
export function useAttainmentMath(parts: PartScorecard[] | null | undefined): AttainmentMathResult {
  return useMemo(() => {
    if (!parts || parts.length === 0) {
      return {
        dailyAttainments: Array(7).fill(null),
        cumulativeWTD: 0,
        cappedShiftAttainment: [],
        hasData: false
      };
    }

    // Daily stats for all parts combined (Mon-Sun)
    const dailyStats = Array.from({ length: 7 }, () => ({ actual: 0, target: 0, hasData: false }));
    
    // Shift-specific stats for capped attainment
    const shiftStats: Record<string, { cappedActual: number; totalTarget: number }> = {};

    parts.forEach(part => {
      const shift = part.shift || 'Unknown';
      if (!shiftStats[shift]) {
        shiftStats[shift] = { cappedActual: 0, totalTarget: 0 };
      }

      part.dailyRecords.forEach((record, dayIdx) => {
        const actual = record.actual;
        const target = record.target ?? 0;

        // STRICT RULE: Only include day if actual is recorded (not null)
        if (actual !== null && actual !== undefined) {
          // General Department Daily/WTD Stats
          // We cap actual at target level to prevent overproduction from inflating metrics
          dailyStats[dayIdx].hasData = true;
          dailyStats[dayIdx].actual += Math.min(actual, target); 
          dailyStats[dayIdx].target += target;

          // Capped Shift Stats
          if (target > 0) {
            shiftStats[shift].cappedActual += Math.min(actual, target);
            shiftStats[shift].totalTarget += target;
          }
        }
      });
    });

    // 1. Calculate Daily Attainments (%)
    const dailyAttainments = dailyStats.map(s => 
      s.hasData && s.target > 0 ? (s.actual / s.target) * 100 : null
    );

    // 2. Calculate Cumulative WTD (%)
    const wtdActual = dailyStats.reduce((sum, s) => s.hasData ? sum + s.actual : sum, 0);
    const wtdTarget = dailyStats.reduce((sum, s) => s.hasData ? sum + s.target : sum, 0);
    const cumulativeWTD = wtdTarget > 0 ? (wtdActual / wtdTarget) * 100 : 0;

    // 3. Calculate Capped Shift Attainment for Charts (%)
    const shiftOrder = ['A', 'B', 'C', 'D'];
    const cappedShiftAttainment = shiftOrder.map(shift => {
      const stats = shiftStats[shift];
      const attainment = stats && stats.totalTarget > 0 
        ? (stats.cappedActual / stats.totalTarget) * 100 
        : 0;
      
      return {
        shift,
        attainment: parseFloat(attainment.toFixed(1))
      };
    });

    const hasData = dailyStats.some(s => s.hasData);

    return {
      dailyAttainments,
      cumulativeWTD: parseFloat(cumulativeWTD.toFixed(1)),
      cappedShiftAttainment,
      hasData
    };
  }, [parts]);
}
