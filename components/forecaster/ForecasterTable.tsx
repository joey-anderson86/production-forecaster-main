'use client';

import React, { useState } from 'react';
import { Group, TextInput, Button, Tooltip, ActionIcon, Badge, Popover, Stack, Text, MultiSelect, Menu } from '@mantine/core';
import { 
  DownloadCloud, Filter, Columns, LayoutList, Maximize, Minimize, 
  ChevronUp, ChevronDown, CheckCircle2, AlertCircle, ArrowUpDown, 
  SortAsc, SortDesc 
} from 'lucide-react';
import { ProcessedForecast, SortConfig, SortField, PartForecast } from './ForecasterTypes';
import { cn } from '@/lib/utils';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

interface ForecasterTableProps {
  processedData: ProcessedForecast;
  selectedDate: string;
  selectedPartNumbers: string[];
  setSelectedPartNumbers: (nums: string[]) => void;
  allPartNumbers: string[];
  sortConfig: SortConfig;
  requestSort: (key: SortField) => void;
  density: string;
  setDensity: (d: 'xs' | 'sm' | 'md') => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  locatorMapping: Record<string, number>;
}

export function ForecasterTable({
  processedData,
  selectedDate,
  selectedPartNumbers,
  setSelectedPartNumbers,
  allPartNumbers,
  sortConfig,
  requestSort,
  density,
  setDensity,
  fullscreen,
  toggleFullscreen,
  searchQuery,
  setSearchQuery,
  locatorMapping
}: ForecasterTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) return <ArrowUpDown size={14} className="ml-1 opacity-20" />;
    return sortConfig.direction === 'asc' ? <SortAsc size={14} className="ml-1 text-indigo-600" /> : <SortDesc size={14} className="ml-1 text-indigo-600" />;
  };

  const handleExportForecast = async () => {
    try {
      const header = ["PartNumber", "DailyRate", "PipelineDOI", ...processedData.dayColumns.map(d => `Day ${d}`)];
      const rows = processedData.results.map(row => [
        row.partNumber,
        row.dailyRate,
        row.totalPipelineDOI.toFixed(2),
        ...processedData.dayColumns.map(d => row.dayMetrics[d].expected)
      ]);
      const csv = [header.join(","), ...rows.map(r => r.join(","))].join("\n");
      
      const path = await save({ filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (path) {
        await writeFile(path, new TextEncoder().encode(csv));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className={cn(
      "bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col",
      fullscreen && "fixed inset-0 z-[1000] !rounded-none"
    )} id="fullscreen-table-container">
      <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <Group justify="space-between">
          <TextInput
            placeholder="Search part number..."
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
            <Popover position="bottom-end" shadow="md" withArrow trapFocus opened={isFilterOpen} onChange={setIsFilterOpen}>
              <Popover.Target>
                <Tooltip label="Filters" portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                  <ActionIcon variant="light" color="indigo" size="lg" className="relative" onClick={() => setIsFilterOpen((o) => !o)}>
                    <Filter size={18} />
                    {selectedPartNumbers.length > 0 && (
                      <Badge size="xs" circle color="red" className="absolute -top-1 -right-1 z-10" p={0}>
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
                      <Button variant="light" color="red" size="xs" onClick={() => setSelectedPartNumbers([])}>Clear All</Button>
                    )}
                    <Button variant="filled" color="indigo" size="xs" onClick={() => setIsFilterOpen(false)}>Done</Button>
                  </Group>
                </Stack>
              </Popover.Dropdown>
            </Popover>

            <Menu shadow="md" width={200} portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
              <Menu.Target>
                <Tooltip label="Show/Hide Columns" portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                  <ActionIcon variant="light" color="indigo" size="lg">
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
              <th onClick={() => requestSort('partNumber')} className="px-4 py-3 sticky top-0 left-0 bg-slate-50 dark:bg-slate-800 z-30 border-r border-b border-slate-200 dark:border-slate-700 min-w-[140px] shadow-[1px_0_0_0_#e2e8f0] dark:shadow-[1px_0_0_0_#1e293b] cursor-pointer group/header select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <div className="flex items-center">Part Number {getSortIcon('partNumber')}</div>
              </th>
              <th onClick={() => requestSort('dailyRate')} className="px-4 py-3 sticky top-0 left-[140px] bg-slate-50 dark:bg-slate-800 z-30 border-r border-b border-slate-200 dark:border-slate-700 min-w-[100px] shadow-[1px_0_0_0_#e2e8f0] dark:shadow-[1px_0_0_0_#1e293b] cursor-pointer group/header select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <div className="flex items-center">Daily Rate {getSortIcon('dailyRate')}</div>
              </th>
              <th onClick={() => requestSort('totalPipelineDOI')} className="px-4 py-3 sticky top-0 left-[240px] bg-slate-50 dark:bg-slate-800 z-30 border-r border-b border-slate-200 dark:border-slate-700 min-w-[120px] shadow-[1px_0_0_0_#e2e8f0] dark:shadow-[1px_0_0_0_#1e293b] cursor-pointer group/header select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <div className="flex items-center">Pipeline DOI {getSortIcon('totalPipelineDOI')}</div>
              </th>
              {processedData.dayColumns.map(day => {
                let baseDate = new Date();
                const dateString = selectedDate.includes('-') && !selectedDate.includes('T') ? selectedDate + 'T12:00:00' : selectedDate;
                const parsed = new Date(dateString);
                if (!isNaN(parsed.getTime())) baseDate = parsed;

                const date = new Date(baseDate.getTime());
                date.setDate(date.getDate() + day);
                const dateStr = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });

                const mappedLocators = Object.entries(locatorMapping).filter(([_, d]) => d === day).map(([loc]) => loc);

                return (
                  <th key={day} onClick={() => requestSort(`day_${day}`)} className="px-4 py-3 text-center sticky top-0 bg-slate-50 dark:bg-slate-800 z-20 border-b border-slate-200 dark:border-slate-700 min-w-[100px] cursor-pointer group/header select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    <Tooltip label={
                      <Stack gap={4}>
                        <Text size="xs" fw={700}>Locators in this bucket:</Text>
                        {mappedLocators.length > 0 ? mappedLocators.map(loc => <Text key={loc} size="xs">{loc}</Text>) : <Text size="xs" c="dimmed">No locators mapped</Text>}
                      </Stack>
                    } withArrow position="top" multiline w={200} portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                      <div className="cursor-help inline-block w-full">
                        <div className="flex flex-col items-center">
                          <div className="flex items-center justify-center">
                            <span className="text-xs font-bold dark:text-slate-200">Day {day}</span>
                            {getSortIcon(`day_${day}`)}
                          </div>
                          <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500 normal-case">{dayName}, {dateStr}</div>
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
                  <tr className={cn("hover:bg-slate-50/50 dark:hover:bg-slate-800/30 group transition-colors cursor-pointer", isExpanded && "bg-slate-50/80 dark:bg-slate-800/40")}
                    onClick={() => setExpandedRows(prev => {
                      const next = new Set(prev);
                      if (isExpanded) next.delete(row.partNumber);
                      else next.add(row.partNumber);
                      return next;
                    })}
                  >
                    <td className={cn("px-4 font-medium text-slate-900 dark:text-slate-100 sticky left-0 z-10 border-r border-slate-100 dark:border-slate-800 min-w-[140px] shadow-[1px_0_0_0_#f1f5f9] dark:shadow-[1px_0_0_0_#1e293b] flex items-center gap-2", isExpanded ? "bg-slate-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50", density === 'xs' ? 'py-1' : density === 'sm' ? 'py-3' : 'py-5')}>
                      {isExpanded ? <ChevronUp size={14} className="text-indigo-600" /> : <ChevronDown size={14} className="text-slate-400" />}
                      {row.partNumber}
                    </td>
                    <td className={cn("px-4 sticky left-[140px] z-10 border-r border-slate-100 dark:border-slate-800 min-w-[100px] shadow-[1px_0_0_0_#f1f5f9] dark:shadow-[1px_0_0_0_#1e293b] text-slate-600 dark:text-slate-400", isExpanded ? "bg-slate-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50", density === 'xs' ? 'py-1' : density === 'sm' ? 'py-3' : 'py-5')}>
                      {row.dailyRate}
                    </td>
                    <td className={cn("px-4 sticky left-[240px] z-10 border-r border-slate-100 dark:border-slate-800 min-w-[120px] shadow-[1px_0_0_0_#f1f5f9] dark:shadow-[1px_0_0_0_#1e293b] text-slate-600 dark:text-slate-400", isExpanded ? "bg-slate-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50", density === 'xs' ? 'py-1' : density === 'sm' ? 'py-3' : 'py-5')}>
                      {row.totalPipelineDOI.toFixed(1)}
                    </td>
                    {processedData.dayColumns.map(day => {
                      const metrics = row.dayMetrics[day];
                      const isNegative = metrics.variance < 0;
                      return (
                        <td key={day} className={cn("px-4 text-center border-l border-slate-100 dark:border-slate-800 transition-colors", isNegative ? "bg-red-50/80 dark:bg-red-900/20 group-hover:bg-red-100/80 dark:group-hover:bg-red-900/30" : "group-hover:bg-slate-50/50 dark:group-hover:bg-slate-800/40", isExpanded && !isNegative && "bg-slate-50/80 dark:bg-slate-800/60", density === 'xs' ? 'py-1' : density === 'sm' ? 'py-2' : 'py-4')}>
                          <Tooltip label={
                            <Stack gap={4}>
                              <Text size="xs" fw={700}>Locator Breakdown:</Text>
                              {Object.entries(metrics.locatorBreakdown).length > 0 ? Object.entries(metrics.locatorBreakdown).map(([loc, qty]) => <Text key={loc} size="xs">{loc} = {qty} parts</Text>) : <Text size="xs" c="dimmed">No WIP in this bucket</Text>}
                            </Stack>
                          } withArrow position="top" multiline portalProps={{ target: fullscreen ? '#fullscreen-table-container' : undefined }}>
                            <div className="cursor-help">
                              <div className={cn("font-semibold", isNegative ? "text-red-700 dark:text-red-400" : "text-slate-800 dark:text-slate-200")}>{metrics.expected}</div>
                              <div className={cn("text-xs font-medium mt-0.5", isNegative ? "text-red-600 dark:text-red-500" : "text-emerald-600 dark:text-emerald-500")}>{metrics.variance > 0 ? '+' : ''}{metrics.variance}</div>
                            </div>
                          </Tooltip>
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && row.distributions.map((dist) => (
                    <tr key={`${row.partNumber}-${dist.id}`} className="bg-white dark:bg-slate-900 border-l-4 border-l-indigo-500">
                      <td colSpan={3} className={cn("px-8 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 border-r border-slate-100 dark:border-slate-800 sticky left-0 z-10 shadow-[1px_0_0_0_#f1f5f9] dark:shadow-[1px_0_0_0_#1e293b]", density === 'xs' ? 'py-1' : 'py-2')}>{dist.id}</td>
                      {processedData.dayColumns.map(day => (
                        <td key={day} className={cn("px-4 text-center border-l border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs", density === 'xs' ? 'py-1' : 'py-2')}>{dist.dayVolumes[day] || 0}</td>
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
  );
}
