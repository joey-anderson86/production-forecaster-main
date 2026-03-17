import { WeeklyScorecard, DailyScorecardRecord } from "./scorecardStore";

export interface ParetoDataPoint {
  reason: string;
  frequency: number;
  cumulativePercentage: number;
}

/**
 * Generates Pareto chart data from a WeeklyScorecard.
 * Only considers records where actual < target and a reasonCode is provided.
 */
export function generateParetoData(weekData: WeeklyScorecard | undefined | null): ParetoDataPoint[] {
  if (!weekData || !weekData.parts) return [];

  const reasonCounts: Record<string, number> = {};
  let totalMisses = 0;

  weekData.parts.forEach(part => {
    part.dailyRecords.forEach(record => {
      // Check if actual is less than target
      if (
        record.actual !== null && 
        record.target !== null && 
        record.actual < record.target && 
        record.reasonCode && 
        record.reasonCode.trim() !== ""
      ) {
        const reason = record.reasonCode.trim();
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        totalMisses++;
      }
    });
  });

  if (totalMisses === 0) return [];

  // Sort reasons by frequency descending
  const sortedReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, frequency]) => ({ reason, frequency }));

  // Calculate cumulative percentages
  let cumulativeCount = 0;
  return sortedReasons.map(({ reason, frequency }) => {
    cumulativeCount += frequency;
    const cumulativePercentage = Math.round((cumulativeCount / totalMisses) * 100);
    return {
      reason,
      frequency,
      cumulativePercentage
    };
  });
}
