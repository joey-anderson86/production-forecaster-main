import { PipelineRow, DailyRateRow } from '@/lib/types';

export type PipelineData = PipelineRow[];
export type DailyRateData = DailyRateRow[];

export interface ForecasterSummary {
  starvingToday: number;
  totalShortages: number;
  healthyParts: number;
  avgPipelineDOI: number;
}

export interface DayMetric {
  expected: number;
  variance: number;
  locatorBreakdown: Record<string, number>;
}

export interface PartForecast {
  partNumber: string;
  dailyRate: number;
  totalPipelineDOI: number;
  dayMetrics: Record<number, DayMetric>;
  distributions: {
    id: string;
    dayVolumes: Record<number, number>;
  }[];
}

export interface ProcessedForecast {
  results: PartForecast[];
  summary: ForecasterSummary;
  dayColumns: number[];
}

export type SortField = 'partNumber' | 'dailyRate' | 'totalPipelineDOI' | string;

export interface SortConfig {
  key: SortField;
  direction: 'asc' | 'desc';
}
