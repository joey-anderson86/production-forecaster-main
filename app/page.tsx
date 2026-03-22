'use client';

import React, { useState, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import {
  UploadCloud, Settings, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, BarChart3, Info,
  DownloadCloud, Search, Filter, Columns,
  Maximize, Minimize, LayoutList,
  ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import {
  TextInput, ActionIcon, Group, Tooltip,
  Menu, Button, Stack, Text, Box, Slider, Modal, Tabs,
  Popover, MultiSelect, Badge
} from '@mantine/core';
import { ColorSchemeToggle } from '@/components/ColorSchemeToggle';
import { MultiCsvUploader } from '@/components/MultiCsvUploader';
import DeliveryScorecardManagement from '@/components/DeliveryScorecardManagement';
import DeliveryScorecardDisplay from '@/components/DeliveryScorecardDisplay';
import SyncManager from '@/components/SyncManager';
import { DatabaseSettings } from '@/components/DatabaseSettings';
import { PipelineDataPreview } from '@/components/PipelineDataPreview';
import { useFullscreen } from '@mantine/hooks';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type PipelineData = Record<string, any>[];
type DailyRateData = Record<string, any>[];

export default function ProductionForecaster() {
  const [pipelineFile, setPipelineFile] = useState<File | null>(null);
  const [dailyRateFile, setDailyRateFile] = useState<File | null>(null);

  const [pipelineData, setPipelineData] = useState<PipelineData>([]);
  const [dailyRateData, setDailyRateData] = useState<DailyRateData>([]);

  const [locators, setLocators] = useState<string[]>([]);
  const [locatorMapping, setLocatorMapping] = useState<Record<string, number>>({});

  const [isConfigOpen, setIsConfigOpen] = useState(true);
  const [forecastGenerated, setForecastGenerated] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isUploaderModalOpen, setIsUploaderModalOpen] = useState(false);

  // Toolbar States
  const [searchQuery, setSearchQuery] = useState('');
  const [density, setDensity] = useState<'xs' | 'sm' | 'md'>('sm');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [selectedPartNumbers, setSelectedPartNumbers] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [mainTab, setMainTab] = useState<string>('forecaster');

  const { toggle: toggleFullscreen, fullscreen, ref: tableRef } = useFullscreen<HTMLDivElement>();

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig?.key !== key) return <ArrowUpDown size={14} className="ml-2 opacity-30 group-hover/header:opacity-100 transition-opacity" />;
    return sortConfig.direction === 'asc'
      ? <ArrowUp size={14} className="ml-2 text-indigo-600 dark:text-indigo-400" />
      : <ArrowDown size={14} className="ml-2 text-indigo-600 dark:text-indigo-400" />;
  };

  const getPartNumberKey = (keys: string[]) => {
    return keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === 'partnumber') || keys[0];
  };

  const getCustomerKeys = (keys: string[]) => {
    const customer = keys.find(k => k.toLowerCase().replace(/[^a-z]/g, '') === 'customer') || 'Customer';
    const city = keys.find(k => k.toLowerCase().replace(/[^a-z]/g, '') === 'customercity' || k.toLowerCase().includes('city')) || 'Customer City';
    return { customer, city };
  };

  const getDateKey = (keys: string[]) => {
    return keys.find(k => {
      const normalized = k.toLowerCase().trim();
      return normalized === 'date' || normalized === 'snapshot date' || normalized === 'snapshotdate' || normalized === 'snapshot';
    });
  };

  const handleFileUpload = (file: File, type: 'pipeline' | 'dailyRate') => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        if (type === 'pipeline') {
          setPipelineFile(file);
          const data = results.data as PipelineData;
          setPipelineData(data);
          if (data.length > 0) {
            const keys = Object.keys(data[0] as Record<string, any>);
            const partNumberKey = getPartNumberKey(keys);
            const dateKey = getDateKey(keys);

            if (dateKey) {
              const uniqueDates = Array.from(new Set(data.map(row => String(row[dateKey])))).sort();
              setDates(uniqueDates);
              setSelectedDate(uniqueDates[0]);
            } else {
              setDates([]);
              setSelectedDate(null);
            }

            const locatorKeys = keys.filter(k => k !== partNumberKey && k !== dateKey);
            setLocators(locatorKeys);

            const initialMapping: Record<string, number> = {};
            locatorKeys.forEach(loc => initialMapping[loc] = 0);
            setLocatorMapping(initialMapping);
          }
        } else {
          setDailyRateFile(file);
          setDailyRateData(results.data as DailyRateData);
        }
        setForecastGenerated(false);
      }
    });
  };

  const handleMappingChange = (locator: string, value: number) => {
    setLocatorMapping(prev => ({ ...prev, [locator]: value }));
    setForecastGenerated(false);
  };

  const handleExportMapping = async () => {
    const data = Object.entries(locatorMapping).map(([locator, days]) => ({
      Locator: locator,
      DaysFromShipment: days
    }));
    const csv = Papa.unparse(data);

    // Try Tauri native export first
    try {
      // @ts-ignore - Tauri defined at runtime
      if (window.__TAURI_INTERNALS__) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');

        const filePath = await save({
          filters: [{ name: 'CSV', extensions: ['csv'] }],
          defaultPath: 'locator_mapping.csv'
        });

        if (filePath) {
          await writeTextFile(filePath, csv);
          return;
        }
      }
    } catch (error) {
      console.error('Tauri export failed, falling back to web download:', error);
    }

    // Fallback to web download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'locator_mapping.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportMapping = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        const newMapping = { ...locatorMapping };
        results.data.forEach((row: any) => {
          const loc = row['Locator'] || row['locator'] || row[Object.keys(row)[0]];
          const days = row['DaysFromShipment'] ?? row['days'] ?? row[Object.keys(row)[1]];
          if (loc !== undefined && days !== undefined && !isNaN(Number(days))) {
            newMapping[String(loc)] = Number(days);
          }
        });
        setLocatorMapping(newMapping);
        setForecastGenerated(false);
      }
    });
    e.target.value = '';
  };

  const handleExportForecast = async () => {
    if (!processedData) return;

    const headers = [
      'Part Number',
      'Daily Rate',
      'Pipeline DOI',
      ...processedData.dayColumns.map(d => `Day ${d}`)
    ];

    const data = processedData.results.map(row => {
      const rowData: Record<string, any> = {
        'Part Number': row.partNumber,
        'Daily Rate': row.dailyRate,
        'Pipeline DOI': row.totalPipelineDOI.toFixed(2),
      };

      processedData.dayColumns.forEach(d => {
        rowData[`Day ${d}`] = row.dayMetrics[d]?.expected || 0;
      });

      return rowData;
    });

    const csv = Papa.unparse({ fields: headers, data });

    try {
      // @ts-ignore
      if (window.__TAURI_INTERNALS__) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');

        const filePath = await save({
          filters: [{ name: 'CSV', extensions: ['csv'] }],
          defaultPath: 'production_forecast.csv'
        });

        if (filePath) {
          await writeTextFile(filePath, csv);
          return;
        }
      }
    } catch (error) {
      console.error('Tauri export failed:', error);
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'production_forecast.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const allPartNumbers = useMemo(() => {
    if (pipelineData.length === 0) return [];
    const keys = Object.keys(pipelineData[0]);
    const partNumberKey = getPartNumberKey(keys);
    return Array.from(new Set(pipelineData.map(row => String(row[partNumberKey]).trim()))).sort();
  }, [pipelineData]);

  const processedData = useMemo(() => {
    if (!forecastGenerated || pipelineData.length === 0 || dailyRateData.length === 0) return null;

    const pipelineKeys = pipelineData.length > 0 ? Object.keys(pipelineData[0]) : [];
    const pipelinePartKey = getPartNumberKey(pipelineKeys);
    const { customer: custKey, city: cityKey } = getCustomerKeys(pipelineKeys);
    const dateKey = getDateKey(pipelineKeys);

    let filteredPipelineData = pipelineData;
    if (dateKey && selectedDate) {
      filteredPipelineData = pipelineData.filter(row => String(row[dateKey]) === selectedDate);
    }

    const rateKeys = dailyRateData.length > 0 ? Object.keys(dailyRateData[0]) : [];
    const ratePartKey = getPartNumberKey(rateKeys);
    const rateValueKey = rateKeys.find(k => k !== ratePartKey) || rateKeys[1];

    const ratesMap = new Map<string, number>();
    dailyRateData.forEach(row => {
      const part = String(row[ratePartKey]).trim();
      const rate = Number(row[rateValueKey]) || 0;
      ratesMap.set(part, rate);
    });

    const days = Object.values(locatorMapping);
    const minDay = Math.min(...days, 0);
    const maxDay = Math.max(...days, 0);
    const dayColumns = Array.from({ length: maxDay - minDay + 1 }, (_, i) => minDay + i);

    // Grouping logic
    const groupedMap = new Map<string, {
      partNumber: string;
      dailyRate: number;
      locators: Record<string, number>;
      distributions: Record<string, Record<string, number>>; // {Customer - City} -> {Locator} -> Qty
      locatorBreakdownByDay: Record<number, Record<string, number>>; // Day -> {Locator -> Qty}
    }>();

    filteredPipelineData.forEach(row => {
      const partNumber = String(row[pipelinePartKey]).trim();
      const customer = String(row[custKey] || 'Unknown').trim();
      const city = String(row[cityKey] || '').trim();
      const distId = city ? `${customer} - ${city}` : customer;

      if (!groupedMap.has(partNumber)) {
        groupedMap.set(partNumber, {
          partNumber,
          dailyRate: ratesMap.get(partNumber) || 0,
          locators: {},
          distributions: {},
          locatorBreakdownByDay: {}
        });
        locators.forEach(loc => groupedMap.get(partNumber)!.locators[loc] = 0);
      }

      const group = groupedMap.get(partNumber)!;
      if (!group.distributions[distId]) {
        group.distributions[distId] = {};
        locators.forEach(loc => group.distributions[distId][loc] = 0);
      }

      locators.forEach(loc => {
        const qty = Number(row[loc]) || 0;
        group.locators[loc] += qty;
        group.distributions[distId][loc] += qty;

        const mappedDay = locatorMapping[loc];
        if (mappedDay !== undefined && qty > 0) {
          if (!group.locatorBreakdownByDay[mappedDay]) {
            group.locatorBreakdownByDay[mappedDay] = {};
          }
          group.locatorBreakdownByDay[mappedDay][loc] = (group.locatorBreakdownByDay[mappedDay][loc] || 0) + qty;
        }
      });
    });

    let results = Array.from(groupedMap.values()).map(group => {
      const { partNumber, dailyRate, locators: groupLocators, distributions } = group;

      let totalWip = 0;
      const dayVolumes: Record<number, number> = {};
      dayColumns.forEach(d => dayVolumes[d] = 0);

      locators.forEach(loc => {
        const qty = groupLocators[loc];
        totalWip += qty;
        const mappedDay = locatorMapping[loc];
        if (mappedDay !== undefined) {
          dayVolumes[mappedDay] += qty;
        }
      });

      const totalPipelineDOI = dailyRate > 0 ? totalWip / dailyRate : 0;

      const dayMetrics: Record<number, { expected: number, variance: number, locatorBreakdown: Record<string, number> }> = {};
      dayColumns.forEach(d => {
        const expected = dayVolumes[d];
        const variance = expected - dailyRate;
        dayMetrics[d] = {
          expected,
          variance,
          locatorBreakdown: group.locatorBreakdownByDay[d] || {}
        };
      });

      // Process distributions for sub-rows
      const distributionResults = Object.entries(distributions).map(([id, distLocators]) => {
        const distDayVolumes: Record<number, number> = {};
        dayColumns.forEach(d => distDayVolumes[d] = 0);

        locators.forEach(loc => {
          const qty = distLocators[loc];
          const mappedDay = locatorMapping[loc];
          if (mappedDay !== undefined) {
            distDayVolumes[mappedDay] += qty;
          }
        });

        return {
          id,
          dayVolumes: distDayVolumes
        };
      });

      return {
        partNumber,
        dailyRate,
        totalWip,
        totalPipelineDOI,
        dayMetrics,
        distributions: distributionResults
      };
    });

    // Apply Search Filter
    if (searchQuery) {
      results = results.filter(row =>
        row.partNumber.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply Part Number Filter
    if (selectedPartNumbers.length > 0) {
      results = results.filter(row =>
        selectedPartNumbers.includes(row.partNumber)
      );
    }

    // Apply Sorting
    if (sortConfig) {
      results.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        if (sortConfig.key.startsWith('day_')) {
          const day = parseInt(sortConfig.key.replace('day_', ''));
          aValue = a.dayMetrics[day]?.expected ?? 0;
          bValue = b.dayMetrics[day]?.expected ?? 0;
        } else {
          aValue = (a as any)[sortConfig.key];
          bValue = (b as any)[sortConfig.key];
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    return { results, dayColumns };
  }, [forecastGenerated, pipelineData, dailyRateData, locators, locatorMapping, searchQuery, sortConfig, selectedDate, selectedPartNumbers]);

  const summary = useMemo(() => {
    if (!processedData) return null;

    let starvingToday = 0;
    let sumDOI = 0;
    let validDOICount = 0;

    processedData.results.forEach(row => {
      if (row.dayMetrics[0] && row.dayMetrics[0].variance < 0) {
        starvingToday++;
      }
      if (row.dailyRate > 0) {
        sumDOI += row.totalPipelineDOI;
        validDOICount++;
      }
    });

    const avgDOI = validDOICount > 0 ? sumDOI / validDOICount : 0;

    return {
      starvingToday,
      avgDOI
    };
  }, [processedData]);

  const handleGenerate = () => {
    if (pipelineData.length > 0 && dailyRateData.length > 0) {
      setForecastGenerated(true);
      setIsConfigOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans p-4 md:p-8 transition-colors duration-300">
      <SyncManager />
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">Production Forecaster</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Map WIP locators to forecast shipment readiness.</p>
          </div>
          <Group align="center" gap="md">
            <ColorSchemeToggle />
            <BarChart3 className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          </Group>
        </header>

        <div className="flex justify-center mb-6">
          <Tabs value={mainTab} onChange={(val) => setMainTab(val as string)} variant="pills" color="indigo" radius="md">
            <Tabs.List>
              <Tabs.Tab value="forecaster">Production Forecaster</Tabs.Tab>
              <Tabs.Tab value="scorecard-mgmt">Delivery Management</Tabs.Tab>
              <Tabs.Tab value="scorecard-dash">Delivery Dashboard</Tabs.Tab>
              <Tabs.Tab value="settings">Settings</Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </div>

        {mainTab === 'forecaster' && (
          <>
            {/* Configuration Panel */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
              <button
                onClick={() => setIsConfigOpen(!isConfigOpen)}
                className="w-full flex items-center justify-between p-4 md:p-6 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Configuration & Data Upload</h2>
                </div>
                {isConfigOpen ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
              </button>

              {isConfigOpen && (
                <div className="p-4 md:p-6 border-t border-slate-100 dark:border-slate-800 space-y-8">
                  <div className="grid md:grid-cols-2 gap-6 relative">
                    <div className="flex flex-col gap-2">
                      <FileDropzone
                        label="Upload Pipeline CSV"
                        accept=".csv"
                        onDrop={(f) => handleFileUpload(f, 'pipeline')}
                        file={pipelineFile}
                      />
                      <div className="flex justify-center relative z-10 hover:z-20">
                        <Button
                          variant="light"
                          size="xs"
                          radius="xl"
                          onClick={() => setIsUploaderModalOpen(true)}
                          className="shadow-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
                          leftSection={<LayoutList size={14} />}
                        >
                          Merge Multiple Pipeline Files
                        </Button>
                      </div>
                    </div>
                    <FileDropzone
                      label="Upload Daily Rate CSV"
                      accept=".csv"
                      onDrop={(f) => handleFileUpload(f, 'dailyRate')}
                      file={dailyRateFile}
                    />
                  </div>

                  {locators.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h3 className="text-md font-semibold text-slate-800 dark:text-slate-200">Locator Mapping</h3>
                          <Tooltip
                            label="Assign each WIP locator to &quot;X days from planned shipment&quot;. 0 = Today, 1 = Tomorrow, etc."
                            multiline
                            w={250}
                            withArrow
                          >
                            <Info className="w-4 h-4 text-slate-400 cursor-help" />
                          </Tooltip>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            accept=".csv"
                            id="mapping-upload"
                            className="hidden"
                            onChange={handleImportMapping}
                          />
                          <label
                            htmlFor="mapping-upload"
                            className="cursor-pointer px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 shadow-sm"
                          >
                            <UploadCloud className="w-3 h-3" /> Import
                          </label>
                          <button
                            onClick={handleExportMapping}
                            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 shadow-sm"
                          >
                            <DownloadCloud className="w-3 h-3" /> Export
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {locators.map(loc => (
                          <div key={loc} className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col gap-2">
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate" title={loc}>{loc}</label>
                            <input
                              type="number"
                              value={locatorMapping[loc]}
                              onChange={(e) => handleMappingChange(loc, parseInt(e.target.value) || 0)}
                              className="w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={handleGenerate}
                      disabled={!pipelineFile || !dailyRateFile}
                      className={cn(
                        "px-6 py-2.5 rounded-lg font-medium text-sm transition-all shadow-sm",
                        pipelineFile && dailyRateFile
                          ? "bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                      )}
                    >
                      Generate Forecast
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8">
              <PipelineDataPreview />
            </div>

            {/* Dashboard */}
            {forecastGenerated && processedData && summary && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-1">
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Parts Starving Today</span>
                    <div className="flex items-baseline gap-2">
                      <span className={cn("text-3xl font-bold tracking-tight", summary.starvingToday > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                        {summary.starvingToday}
                      </span>
                      <span className="text-sm text-slate-400">parts</span>
                    </div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-1">
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Average Pipeline DOI</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                        {summary.avgDOI.toFixed(2)}
                      </span>
                      <span className="text-sm text-slate-400">days</span>
                    </div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-1">
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Filtered Parts</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">
                        {processedData.results.length}
                      </span>
                      <span className="text-sm text-slate-400">parts</span>
                    </div>
                  </div>
                </div>

                {/* Date Slider */}
                {dates.length > 1 && (
                  <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <LayoutList className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        <h3 className="text-md font-semibold text-slate-800 dark:text-slate-200">Snapshot Timeline</h3>
                      </div>
                      <Text size="sm" fw={600} className="text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full">
                        Active Snaphot: {selectedDate}
                      </Text>
                    </div>
                    <div className="px-4 pb-4">
                      <Slider
                        value={dates.indexOf(selectedDate || '')}
                        onChange={(val) => setSelectedDate(dates[val])}
                        max={dates.length - 1}
                        step={1}
                        label={(val) => dates[val]}
                        marks={dates.length <= 10 ? dates.map((d, i) => ({ value: i, label: d })) : [
                          { value: 0, label: dates[0] },
                          { value: dates.length - 1, label: dates[dates.length - 1] }
                        ]}
                        color="indigo"
                        size="md"
                        styles={{
                          markLabel: { fontSize: '10px', marginTop: '8px' },
                          thumb: { borderWidth: 2, padding: 3 }
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Main Data Table */}
                <div
                  ref={tableRef}
                  id="fullscreen-table-container"
                  className={cn(
                    "bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col",
                    fullscreen && "p-8 overflow-auto h-screen w-screen"
                  )}
                >
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <Group justify="space-between" align="center" gap="md">
                      <TextInput
                        placeholder="Search Part Number..."
                        leftSection={<Search size={16} />}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.currentTarget.value)}
                        size="sm"
                        className="flex-1 max-w-sm"
                      />

                      <Button
                        variant="light"
                        color="indigo"
                        leftSection={<DownloadCloud size={16} />}
                        onClick={handleExportForecast}
                        size="sm"
                      >
                        Export CSV
                      </Button>

                      <Group gap="xs">
                        <Popover
                          position="bottom-end"
                          shadow="md"
                          withArrow
                          trapFocus
                          opened={isFilterOpen}
                          onChange={setIsFilterOpen}
                        >
                          <Popover.Target>
                            <Tooltip label="Filters" portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                              <ActionIcon
                                variant="light"
                                color="indigo"
                                size="lg"
                                className="relative"
                                onClick={() => setIsFilterOpen((o) => !o)}
                              >
                                <Filter size={18} />
                                {selectedPartNumbers.length > 0 && (
                                  <Badge
                                    size="xs"
                                    circle
                                    color="red"
                                    className="absolute -top-1 -right-1 z-10"
                                    p={0}
                                  >
                                    {selectedPartNumbers.length}
                                  </Badge>
                                )}
                              </ActionIcon>
                            </Tooltip>
                          </Popover.Target>
                          <Popover.Dropdown p="md">
                            <Stack gap="sm" w={300}>
                              <Text fw={600} size="sm">Filter by Part Number</Text>
                              <MultiSelect
                                data={allPartNumbers}
                                placeholder="Select Part Numbers..."
                                value={selectedPartNumbers}
                                onChange={setSelectedPartNumbers}
                                searchable
                                clearable
                                nothingFoundMessage="No part numbers found"
                                maxDropdownHeight={300}
                                comboboxProps={{ withinPortal: false }}
                              />
                              <Group grow gap="xs">
                                {selectedPartNumbers.length > 0 && (
                                  <Button
                                    variant="light"
                                    color="red"
                                    size="xs"
                                    onClick={() => setSelectedPartNumbers([])}
                                  >
                                    Clear All
                                  </Button>
                                )}
                                <Button
                                  variant="filled"
                                  color="indigo"
                                  size="xs"
                                  onClick={() => setIsFilterOpen(false)}
                                >
                                  Done
                                </Button>
                              </Group>
                            </Stack>
                          </Popover.Dropdown>
                        </Popover>

                        <Menu shadow="md" width={200} portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                          <Menu.Target>
                            <Tooltip label="Show/Hide Columns" portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                              <ActionIcon variant="light" color="indigo" size="lg" onClick={() => console.log('Columns clicked')}>
                                <Columns size={18} />
                              </ActionIcon>
                            </Tooltip>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Label>Table Columns</Menu.Label>
                            <Menu.Item leftSection={<CheckCircle2 size={14} />}>Part Number</Menu.Item>
                            <Menu.Item leftSection={<CheckCircle2 size={14} />}>Daily Rate</Menu.Item>
                            <Menu.Item leftSection={<CheckCircle2 size={14} />}>Pipeline DOI</Menu.Item>
                            <Menu.Item leftSection={<CheckCircle2 size={14} />}>Day Columns</Menu.Item>
                          </Menu.Dropdown>
                        </Menu>

                        <Menu shadow="md" width={150} portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                          <Menu.Target>
                            <Tooltip label="Toggle Density" portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                              <ActionIcon variant="light" color="indigo" size="lg">
                                <LayoutList size={18} />
                              </ActionIcon>
                            </Tooltip>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Label>Row Density</Menu.Label>
                            <Menu.Item onClick={() => setDensity('xs')} color={density === 'xs' ? 'indigo' : undefined}>Compact</Menu.Item>
                            <Menu.Item onClick={() => setDensity('sm')} color={density === 'sm' ? 'indigo' : undefined}>Standard</Menu.Item>
                            <Menu.Item onClick={() => setDensity('md')} color={density === 'md' ? 'indigo' : undefined}>Comfortable</Menu.Item>
                          </Menu.Dropdown>
                        </Menu>

                        <Tooltip label={fullscreen ? "Exit Full Screen" : "Toggle Full Screen"} portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                          <ActionIcon variant="light" color="indigo" size="lg" onClick={toggleFullscreen}>
                            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  </div>

                  <div className="p-2 bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-end gap-4 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800"></div>
                      <span>Healthy</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800"></div>
                      <span>Shortage</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto relative flex-1">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead className="text-xs text-slate-600 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-800/80">
                        <tr>
                          <th
                            onClick={() => requestSort('partNumber')}
                            className="px-4 py-3 sticky top-0 left-0 bg-slate-50 dark:bg-slate-800 z-30 border-r border-b border-slate-200 dark:border-slate-700 min-w-[140px] shadow-[1px_0_0_0_#e2e8f0] dark:shadow-[1px_0_0_0_#1e293b] cursor-pointer group/header select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <div className="flex items-center">
                              Part Number
                              {getSortIcon('partNumber')}
                            </div>
                          </th>
                          <th
                            onClick={() => requestSort('dailyRate')}
                            className="px-4 py-3 sticky top-0 left-[140px] bg-slate-50 dark:bg-slate-800 z-30 border-r border-b border-slate-200 dark:border-slate-700 min-w-[100px] shadow-[1px_0_0_0_#e2e8f0] dark:shadow-[1px_0_0_0_#1e293b] cursor-pointer group/header select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <div className="flex items-center">
                              Daily Rate
                              {getSortIcon('dailyRate')}
                            </div>
                          </th>
                          <th
                            onClick={() => requestSort('totalPipelineDOI')}
                            className="px-4 py-3 sticky top-0 left-[240px] bg-slate-50 dark:bg-slate-800 z-30 border-r border-b border-slate-200 dark:border-slate-700 min-w-[120px] shadow-[1px_0_0_0_#e2e8f0] dark:shadow-[1px_0_0_0_#1e293b] cursor-pointer group/header select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                          >
                            <div className="flex items-center">
                              Pipeline DOI
                              {getSortIcon('totalPipelineDOI')}
                            </div>
                          </th>
                          {processedData.dayColumns.map(day => {
                            let baseDate = new Date();
                            if (selectedDate) {
                              const dateString = selectedDate.includes('-') && !selectedDate.includes('T') && !selectedDate.includes(' ')
                                ? selectedDate + 'T12:00:00'
                                : selectedDate;
                              const parsed = new Date(dateString);
                              if (!isNaN(parsed.getTime())) {
                                baseDate = parsed;
                              }
                            }

                            const date = new Date(baseDate.getTime());
                            date.setDate(date.getDate() + day);
                            const dateStr = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });

                            const mappedLocators = Object.entries(locatorMapping)
                              .filter(([_, d]) => d === day)
                              .map(([loc]) => loc);

                            return (
                              <th
                                key={day}
                                onClick={() => requestSort(`day_${day}`)}
                                className="px-4 py-3 text-center sticky top-0 bg-slate-50 dark:bg-slate-800 z-20 border-b border-slate-200 dark:border-slate-700 min-w-[100px] cursor-pointer group/header select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                              >
                                <Tooltip
                                  label={
                                    <Stack gap={4}>
                                      <Text size="xs" fw={700}>Locators in this bucket:</Text>
                                      {mappedLocators.length > 0 ? (
                                        mappedLocators.map(loc => <Text key={loc} size="xs">{loc}</Text>)
                                      ) : (
                                        <Text size="xs" c="dimmed">No locators mapped</Text>
                                      )}
                                    </Stack>
                                  }
                                  withArrow
                                  position="top"
                                  multiline
                                  w={200}
                                  portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}
                                >
                                  <div className="cursor-help inline-block w-full">
                                    <div className="flex flex-col items-center">
                                      <div className="flex items-center justify-center">
                                        <span className="text-xs font-bold dark:text-slate-200">Day {day}</span>
                                        {getSortIcon(`day_${day}`)}
                                      </div>
                                      <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500 normal-case">
                                        {dayName}, {dateStr}
                                      </div>
                                    </div>
                                  </div>
                                </Tooltip>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {processedData.results.map((row, i) => {
                          const isExpanded = expandedRows.has(row.partNumber);
                          return (
                            <React.Fragment key={row.partNumber}>
                              <tr
                                className={cn(
                                  "hover:bg-slate-50/50 dark:hover:bg-slate-800/30 group transition-colors cursor-pointer",
                                  isExpanded && "bg-slate-50/80 dark:bg-slate-800/40"
                                )}
                                onClick={() => {
                                  const next = new Set(expandedRows);
                                  if (isExpanded) {
                                    next.delete(row.partNumber);
                                  } else {
                                    next.add(row.partNumber);
                                  }
                                  setExpandedRows(next);
                                }}
                              >
                                <td
                                  className={cn(
                                    "px-4 font-medium text-slate-900 dark:text-slate-100 sticky left-0 z-10 border-r border-slate-100 dark:border-slate-800 min-w-[140px] shadow-[1px_0_0_0_#f1f5f9] dark:shadow-[1px_0_0_0_#1e293b] flex items-center gap-2",
                                    isExpanded ? "bg-slate-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50",
                                    density === 'xs' ? 'py-1' : density === 'sm' ? 'py-3' : 'py-5'
                                  )}
                                >
                                  {isExpanded ? <ChevronUp size={14} className="text-indigo-600" /> : <ChevronDown size={14} className="text-slate-400" />}
                                  {row.partNumber}
                                </td>
                                <td
                                  className={cn(
                                    "px-4 sticky left-[140px] z-10 border-r border-slate-100 dark:border-slate-800 min-w-[100px] shadow-[1px_0_0_0_#f1f5f9] dark:shadow-[1px_0_0_0_#1e293b] text-slate-600 dark:text-slate-400",
                                    isExpanded ? "bg-slate-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50",
                                    density === 'xs' ? 'py-1' : density === 'sm' ? 'py-3' : 'py-5'
                                  )}
                                >
                                  {row.dailyRate}
                                </td>
                                <td
                                  className={cn(
                                    "px-4 sticky left-[240px] z-10 border-r border-slate-100 dark:border-slate-800 min-w-[120px] shadow-[1px_0_0_0_#f1f5f9] dark:shadow-[1px_0_0_0_#1e293b] text-slate-600 dark:text-slate-400",
                                    isExpanded ? "bg-slate-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50",
                                    density === 'xs' ? 'py-1' : density === 'sm' ? 'py-3' : 'py-5'
                                  )}
                                >
                                  {row.totalPipelineDOI.toFixed(1)}
                                </td>
                                {processedData.dayColumns.map(day => {
                                  const metrics = row.dayMetrics[day];
                                  const isNegative = metrics.variance < 0;
                                  return (
                                    <td key={day} className={cn(
                                      "px-4 text-center border-l border-slate-100 dark:border-slate-800 transition-colors",
                                      isNegative ? "bg-red-50/80 dark:bg-red-900/20 group-hover:bg-red-100/80 dark:group-hover:bg-red-900/30" : "group-hover:bg-slate-50/50 dark:group-hover:bg-slate-800/40",
                                      isExpanded && !isNegative && "bg-slate-50/80 dark:bg-slate-800/60",
                                      density === 'xs' ? 'py-1' : density === 'sm' ? 'py-2' : 'py-4'
                                    )}>
                                      <Tooltip
                                        label={
                                          <Stack gap={4}>
                                            <Text size="xs" fw={700}>Locator Breakdown:</Text>
                                            {Object.entries(metrics.locatorBreakdown).length > 0 ? (
                                              Object.entries(metrics.locatorBreakdown).map(([loc, qty]) => (
                                                <Text key={loc} size="xs">{loc} = {qty} parts</Text>
                                              ))
                                            ) : (
                                              <Text size="xs" c="dimmed">No WIP in this bucket</Text>
                                            )}
                                          </Stack>
                                        }
                                        withArrow
                                        position="top"
                                        multiline
                                        portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}
                                      >
                                        <div className="cursor-help">
                                          <div className={cn("font-semibold", isNegative ? "text-red-700 dark:text-red-400" : "text-slate-800 dark:text-slate-200")}>
                                            {metrics.expected}
                                          </div>
                                          <div className={cn(
                                            "text-xs font-medium mt-0.5",
                                            isNegative ? "text-red-600 dark:text-red-500" : "text-emerald-600 dark:text-emerald-500"
                                          )}>
                                            {metrics.variance > 0 ? '+' : ''}{metrics.variance}
                                          </div>
                                        </div>
                                      </Tooltip>
                                    </td>
                                  );
                                })}
                              </tr>
                              {isExpanded && row.distributions.map((dist, idx) => (
                                <tr key={`${row.partNumber}-${dist.id}`} className="bg-white dark:bg-slate-900 border-l-4 border-l-indigo-500">
                                  <td
                                    colSpan={3}
                                    className={cn(
                                      "px-8 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 border-r border-slate-100 dark:border-slate-800 sticky left-0 z-10 shadow-[1px_0_0_0_#f1f5f9] dark:shadow-[1px_0_0_0_#1e293b]",
                                      density === 'xs' ? 'py-1' : 'py-2'
                                    )}
                                  >
                                    {dist.id}
                                  </td>
                                  {processedData.dayColumns.map(day => (
                                    <td
                                      key={day}
                                      className={cn(
                                        "px-4 text-center border-l border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs",
                                        density === 'xs' ? 'py-1' : 'py-2'
                                      )}
                                    >
                                      {dist.dayVolumes[day] || 0}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    {processedData.results.length === 0 && (
                      <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center">
                        <AlertCircle className="w-8 h-8 text-slate-300 mb-2" />
                        <p>No data found or mapping resulted in empty forecast.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {mainTab === 'scorecard-mgmt' && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
            <DeliveryScorecardManagement />
          </div>
        )}

        {mainTab === 'scorecard-dash' && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
            <DeliveryScorecardDisplay />
          </div>
        )}

        {mainTab === 'settings' && (
          <div className="max-w-3xl mx-auto w-full mt-4">
            <DatabaseSettings />
          </div>
        )}
      </div>

      <Modal
        opened={isUploaderModalOpen}
        onClose={() => setIsUploaderModalOpen(false)}
        title={
          <div className="flex items-center gap-2">
            <LayoutList className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">Merge Pipeline Data</span>
          </div>
        }
        size="xl"
        radius="md"
        padding="xl"
        className="dark:bg-slate-900"
      >
        <MultiCsvUploader />
      </Modal>
    </div>
  );
}

function FileDropzone({ label, accept, onDrop, file }: { label: string, accept: string, onDrop: (file: File) => void, file: File | null }) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer",
        isDragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 scale-[1.02]" : "border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/30",
        file ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-500" : ""
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onDrop(e.dataTransfer.files[0]);
        }
      }}
      onClick={() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = (e) => {
          const target = e.target as HTMLInputElement;
          if (target.files && target.files.length > 0) {
            onDrop(target.files[0]);
          }
        };
        input.click();
      }}
    >
      {file ? (
        <>
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
          <span className="text-sm font-semibold text-emerald-800">{file.name}</span>
          <span className="text-xs text-emerald-600 mt-1">{(file.size / 1024).toFixed(1)} KB</span>
        </>
      ) : (
        <>
          <UploadCloud className="w-10 h-10 text-slate-400 mb-3" />
          <span className="text-sm font-semibold text-slate-700">{label}</span>
          <span className="text-xs text-slate-500 mt-1">Drag & drop or click to select</span>
        </>
      )}
    </div>
  );
}
