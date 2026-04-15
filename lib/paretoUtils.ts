import { WeeklyScorecard, DailyScorecardRecord } from "./scorecardStore";

export interface ParetoDataPoint {
  reason: string;
  frequency: number;
  cumulativePercentage: number;
  [partNumber: string]: string | number; // Allow both part counts and required fields
}

/**
 * Generates Pareto chart data from a WeeklyScorecard.
 */
export function generateParetoData(
  weekData: WeeklyScorecard | undefined | null,
  displayUnit: 'batches' | 'pieces' = 'batches',
  batchSizeMap: Map<string, number> = new Map()
): ParetoDataPoint[] {
  if (!weekData || !weekData.Parts) return [];

  // reasonCounts[reason][partNumber] = count/sum
  const reasonCounts: Record<string, Record<string, number>> = {};
  let totalMissVolume = 0;

  weekData.Parts.forEach(part => {
    part.DailyRecords.forEach(record => {
      // Check if actual is less than target
      if (
        record.Actual !== null && 
        record.Target !== null && 
        record.Actual < record.Target && 
        record.ReasonCode && 
        record.ReasonCode.trim() !== ""
      ) {
        const reason = record.ReasonCode.trim();
        const partNum = part.PartNumber;

        // Calculate miss volume and apply multiplier
        const rawMiss = record.Target - record.Actual;
        const multiplier = displayUnit === 'pieces' ? (batchSizeMap.get(partNum) || 1) : 1;
        const scaledMiss = rawMiss * multiplier;

        if (!reasonCounts[reason]) {
          reasonCounts[reason] = {};
        }
        
        reasonCounts[reason][partNum] = (reasonCounts[reason][partNum] || 0) + scaledMiss;
        totalMissVolume += scaledMiss;
      }
    });
  });

  if (totalMissVolume === 0) return [];

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
    const cumulativePercentage = Math.round((cumulativeCount / totalMissVolume) * 100);
    
    return {
      reason,
      frequency: totalFreq,
      cumulativePercentage,
      ...partCounts
    };
  });
}
