import { useMemo } from 'react';
import { PartScorecard, DailyScorecardRecord } from '../scorecardStore';

/**
 * Aggregated attainment data for a specific production shift.
 */
export interface ShiftAttainmentData {
  /** The shift identifier (e.g., 'A', 'B'). */
  shift: string;
  /** The calculated attainment percentage, capped at 100%. */
  attainment: number;
}

/**
 * Aggregated attainment data for a specific part number.
 */
export interface PartAttainmentData {
  /** The unique part number identifier. */
  partNumber: string;
  /** The calculated attainment percentage. */
  attainment: number;
}

/**
 * The results returned by the useAttainmentMath hook.
 */
export interface AttainmentMathResult {
  /** Array of attainment percentages for each day of the week (0-6). Null if no data recorded. */
  dailyAttainments: (number | null)[];
  /** Cumulative Week-To-Date attainment percentage. */
  cumulativeWTD: number;
  /** List of shift-level attainment stats for charting. */
  cappedShiftAttainment: ShiftAttainmentData[];
  /** List of part-level attainment stats for charting. */
  cappedPartAttainment: PartAttainmentData[];
  /** Indicates if any valid production data was processed. */
  hasData: boolean;
}

/**
 * Custom hook to calculate production attainment metrics with strict Week-To-Date (WTD) logic.
 * 
 * This hook centralizes the math used across the dashboard to ensure consistency. It implements
 * the "Capped Attainment" philosophy: production exceeding 100% of the target for a specific 
 * slot is ignored in the numerator, preventing over-performance on one item from hiding 
 * under-performance on another.
 * 
 * @param parts - The collection of part scorecard data to analyze.
 * @returns An object containing daily, shift-level, and part-level performance metrics.
 * 
 * @example
 * const { cumulativeWTD } = useAttainmentMath(weekData.Parts);
 */
export function useAttainmentMath(parts: PartScorecard[] | null | undefined): AttainmentMathResult {
  return useMemo(() => {
    if (!parts || parts.length === 0) {
      return {
        dailyAttainments: Array(7).fill(null),
        cumulativeWTD: 0,
        cappedShiftAttainment: [],
        cappedPartAttainment: [],
        hasData: false
      };
    }

    // Daily stats for all parts combined (Mon-Sun)
    const dailyStats = Array.from({ length: 7 }, () => ({ actual: 0, target: 0, hasData: false }));
    
    // Shift-specific stats for capped attainment
    const shiftStats: Record<string, { cappedActual: number; totalTarget: number }> = {};

    // Part-specific stats for capped attainment
    const partStats: Record<string, { totalActual: number; totalTarget: number }> = {};

    parts.forEach(part => {
      const shift = part.Shift || 'Unknown';
      const pn = part.PartNumber;

      if (!shiftStats[shift]) {
        shiftStats[shift] = { cappedActual: 0, totalTarget: 0 };
      }

      if (!partStats[pn]) {
        partStats[pn] = { totalActual: 0, totalTarget: 0 };
      }

      part.DailyRecords.forEach((record, dayIdx) => {
        const actual = record.Actual;
        const target = record.Target ?? 0;

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

          // Part-level aggregation (un-capped total actual vs planned)
          partStats[pn].totalActual += actual;
          partStats[pn].totalTarget += target;
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

    // 4. Calculate Capped Part Attainment for Charts (%)
    const cappedPartAttainment = Object.entries(partStats)
      .map(([partNumber, stats]) => {
        const rawAttainment = stats.totalTarget > 0 ? (stats.totalActual / stats.totalTarget) * 100 : 0;
        return {
          partNumber,
          attainment: parseFloat(Math.min(100, rawAttainment).toFixed(1))
        };
      })
      .sort((a, b) => b.attainment - a.attainment);

    const hasData = dailyStats.some(s => s.hasData);

    return {
      dailyAttainments,
      cumulativeWTD: parseFloat(cumulativeWTD.toFixed(1)),
      cappedShiftAttainment,
      cappedPartAttainment,
      hasData
    };
  }, [parts]);
}
