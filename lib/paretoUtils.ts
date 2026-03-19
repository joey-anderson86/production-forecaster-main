import { WeeklyScorecard, DailyScorecardRecord } from "./scorecardStore";

export interface ParetoDataPoint {
  reason: string;
  frequency: number;
  cumulativePercentage: number;
  [partNumber: string]: string | number; // Allow both part counts and required fields
}

/**
 * Generates Pareto chart data from a WeeklyScorecard.
 * Only considers records where actual < target and a reasonCode is provided.
 */
export function generateParetoData(weekData: WeeklyScorecard | undefined | null): ParetoDataPoint[] {
  if (!weekData || !weekData.parts) return [];

  // reasonCounts[reason][partNumber] = count
  const reasonCounts: Record<string, Record<string, number>> = {};
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
        const partNum = part.partNumber;

        if (!reasonCounts[reason]) {
          reasonCounts[reason] = {};
        }
        
        reasonCounts[reason][partNum] = (reasonCounts[reason][partNum] || 0) + 1;
        totalMisses++;
      }
    });
  });

  if (totalMisses === 0) return [];

  // Sort reasons by total frequency descending
  const sortedReasons = Object.entries(reasonCounts)
    .map(([reason, partCounts]) => {
      const totalFreq = Object.values(partCounts).reduce((sum, count) => sum + count, 0);
      return { reason, totalFreq, partCounts };
    })
    .sort((a, b) => b.totalFreq - a.totalFreq);

  // Calculate cumulative percentages
  let cumulativeCount = 0;
  return sortedReasons.map(({ reason, totalFreq, partCounts }) => {
    cumulativeCount += totalFreq;
    const cumulativePercentage = Math.round((cumulativeCount / totalMisses) * 100);
    
    return {
      reason,
      frequency: totalFreq,
      cumulativePercentage,
      ...partCounts
    };
  });
}
