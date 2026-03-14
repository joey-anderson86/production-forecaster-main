'use client';

import React, { useState, useMemo, useRef } from 'react';
import Papa from 'papaparse';
import { 
  UploadCloud, Settings, ChevronDown, ChevronUp, 
  AlertCircle, CheckCircle2, BarChart3, Info, 
  DownloadCloud, Search, Filter, Columns, 
  Maximize, Minimize, LayoutList
} from 'lucide-react';
import { 
  TextInput, ActionIcon, Group, Tooltip, 
  Menu, Button, Stack, Text, Box
} from '@mantine/core';
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

  // Toolbar States
  const [searchQuery, setSearchQuery] = useState('');
  const [density, setDensity] = useState<'xs' | 'sm' | 'md'>('sm');
  const tableRef = useRef<HTMLDivElement>(null);
  const { toggle: toggleFullscreen, fullscreen } = useFullscreen({ element: tableRef.current });

  const getPartNumberKey = (keys: string[]) => {
    return keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === 'partnumber') || keys[0];
  };

  const handleFileUpload = (file: File, type: 'pipeline' | 'dailyRate') => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        if (type === 'pipeline') {
          setPipelineFile(file);
          setPipelineData(results.data as PipelineData);
          if (results.data.length > 0) {
            const keys = Object.keys(results.data[0] as Record<string, any>);
            const partNumberKey = getPartNumberKey(keys);
            const locatorKeys = keys.filter(k => k !== partNumberKey);
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

  const processedData = useMemo(() => {
    if (!forecastGenerated || pipelineData.length === 0 || dailyRateData.length === 0) return null;

    const pipelinePartKey = getPartNumberKey(Object.keys(pipelineData[0]));
    const ratePartKey = getPartNumberKey(Object.keys(dailyRateData[0]));
    const rateValueKey = Object.keys(dailyRateData[0]).find(k => k !== ratePartKey) || Object.keys(dailyRateData[0])[1];

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

    let results = pipelineData.map(row => {
      const partNumber = String(row[pipelinePartKey]).trim();
      const dailyRate = ratesMap.get(partNumber) || 0;
      
      let totalWip = 0;
      const dayVolumes: Record<number, number> = {};
      dayColumns.forEach(d => dayVolumes[d] = 0);

      locators.forEach(loc => {
        const qty = Number(row[loc]) || 0;
        totalWip += qty;
        const mappedDay = locatorMapping[loc];
        if (mappedDay !== undefined) {
          dayVolumes[mappedDay] += qty;
        }
      });

      const totalPipelineDOI = dailyRate > 0 ? totalWip / dailyRate : 0;

      const dayMetrics: Record<number, { expected: number, variance: number }> = {};
      dayColumns.forEach(d => {
        const expected = dayVolumes[d];
        const variance = expected - dailyRate;
        dayMetrics[d] = { expected, variance };
      });

      return {
        partNumber,
        dailyRate,
        totalWip,
        totalPipelineDOI,
        dayMetrics
      };
    });

    // Apply Search Filter
    if (searchQuery) {
      results = results.filter(row => 
        row.partNumber.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return { results, dayColumns };
  }, [forecastGenerated, pipelineData, dailyRateData, locators, locatorMapping, searchQuery]);

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
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Production Forecaster</h1>
            <p className="text-slate-500 text-sm mt-1">Map WIP locators to forecast shipment readiness.</p>
          </div>
          <BarChart3 className="w-8 h-8 text-indigo-600" />
        </header>

        {/* Configuration Panel */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <button 
            onClick={() => setIsConfigOpen(!isConfigOpen)}
            className="w-full flex items-center justify-between p-4 md:p-6 bg-white hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-slate-800">Configuration & Data Upload</h2>
            </div>
            {isConfigOpen ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>
          
          {isConfigOpen && (
            <div className="p-4 md:p-6 border-t border-slate-100 space-y-8">
              <div className="grid md:grid-cols-2 gap-6">
                <FileDropzone 
                  label="Upload Pipeline CSV" 
                  accept=".csv" 
                  onDrop={(f) => handleFileUpload(f, 'pipeline')} 
                  file={pipelineFile} 
                />
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
                      <h3 className="text-md font-semibold text-slate-800">Locator Mapping</h3>
                      <div className="group relative">
                        <Info className="w-4 h-4 text-slate-400 cursor-help" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 bg-slate-800 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                          Assign each WIP locator to &quot;X days from planned shipment&quot;. 0 = Today, 1 = Tomorrow, etc.
                        </div>
                      </div>
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
                        className="cursor-pointer px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded hover:bg-slate-50 transition-colors flex items-center gap-1 shadow-sm"
                      >
                        <UploadCloud className="w-3 h-3" /> Import
                      </label>
                      <button 
                        onClick={handleExportMapping}
                        className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded hover:bg-slate-50 transition-colors flex items-center gap-1 shadow-sm"
                      >
                        <DownloadCloud className="w-3 h-3" /> Export
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {locators.map(loc => (
                      <div key={loc} className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-col gap-2">
                        <label className="text-xs font-medium text-slate-600 truncate" title={loc}>{loc}</label>
                        <input 
                          type="number" 
                          value={locatorMapping[loc]} 
                          onChange={(e) => handleMappingChange(loc, parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t border-slate-100">
                <button 
                  onClick={handleGenerate}
                  disabled={!pipelineFile || !dailyRateFile}
                  className={cn(
                    "px-6 py-2.5 rounded-lg font-medium text-sm transition-all shadow-sm",
                    pipelineFile && dailyRateFile 
                      ? "bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md" 
                      : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  )}
                >
                  Generate Forecast
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Dashboard */}
        {forecastGenerated && processedData && summary && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-500">Total Parts Starving Today</span>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-3xl font-bold tracking-tight", summary.starvingToday > 0 ? "text-red-600" : "text-emerald-600")}>
                    {summary.starvingToday}
                  </span>
                  <span className="text-sm text-slate-400">parts</span>
                </div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-500">Average Pipeline DOI</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tracking-tight text-slate-800">
                    {summary.avgDOI.toFixed(2)}
                  </span>
                  <span className="text-sm text-slate-400">days</span>
                </div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-500">Filtered Parts</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tracking-tight text-slate-800">
                    {processedData.results.length}
                  </span>
                  <span className="text-sm text-slate-400">parts</span>
                </div>
              </div>
            </div>

            {/* Main Data Table */}
            <div 
              ref={tableRef}
              className={cn(
                "bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col",
                fullscreen && "p-8 overflow-auto h-screen w-screen"
              )}
            >
              <div className="p-4 border-b border-slate-100 bg-white">
                <Group justify="space-between" align="center" gap="md">
                  <TextInput
                    placeholder="Search Part Number..."
                    leftSection={<Search size={16} />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.currentTarget.value)}
                    size="sm"
                    className="flex-1 max-w-sm"
                  />
                  
                  <Group gap="xs">
                    <Tooltip label="Filters">
                      <ActionIcon variant="light" color="indigo" size="lg" onClick={() => console.log('Filter clicked')}>
                        <Filter size={18} />
                      </ActionIcon>
                    </Tooltip>
                    
                    <Menu shadow="md" width={200}>
                      <Menu.Target>
                        <Tooltip label="Show/Hide Columns">
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

                    <Menu shadow="md" width={150}>
                      <Menu.Target>
                        <Tooltip label="Toggle Density">
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

                    <Tooltip label={fullscreen ? "Exit Full Screen" : "Toggle Full Screen"}>
                      <ActionIcon variant="light" color="indigo" size="lg" onClick={toggleFullscreen}>
                        {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              </div>

              <div className="p-2 bg-slate-50/50 border-b border-slate-100 flex items-center justify-end gap-4 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-100 border border-emerald-200"></div>
                  <span>Healthy</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-100 border border-red-200"></div>
                  <span>Shortage</span>
                </div>
              </div>

              <div className="overflow-x-auto relative flex-1">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="text-xs text-slate-600 uppercase bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 sticky left-0 bg-slate-50 z-20 border-r border-b border-slate-200 min-w-[140px] shadow-[1px_0_0_0_#e2e8f0]">Part Number</th>
                      <th className="px-4 py-3 sticky left-[140px] bg-slate-50 z-20 border-r border-b border-slate-200 min-w-[100px] shadow-[1px_0_0_0_#e2e8f0]">Daily Rate</th>
                      <th className="px-4 py-3 sticky left-[240px] bg-slate-50 z-20 border-r border-b border-slate-200 min-w-[120px] shadow-[1px_0_0_0_#e2e8f0]">Pipeline DOI</th>
                      {processedData.dayColumns.map(day => (
                        <th key={day} className="px-4 py-3 text-center border-b border-slate-200 min-w-[100px]">Day {day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {processedData.results.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 group transition-colors">
                        <td 
                          className={cn(
                            "px-4 font-medium text-slate-900 sticky left-0 bg-white z-10 border-r border-slate-100 min-w-[140px] group-hover:bg-slate-50 shadow-[1px_0_0_0_#f1f5f9]",
                            density === 'xs' ? 'py-1' : density === 'sm' ? 'py-3' : 'py-5'
                          )}
                        >
                          {row.partNumber}
                        </td>
                        <td 
                          className={cn(
                            "px-4 sticky left-[140px] bg-white z-10 border-r border-slate-100 min-w-[100px] group-hover:bg-slate-50 shadow-[1px_0_0_0_#f1f5f9] text-slate-600",
                            density === 'xs' ? 'py-1' : density === 'sm' ? 'py-3' : 'py-5'
                          )}
                        >
                          {row.dailyRate}
                        </td>
                        <td 
                          className={cn(
                            "px-4 sticky left-[240px] bg-white z-10 border-r border-slate-100 min-w-[120px] group-hover:bg-slate-50 shadow-[1px_0_0_0_#f1f5f9] text-slate-600",
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
                              "px-4 text-center border-l border-slate-100 transition-colors",
                              isNegative ? "bg-red-50/80 group-hover:bg-red-100/80" : "group-hover:bg-slate-50/50",
                              density === 'xs' ? 'py-1' : density === 'sm' ? 'py-2' : 'py-4'
                            )}>
                              <div className={cn("font-semibold", isNegative ? "text-red-700" : "text-slate-800")}>
                                {metrics.expected}
                              </div>
                              <div className={cn(
                                "text-xs font-medium mt-0.5", 
                                isNegative ? "text-red-600" : "text-emerald-600"
                              )}>
                                {metrics.variance > 0 ? '+' : ''}{metrics.variance}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
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
      </div>
    </div>
  );
}

function FileDropzone({ label, accept, onDrop, file }: { label: string, accept: string, onDrop: (file: File) => void, file: File | null }) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div 
      className={cn(
        "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer",
        isDragging ? "border-indigo-500 bg-indigo-50 scale-[1.02]" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50",
        file ? "bg-emerald-50 border-emerald-500 hover:bg-emerald-50 hover:border-emerald-500" : ""
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
