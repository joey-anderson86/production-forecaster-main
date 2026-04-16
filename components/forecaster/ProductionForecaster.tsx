'use client';

import React, { useState, useMemo } from 'react';
import { Stack } from '@mantine/core';
import { useFullscreen } from '@mantine/hooks';
import { 
  PipelineData, DailyRateData, ProcessedForecast, 
  SortConfig, SortField, ForecasterSummary as SummaryType 
} from './ForecasterTypes';
import { ForecasterConfig } from './ForecasterConfig';
import { ForecasterSummary } from './ForecasterSummary';
import { ForecasterTable } from './ForecasterTable';

export function ProductionForecaster() {
  const [pipelineData, setPipelineData] = useState<PipelineData>([]);
  const [dailyRateData, setDailyRateData] = useState<DailyRateData>([]);
  const [locatorMapping, setLocatorMapping] = useState<Record<string, number>>({});
  
  const [isConfigOpen, setIsConfigOpen] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPartNumbers, setSelectedPartNumbers] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'partNumber', direction: 'asc' });
  const [density, setDensity] = useState<'xs' | 'sm' | 'md'>('sm');
  
  const { ref: fullscreenRef, toggle: toggleFullscreen, fullscreen } = useFullscreen();

  const dates = useMemo(() => {
    if (pipelineData.length === 0) return [new Date().toISOString().split('T')[0]];
    const d = Array.from(new Set(pipelineData.map(r => r.Date))).sort();
    return d.length > 0 ? d : [new Date().toISOString().split('T')[0]];
  }, [pipelineData]);

  const allPartNumbers = useMemo(() => {
    return Array.from(new Set(dailyRateData.map(r => r["Part Number"]))).sort();
  }, [dailyRateData]);

  const onDataLoaded = (pipeline: PipelineData, rates: DailyRateData, mapping: Record<string, number>) => {
    if (pipeline.length > 0) setPipelineData(pipeline);
    if (rates.length > 0) setDailyRateData(rates);
    if (Object.keys(mapping).length > 0) setLocatorMapping(mapping);
  };

  const processedData: ProcessedForecast = useMemo(() => {
    // 1. Filter rows by search and selected part numbers
    let filteredDailyRates = dailyRateData.filter(rate => {
      const pNum = rate["Part Number"];
      const matchesSearch = pNum.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = selectedPartNumbers.length === 0 || selectedPartNumbers.includes(pNum);
      return matchesSearch && matchesFilter;
    });

    const dayColumns = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    
    // 2. Process each part
    const results = filteredDailyRates.map(rate => {
      const pNum = rate["Part Number"];
      const dailyRate = rate["Daily Rate"];
      
      const partPipeline = pipelineData.filter(p => p.PartNumber === pNum);
      const totalPipelineQty = partPipeline.reduce((sum, p) => sum + (Number(p.Qty) || 0), 0);
      const totalPipelineDOI = dailyRate > 0 ? totalPipelineQty / dailyRate : 0;

      const dayMetrics: Record<number, any> = {};
      const distributions: any[] = [];

      // Create distribution for each WIP record
      partPipeline.forEach((pipe, idx) => {
        const locator = pipe.WIPLocator || '';
        const qty = Number(pipe.Qty) || 0;
        const daysFromShip = locatorMapping[locator] || 0;
        const dayVolumes: Record<number, number> = {};
        
        dayColumns.forEach(day => {
          if (day >= daysFromShip) {
            dayVolumes[day] = qty;
          }
        });

        distributions.push({
          id: `${locator || 'Unknown'} (${qty} @ ${daysFromShip}d)`,
          dayVolumes
        });
      });

      // Calculate aggregated metrics per day
      dayColumns.forEach(day => {
        const arrivalQty = distributions.reduce((sum, d) => sum + (d.dayVolumes[day] || 0), 0);
        const demandToDay = dailyRate * (day + 1);
        const expected = arrivalQty;
        const variance = arrivalQty - demandToDay;

        const locatorBreakdown: Record<string, number> = {};
        partPipeline.forEach(p => {
          if ((locatorMapping[p.WIPLocator] || 0) <= day) {
            locatorBreakdown[p.WIPLocator] = (locatorBreakdown[p.WIPLocator] || 0) + (typeof p.Qty === 'number' ? p.Qty : 0);
          }
        });

        dayMetrics[day] = { expected, variance, locatorBreakdown };
      });

      return {
        partNumber: pNum,
        dailyRate,
        totalPipelineDOI,
        dayMetrics,
        distributions
      };
    });

    // 3. Sorting
    results.sort((a, b) => {
      let valA: any = a[sortConfig.key as keyof typeof a];
      let valB: any = b[sortConfig.key as keyof typeof b];

      if (sortConfig.key.startsWith('day_')) {
        const day = parseInt(sortConfig.key.split('_')[1]);
        valA = a.dayMetrics[day].variance;
        valB = b.dayMetrics[day].variance;
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    // 4. Summary
    const summary: SummaryType = {
      starvingToday: results.filter(r => r.dayMetrics[0].variance < 0).length,
      totalShortages: results.filter(r => dayColumns.some(d => r.dayMetrics[d].variance < 0)).length,
      healthyParts: results.filter(r => dayColumns.every(d => r.dayMetrics[d].variance >= 0)).length,
      avgPipelineDOI: results.length > 0 ? results.reduce((sum, r) => sum + r.totalPipelineDOI, 0) / results.length : 0
    };

    return { results, summary, dayColumns };
  }, [pipelineData, dailyRateData, locatorMapping, searchQuery, selectedPartNumbers, sortConfig, selectedDate]);

  const requestSort = (key: SortField) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  return (
    <Stack gap="xl" ref={fullscreenRef}>
      <ForecasterConfig 
        onDataLoaded={onDataLoaded} 
        isConfigOpen={isConfigOpen} 
        setIsConfigOpen={setIsConfigOpen}
        forecastGenerated={pipelineData.length > 0}
      />
      
      {pipelineData.length > 0 && (
        <>
          <ForecasterSummary 
            summary={processedData.summary} 
            selectedDate={selectedDate} 
            setSelectedDate={setSelectedDate}
            dates={dates}
          />
          
          <ForecasterTable 
            processedData={processedData}
            selectedDate={selectedDate}
            selectedPartNumbers={selectedPartNumbers}
            setSelectedPartNumbers={setSelectedPartNumbers}
            allPartNumbers={allPartNumbers}
            sortConfig={sortConfig}
            requestSort={requestSort}
            density={density}
            setDensity={setDensity}
            fullscreen={fullscreen}
            toggleFullscreen={toggleFullscreen}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            locatorMapping={locatorMapping}
          />
        </>
      )}
    </Stack>
  );
}
