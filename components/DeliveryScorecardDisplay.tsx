'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocalStorage } from '@mantine/hooks';
import { useScorecardStore, DayOfWeek, DailyScorecardRecord, PartScorecard } from '@/lib/scorecardStore';
import { 
  Tabs, Select, Table, Card, Text, Group, Badge, Title, Box, Tooltip, Stack, Button, ActionIcon, Paper, SegmentedControl,
  RingProgress, Divider as MantineDivider, TextInput, Grid, useMantineTheme, rgba, Center
} from '@mantine/core';
import { 
  IconPlus, IconChevronDown, IconChevronRight, IconSearch, IconArrowsSort, 
  IconSortAscending, IconSortDescending, IconChartBar, IconTarget, IconRefresh,
  IconChevronsDown, IconChevronsUp, IconActivity, IconCalendar,
  IconLayoutSidebarRight, IconLayoutBottombar, IconDatabaseX, IconArrowRight
} from '@tabler/icons-react';
import { useGlobalWeek } from './WeekContext';
import { EditEntryModal } from './EditEntryModal';
import { ShiftProductionEntryModal } from './ShiftProductionEntryModal';
import { DeliveryLossPareto } from './DeliveryLossPareto';
import { ShiftAttainmentChart } from './ShiftAttainmentChart';
import { notifications } from '@mantine/notifications';
import { DAYS_OF_WEEK, getTodayNumeric, getWeekDates, isWorkingDay, parseISOLocal, generateWeekLabel } from '@/lib/dateUtils';
import { useProcessStore } from '@/lib/processStore';
import { useProductionDisplayUnit } from '@/hooks/useProductionDisplayUnit';
import { useAttainmentMath } from '@/lib/hooks/useAttainmentMath';



interface GroupedPartScorecard {
  partNumber: string;
  aggregatedRecords: DailyScorecardRecord[];
  shifts: (PartScorecard & { rollingGap: number })[];
  totalActual: number;
  totalTarget: number;
  gap: number;
  rollingGap: number;
}

export default function DeliveryScorecardDisplay() {
  const theme = useMantineTheme();
  const processes = useProcessStore(state => state.processes);
  const store = useScorecardStore();
  const [activeTab, setActiveTab] = useLocalStorage<string | null>({
    key: 'production-planner-active-tab',
    defaultValue: null
  });
  const { selectedWeekId, setSelectedWeekId } = useGlobalWeek();
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof GroupedPartScorecard; direction: 'asc' | 'desc' } | null>({ key: 'partNumber', direction: 'asc' });
  const [connectionString, setConnectionString] = useState<string | null>(null);
  const [partInfo, setPartInfo] = useState<any[]>([]);
  const [displayUnit, setDisplayUnit] = useProductionDisplayUnit();
  const [layoutMode, setLayoutMode] = useLocalStorage<'stacked' | 'widescreen'>({
    key: 'dashboard-layout-mode',
    defaultValue: 'stacked',
  });

  const isWidescreen = layoutMode === 'widescreen';

  const [rollingGaps, setRollingGaps] = useState<Record<string, number>>({});

  useEffect(() => {
    async function loadRollingGaps() {
      if (!connectionString || !activeTab) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const gaps = await invoke<any[]>('get_rolling_gaps', {
          connectionString,
          department: activeTab
        });
        
        const gapMap: Record<string, number> = {};
        gaps.forEach((g: any) => {
          gapMap[`${g.partNumber}-${g.shift}`] = g.rollingGap;
        });
        setRollingGaps(gapMap);
      } catch (err) {
        console.error("Failed to fetch rolling gaps", err);
      }
    }
    loadRollingGaps();
  }, [connectionString, activeTab, store.syncStatus]);

  // ── Dynamic height measurement for widescreen table constraint ──
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);

  const measureHeight = useCallback(() => {
    if (leftColumnRef.current && isWidescreen) {
      const rect = leftColumnRef.current.getBoundingClientRect();
      // 16px bottom padding so the table doesn't touch the window edge
      const height = window.innerHeight - rect.top - 16;
      setAvailableHeight(Math.max(height, 300)); // floor at 300px minimum
    } else {
      setAvailableHeight(null);
    }
  }, [isWidescreen]);

  useEffect(() => {
    measureHeight();
    window.addEventListener('resize', measureHeight);
    // Re-measure after a short delay for layout settling (tab switches, etc.)
    const timer = setTimeout(measureHeight, 100);
    return () => {
      window.removeEventListener('resize', measureHeight);
      clearTimeout(timer);
    };
  }, [measureHeight]);

  // Create a lookup map for the current department to ensure correct batch sizes
  const batchSizeMap = React.useMemo(() => {
    const map = new Map<string, number>();
    if (partInfo && activeTab) {
      partInfo.forEach(p => {
        if (p.process === activeTab) {
          map.set(p.partNumber, p.batchSize || 1);
        }
      });
    }
    return map;
  }, [partInfo, activeTab]);

  React.useEffect(() => {
    async function loadConnStr() {
      const { load } = await import('@tauri-apps/plugin-store');
      try {
        const storeRes = await load("store.json", { autoSave: false, defaults: {} });
        const val = await storeRes.get<string>("db_connection_string");
        setConnectionString(val || null);
        
        if (val) {
          const { invoke } = await import('@tauri-apps/api/core');
          const parts = await invoke<any[]>("get_part_info_preview", { connectionString: val });
          setPartInfo(parts);
        }
      } catch (err) {
        console.error("Failed to load connection string or part info:", err);
      }
    }
    loadConnStr();
  }, []);

  const handleFetchFromDb = async () => {
    if (!connectionString) return;
    await store.fetchFromDb(connectionString);
  };

  const requestSort = (key: keyof GroupedPartScorecard) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: keyof GroupedPartScorecard) => {
    if (!sortConfig || sortConfig.key !== key) return <IconArrowsSort size={14} style={{ opacity: 0.3 }} />;
    return sortConfig.direction === 'asc' ? <IconSortAscending size={14} /> : <IconSortDescending size={14} />;
  };

  const toggleExpand = (partNumber: string) => {
    setExpandedParts(prev => {
      const next = new Set(prev);
      if (next.has(partNumber)) next.delete(partNumber);
      else next.add(partNumber);
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedParts(new Set(groupedParts.map(g => g.partNumber)));
  };

  const handleCollapseAll = () => {
    setExpandedParts(new Set());
  };

  // Edit Modal State
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editingEntry, setEditingEntry] = useState<{
    partNumber: string;
    shift: string;
    rowId: string;
    dayOfWeek: DayOfWeek;
    record: DailyScorecardRecord;
  } | null>(null);

  // Shift Production Modal State
  const [shiftModalOpened, setShiftModalOpened] = useState(false);

  // Initialize active tab from processes if null
  React.useEffect(() => {
    if (!activeTab && processes.length > 0) {
      setActiveTab(processes[0]);
    }
  }, [processes, activeTab]);

  const activeDepartment = activeTab ? store.departments[activeTab] : null;

  // Render variables
  const weekOptions = activeDepartment 
    ? Object.values(activeDepartment.weeks).map(w => ({ value: w.weekId, label: w.weekLabel })) 
    : [];

  if (selectedWeekId && !weekOptions.find(w => w.value === selectedWeekId)) {
    weekOptions.push({ value: selectedWeekId, label: generateWeekLabel(selectedWeekId) });
  }

  // Removed localized useEffect that was clearing global week selection

  const activeWeek = activeDepartment && selectedWeekId ? activeDepartment.weeks[selectedWeekId] : null;

  const attainmentMetrics = useAttainmentMath(activeWeek?.parts);

  const getCellStyles = (actual: number | null, target: number | null) => {
    if (actual === null || target === null) return {};
    if (actual >= target) {
      return { 
        bg: 'light-dark(var(--mantine-color-green-0), rgba(0, 100, 0, 0.15))', 
        color: 'light-dark(var(--mantine-color-green-8), var(--mantine-color-green-2))', 
        fw: 700 
      };
    }
    return { 
      bg: 'light-dark(var(--mantine-color-red-0), rgba(139, 0, 0, 0.15))', 
      color: 'light-dark(var(--mantine-color-red-8), var(--mantine-color-red-2))', 
      fw: 700 
    };
  };



  const handleCellClick = (rowId: string, partNumber: string, shift: string, dayOfWeek: DayOfWeek, record: DailyScorecardRecord) => {
    setEditingEntry({ rowId, partNumber, shift, dayOfWeek, record });
    setEditModalOpened(true);
  };

  // Grouped data transformation
  const groupedParts = React.useMemo(() => {
     if (!activeWeek) return [];

     const todayNumeric = getTodayNumeric();
     const groups: Record<string, GroupedPartScorecard> = {};

     activeWeek.parts.forEach(part => {
        // Calculate child rolling gap
        let childRollingGap = rollingGaps[`${part.partNumber}-${part.shift}`] || 0;
        const batchSize = batchSizeMap.get(part.partNumber) || 1;
        const multiplier = displayUnit === 'pieces' ? batchSize : 1;

        if (!groups[part.partNumber]) {
           groups[part.partNumber] = {
              partNumber: part.partNumber,
               aggregatedRecords: DAYS_OF_WEEK.map(day => ({
                  dayOfWeek: day as DayOfWeek,
                  actual: 0,
                  target: 0,
                  reasons: [] as string[]
               } as DailyScorecardRecord & { reasons: string[] })),
              shifts: [],
              totalActual: 0,
              totalTarget: 0,
              gap: 0,
              rollingGap: 0
           };
        }

        const group = groups[part.partNumber];
        group.shifts.push({ ...part, rollingGap: childRollingGap });

         part.dailyRecords.forEach((record, idx) => {
            const agg = group.aggregatedRecords[idx] as any;
            agg.actual = (agg.actual ?? 0) + ((record.actual ?? 0) * multiplier);
            agg.target = (agg.target ?? 0) + ((record.target ?? 0) * multiplier);
            if (record.reasonCode) {
               if (!agg.reasons) agg.reasons = [];
               agg.reasons.push(`${part.shift}: ${record.reasonCode}`);
            }
         });

        const partActual = part.dailyRecords.reduce((sum, r) => sum + (r.actual || 0), 0) * multiplier;
        const partTarget = part.dailyRecords.reduce((sum, r) => sum + (r.target || 0), 0) * multiplier;
        
        group.totalActual += partActual;
        group.totalTarget += partTarget;
        group.gap += (partActual - partTarget);
        group.rollingGap += (childRollingGap * multiplier);
     });

     let results = Object.values(groups);

     // Apply Filtering
     if (searchQuery) {
        results = results.filter(p => p.partNumber.toLowerCase().includes(searchQuery.toLowerCase()));
     }

     // Apply Sorting
     if (sortConfig) {
        results.sort((a, b) => {
           const aValue = a[sortConfig.key];
           const bValue = b[sortConfig.key];
           
           if (typeof aValue === 'string' && typeof bValue === 'string') {
              return sortConfig.direction === 'asc' 
                 ? aValue.localeCompare(bValue) 
                 : bValue.localeCompare(aValue);
           }
           
           if (typeof aValue === 'number' && typeof bValue === 'number') {
              return sortConfig.direction === 'asc' ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
           }
           
           return 0;
        });
     }

     return results;
  }, [activeWeek, searchQuery, sortConfig, displayUnit, batchSizeMap]);

  const calculatedTotals = React.useMemo(() => {
    const totals = {
      daily: DAYS_OF_WEEK.map(() => ({ actual: 0, target: 0 })),
      totalActual: 0,
      totalTarget: 0,
      gap: 0,
      rollingGap: 0
    };

    groupedParts.forEach(group => {
      group.aggregatedRecords.forEach((record, idx) => {
        totals.daily[idx].actual += record.actual || 0;
        totals.daily[idx].target += record.target || 0;
      });
      totals.totalActual += group.totalActual;
      totals.totalTarget += group.totalTarget;
      totals.gap += group.gap;
      totals.rollingGap += group.rollingGap;
    });

    return totals;
  }, [groupedParts]);

  return (
    <Stack gap="md" className="w-full">
      <Group justify="space-between" align="center">
        <Stack gap={4}>
          <Title order={2}>Delivery Scorecard & Loss Pareto</Title>
          <Text c="dimmed" size="sm">Daily performance tracking and root cause analysis.</Text>
        </Stack>
        <Group>
          <Group gap={4}>
            <Tooltip label="Expand All Rows" withArrow position="bottom">
              <ActionIcon variant="subtle" color="indigo" size="md" onClick={handleExpandAll}>
                <IconChevronsDown size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Collapse All Rows" withArrow position="bottom">
              <ActionIcon variant="subtle" color="indigo" size="md" onClick={handleCollapseAll}>
                <IconChevronsUp size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <SegmentedControl
            size="xs"
            value={displayUnit}
            onChange={(val) => setDisplayUnit(val as any)}
            data={[
              { label: 'Batches', value: 'batches' },
              { label: 'Pieces', value: 'pieces' },
            ]}
            color="indigo"
          />
          <Tooltip label={isWidescreen ? 'Switch to Stacked Layout' : 'Switch to Widescreen Layout'} withArrow position="bottom">
            <ActionIcon
              variant={isWidescreen ? 'filled' : 'subtle'}
              color="indigo"
              size="lg"
              onClick={() => setLayoutMode(isWidescreen ? 'stacked' : 'widescreen')}
              aria-label="Toggle Widescreen Mode"
            >
              {isWidescreen ? <IconLayoutSidebarRight size={20} /> : <IconLayoutBottombar size={20} />}
            </ActionIcon>
          </Tooltip>
          <Button 
            variant="light" 
            leftSection={<IconRefresh size={16} />} 
            onClick={handleFetchFromDb}
            loading={store.isLoading}
            disabled={!connectionString}
          >
            Sync from DB
          </Button>
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={() => setShiftModalOpened(true)}
          >
            Record Shift Production
          </Button>
        </Group>
      </Group>
      
      <Grid gutter="md">
        {/* ═══════ GROUP A: Scorecard + Data Table (Left in widescreen) ═══════ */}
        <Grid.Col span={isWidescreen ? { base: 12, lg: 7 } : 12}>
          <Stack ref={leftColumnRef} gap="md" style={isWidescreen && availableHeight ? { height: availableHeight, overflow: 'hidden' } : undefined}>
            {activeWeek && (
              <Card withBorder radius="md" p="lg" shadow="sm">
                <Group justify="space-between" align="stretch">
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Group gap="xs">
                      <IconActivity size={20} color="var(--mantine-color-indigo-6)" />
                      <Text fw={700} size="sm" tt="uppercase" c="dimmed">Performance Scorecard</Text>
                    </Group>
                    
                    <Group gap="xl" mt="sm">
                      <Box>
                        <RingProgress
                          size={120}
                          thickness={12}
                          roundCaps
                          sections={[{ value: attainmentMetrics.cumulativeWTD, color: attainmentMetrics.cumulativeWTD >= 85 ? 'green.6' : 'red.6' }]}
                          label={
                            <Stack gap={0} align="center">
                              <Text ta="center" fw={800} size="xl" style={{ lineHeight: 1 }}>
                                {attainmentMetrics.cumulativeWTD}%
                              </Text>
                              <Text ta="center" size="xs" c="dimmed" fw={700}>WTD</Text>
                            </Stack>
                          }
                        />
                      </Box>
                      
                      <Stack gap={4} justify="center">
                        <Title order={3} style={{ lineHeight: 1 }}>Cumulative Week-to-Date</Title>
                        <Text size="sm" c="dimmed" maw={300}>
                          Strict attainment logic excluding future shifts. Goal: <strong>85%</strong>.
                        </Text>
                        <Group gap="xs" mt={4}>
                          <Badge variant="light" color={attainmentMetrics.cumulativeWTD >= 85 ? 'green' : 'red'} size="sm">
                            {attainmentMetrics.cumulativeWTD >= 85 ? 'On Track' : 'Below Target'}
                          </Badge>
                          <Text size="xs" c="dimmed">Based on recorded shifts only</Text>
                        </Group>
                      </Stack>

                      <MantineDivider orientation="vertical" />

                      <Box style={{ flex: 1 }}>
                        <Group gap="xs" mb="xs">
                          <IconCalendar size={16} color="var(--mantine-color-gray-6)" />
                          <Text size="xs" fw={700} c="dimmed">DAILY ATTAINMENT BREAKDOWN</Text>
                        </Group>
                        <Group gap="sm" wrap="nowrap">
                          {DAYS_OF_WEEK.map((day, idx) => {
                            const score = attainmentMetrics.dailyAttainments[idx];
                            const isRecorded = score !== null;
                            
                            return (
                              <Paper 
                                key={day} 
                                withBorder 
                                p="xs" 
                                radius="sm" 
                                style={{ 
                                  flex: 1, 
                                  textAlign: 'center',
                                  backgroundColor: !isRecorded ? 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))' : 'transparent',
                                  opacity: !isRecorded ? 0.6 : 1
                                }}
                              >
                                <Text size="10px" fw={800} c="dimmed" mb={2}>{day.toUpperCase()}</Text>
                                <Text 
                                  size="sm" 
                                  fw={800} 
                                  c={!isRecorded ? 'gray.4' : (score >= 85 ? 'green.7' : 'red.7')}
                                >
                                  {isRecorded ? `${Math.round(score)}%` : '—'}
                                </Text>
                              </Paper>
                            );
                          })}
                        </Group>
                      </Box>
                    </Group>
                  </Stack>
                </Group>
              </Card>
            )}

            <Paper withBorder p="sm" radius="md" className="bg-gray-50/30 dark:bg-zinc-900/30" style={isWidescreen ? { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } : undefined}>
              <Stack gap="md" style={isWidescreen ? { flex: 1, minHeight: 0, overflow: 'hidden' } : undefined}>
                <Group justify="space-between" align="center">
                  <Tabs value={activeTab} onChange={setActiveTab} variant="pills">
                    <Tabs.List>
                      {processes.map(name => (
                        <Tabs.Tab 
                          key={name} 
                          value={name} 
                          color="indigo"
                        >
                          {name}
                        </Tabs.Tab>
                      ))}
                    </Tabs.List>
                  </Tabs>

                  <Group gap="sm">
                    <TextInput
                      placeholder="Search Part Number..."
                      leftSection={<IconSearch size={16} />}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.currentTarget.value)}
                      size="sm"
                      w={240}
                    />
                    <Select
                      placeholder="Select Week"
                      value={selectedWeekId}
                      onChange={setSelectedWeekId}
                      data={weekOptions}
                      size="sm"
                      w={220}
                    />
                  </Group>
                </Group>

                <Box 
                  style={{ 
                    borderRadius: '8px', 
                    border: '1px solid var(--mantine-color-gray-3)',
                    ...(isWidescreen ? {
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      overflowX: 'auto',
                    } : {
                      overflowX: 'auto',
                    }),
                  }}
                >
              {selectedWeekId ? (
                <Table 
                  verticalSpacing="sm" 
                  striped 
                  highlightOnHover 
                  className="w-full" 
                  style={{ minWidth: isWidescreen ? 900 : undefined }}
                  stickyHeader
                  stickyHeaderOffset={0}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th 
                        onClick={() => requestSort('partNumber')} 
                        style={{ 
                          cursor: 'pointer',
                          position: 'sticky',
                          top: 0,
                          left: 0,
                          zIndex: 20,
                          backgroundColor: 'light-dark(var(--mantine-color-white), var(--mantine-color-dark-7))',
                          minWidth: 140,
                        }}
                        className="hover:bg-gray-50 dark:hover:bg-dark-6"
                      >
                        <Group gap={4} wrap="nowrap">
                          <Text size="xs" fw={700} c="dimmed">PART NUMBER</Text>
                          {getSortIcon('partNumber')}
                        </Group>
                      </Table.Th>
                      <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">SHIFT</Text></Table.Th>
                      {DAYS_OF_WEEK.map((day, idx) => {
                        const dayDate = activeWeek ? getWeekDates(activeWeek.weekId)[idx] : null;
                        const dateStr = dayDate ? dayDate.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '';
                        return (
                          <Table.Th key={day} ta="center">
                            <Stack gap={0} align="center">
                              <Text size="xs" fw={700} c="dimmed">{day.toUpperCase()}</Text>
                              {dateStr && <Text size="10px" c="indigo.4" fw={700}>{dateStr}</Text>}
                            </Stack>
                          </Table.Th>
                        );
                      })}
                      <Table.Th 
                        ta="center" 
                        onClick={() => requestSort('totalActual')} 
                        style={{ cursor: 'pointer' }}
                        className="hover:bg-gray-50"
                      >
                        <Group gap={4} justify="center" wrap="nowrap">
                          <Text size="xs" fw={700} c="dimmed">ACTUAL</Text>
                          {getSortIcon('totalActual')}
                        </Group>
                      </Table.Th>
                      <Table.Th 
                        ta="center" 
                        onClick={() => requestSort('totalTarget')} 
                        style={{ cursor: 'pointer' }}
                        className="hover:bg-gray-50"
                      >
                        <Group gap={4} justify="center" wrap="nowrap">
                          <Text size="xs" fw={700} c="dimmed">TARGET</Text>
                          {getSortIcon('totalTarget')}
                        </Group>
                      </Table.Th>
                      <Table.Th 
                        ta="center" 
                        onClick={() => requestSort('gap')} 
                        style={{ cursor: 'pointer' }}
                        className="hover:bg-gray-50"
                      >
                        <Group gap={4} justify="center" wrap="nowrap">
                          <Text size="xs" fw={700} c="dimmed">GAP</Text>
                          {getSortIcon('gap')}
                        </Group>
                      </Table.Th>
                      <Table.Th 
                        ta="center" 
                        onClick={() => requestSort('rollingGap')} 
                        style={{ cursor: 'pointer' }}
                        className="hover:bg-gray-50"
                      >
                        <Group gap={4} justify="center" wrap="nowrap">
                          <Text size="xs" fw={700} c="dimmed">ROLLING GAP</Text>
                          {getSortIcon('rollingGap')}
                        </Group>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(!activeWeek || groupedParts.length === 0) ? (
                      <Table.Tr>
                        <Table.Td colSpan={14} py="xl">
                          <Center>
                            <Stack align="center" gap="xs">
                               <IconDatabaseX size={32} color="var(--mantine-color-gray-4)" />
                               <Text c="dimmed" size="sm">No data available for {generateWeekLabel(selectedWeekId)}.</Text>
                            </Stack>
                          </Center>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      groupedParts.map(group => {
                        const isExpanded = expandedParts.has(group.partNumber);
                        
                        return (
                        <React.Fragment key={group.partNumber}>
                          {/* Parent Row */}
                          <Table.Tr 
                            bg="light-dark(var(--mantine-color-indigo-0), var(--mantine-color-dark-7))" 
                            style={{ cursor: 'pointer' }} 
                            onClick={() => toggleExpand(group.partNumber)}
                          >
                            <Table.Td 
                              fw={700}
                              style={{
                                position: 'sticky',
                                left: 0,
                                zIndex: 1,
                                backgroundColor: 'light-dark(var(--mantine-color-indigo-0), var(--mantine-color-dark-7))',
                              }}
                            >
                              <Group gap="xs" wrap="nowrap">
                                <ActionIcon 
                                  variant="subtle" 
                                  size="sm" 
                                  onClick={(e) => { e.stopPropagation(); toggleExpand(group.partNumber); }}
                                  className="transition-transform"
                                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}
                                >
                                  <IconChevronDown size={14} />
                                </ActionIcon>
                                <Text fw={700} size="sm">{group.partNumber}</Text>
                              </Group>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Badge variant="dot" size="xs" color="indigo">All Shifts</Badge>
                            </Table.Td>
                            {group.aggregatedRecords.map((record, idx) => {
                              const styles = getCellStyles(record.actual, record.target);
                              return (
                                <Table.Td key={idx} ta="center" bg={styles.bg}>
                                  <Tooltip
                                     label={
                                       <Stack gap={2}>
                                         <Text size="xs" fw={700}>Part: {group.partNumber} (All Shifts)</Text>
                                         <Text size="xs">Total Actual: {record.actual}</Text>
                                         <Text size="xs">Total Target: {record.target}</Text>
                                         {(record as any).reasons?.length > 0 && (
                                           <Box mt={4}>
                                             <Text size="10px" fw={700} c="dimmed" tt="uppercase">Shift Reasons:</Text>
                                             {(record as any).reasons.map((r: string, i: number) => (
                                               <Text key={i} size="xs" c="orange.7" fw={600}>• {r}</Text>
                                             ))}
                                           </Box>
                                         )}
                                       </Stack>
                                     }
                                     withArrow
                                     position="top"
                                     disabled={record.actual === 0 && record.target === 0}
                                     styles={{
                                       tooltip: {
                                         backgroundColor: 'light-dark(white, var(--mantine-color-dark-6))',
                                         color: 'light-dark(var(--mantine-color-black), var(--mantine-color-white))',
                                         border: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
                                       }
                                     }}
                                  >
                                    <Box py="xs" px="xs">
                                      <Text size="sm" fw={700} c={styles.color}>{record.actual}</Text>
                                      <Text size="10px" c="light-dark(gray.6, dark.2)">Tgt: {record.target}</Text>
                                    </Box>
                                  </Tooltip>
                                </Table.Td>
                              );
                            })}
                            <Table.Td ta="center" bg={`light-dark(var(--mantine-color-indigo-1), ${rgba(theme.colors.indigo[9], 0.2)})`}>
                              <Text size="sm" fw={800}>{group.totalActual}</Text>
                            </Table.Td>
                            <Table.Td ta="center" bg={`light-dark(var(--mantine-color-indigo-1), ${rgba(theme.colors.indigo[9], 0.2)})`}>
                              <Text size="sm" fw={800}>{group.totalTarget}</Text>
                            </Table.Td>
                            <Table.Td ta="center" bg={group.gap < 0 ? `light-dark(var(--mantine-color-red-1), ${rgba(theme.colors.red[9], 0.2)})` : `light-dark(var(--mantine-color-green-1), ${rgba(theme.colors.green[9], 0.2)})`}>
                              <Text size="sm" fw={800} c={group.gap < 0 ? 'light-dark(var(--mantine-color-red-9), var(--mantine-color-red-2))' : 'light-dark(var(--mantine-color-green-9), var(--mantine-color-green-2))'}>
                                {group.gap > 0 ? `+${group.gap}` : group.gap}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="center" bg={group.rollingGap < 0 ? `light-dark(var(--mantine-color-red-1), ${rgba(theme.colors.red[9], 0.2)})` : `light-dark(var(--mantine-color-green-1), ${rgba(theme.colors.green[9], 0.2)})`}>
                              <Text size="sm" fw={800} c={group.rollingGap < 0 ? 'light-dark(var(--mantine-color-red-9), var(--mantine-color-red-2))' : 'light-dark(var(--mantine-color-green-9), var(--mantine-color-green-2))'}>
                                {group.rollingGap > 0 ? `+${group.rollingGap}` : group.rollingGap}
                              </Text>
                            </Table.Td>
                          </Table.Tr>

                          {/* Child Rows */}
                          {isExpanded && [...group.shifts]
                            .sort((a, b) => {
                              const order: Record<string, number> = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 };
                              return (order[a.shift] || 99) - (order[b.shift] || 99);
                            })
                            .map(part => {
                            const totalActual = part.dailyRecords.reduce((sum, r) => sum + (r.actual || 0), 0);
                            const totalTarget = part.dailyRecords.reduce((sum, r) => sum + (r.target || 0), 0);
                            const gap = totalActual - totalTarget;

                            const batchSize = batchSizeMap.get(part.partNumber) || 1;
                            const multiplier = displayUnit === 'pieces' ? batchSize : 1;

                            return (
                              <Table.Tr key={part.id} bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))">
                                <Table.Td 
                                  pl={40}
                                  style={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 1,
                                    backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))',
                                  }}
                                >
                                  <Group gap="xs" wrap="nowrap">
                                     <Text size="xs" c="dimmed" fw={500} style={{ width: 14 }}></Text>
                                     <Text size="xs" c="dimmed" fw={500}>{part.partNumber}</Text>
                                  </Group>
                                </Table.Td>
                                <Table.Td ta="center">
                                  <Badge variant="light" size="xs" color="blue">{part.shift}</Badge>
                                </Table.Td>
                                {DAYS_OF_WEEK.map(day => {
                                  const record = part.dailyRecords.find(r => r.dayOfWeek === day);
                                  const actualValue = record?.actual ?? null;
                                  const targetValue = record?.target ?? null;
                                  
                                  // Panama Schedule Logic
                                  const anchorDate = store.shiftSettings[part.shift];
                                  const targetDate = record?.date ? parseISOLocal(record.date) : null;
                                  const isWorking = targetDate ? isWorkingDay(targetDate, anchorDate) : true;
                                  const isDayOff = !isWorking;

                                  const displayedActual = actualValue !== null ? actualValue * multiplier : null;
                                  const displayedTarget = targetValue !== null ? targetValue * multiplier : 0;

                                  // Apply color styles only if actual production is recorded
                                  const performanceStyles = (actualValue !== null && targetValue !== null) 
                                    ? getCellStyles(actualValue, targetValue) 
                                    : {};

                                  // Final Background Logic: Recede scheduled off days
                                  let cellBg = performanceStyles.bg || 'transparent';
                                  if (isDayOff) {
                                    cellBg = 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))';
                                  }

                                  // Content Logic: Muted em-dash for empty off days
                                  const isInactiveOffDay = isDayOff && (actualValue === 0 || actualValue === null) && (targetValue === 0 || targetValue === null);
                                  const displayValue = isInactiveOffDay ? '—' : (displayedActual ?? '-');
                                  const textColor = isInactiveOffDay ? 'dimmed' : (performanceStyles.color || 'light-dark(black, white)');

                                  return (
                                    <Table.Td 
                                      key={day} 
                                      ta="center" 
                                      bg={cellBg} 
                                      p={0}
                                      className={`${isDayOff ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'} transition-colors`}
                                      onClick={() => !isDayOff && record && handleCellClick(part.id, part.partNumber, part.shift, day, record)}
                                    >
                                      <Tooltip 
                                        label={
                                          <Stack gap={2}>
                                            <Group gap="xs" justify="space-between">
                                              <Text size="xs" fw={700}>Part: {part.partNumber} (Shift {part.shift})</Text>
                                              {isDayOff && <Badge size="9px" variant="light" color="gray">Off Schedule</Badge>}
                                            </Group>
                                            <Text size="xs">Actual: {displayedActual ?? 'Not recorded'}</Text>
                                            <Text size="xs">Target: {displayedTarget ?? 0}</Text>
                                            {record?.reasonCode && (
                                              <Box mt={4}>
                                                <Text size="10px" fw={700} c="dimmed" tt="uppercase">Loss Reason:</Text>
                                                <Text size="xs" c="orange.7" fw={600}>{record.reasonCode}</Text>
                                              </Box>
                                            )}
                                          </Stack>
                                        }
                                        withArrow
                                        position="top"
                                        disabled={record?.actual === 0 && record?.target === 0 && !isDayOff}
                                        styles={{
                                          tooltip: {
                                            backgroundColor: 'light-dark(white, var(--mantine-color-dark-6))',
                                            color: 'light-dark(var(--mantine-color-black), var(--mantine-color-white))',
                                            border: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
                                          }
                                        }}
                                      >
                                        <Box py="xs" px="xs">
                                          <Text size="xs" fw={700} c={textColor}>{displayValue}</Text>
                                          {!isInactiveOffDay && <Text size="10px" c="light-dark(gray.5, dark.3)">{displayedTarget}</Text>}
                                        </Box>
                                      </Tooltip>
                                    </Table.Td>
                                  );
                                })}
                                <Table.Td ta="center" bg="light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-7))">
                                  <Text size="xs" fw={700}>{totalActual * multiplier}</Text>
                                </Table.Td>
                                <Table.Td ta="center" bg="light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-7))">
                                  <Text size="xs" fw={700}>{totalTarget * multiplier}</Text>
                                </Table.Td>
                                <Table.Td ta="center" bg={gap < 0 ? 'light-dark(red.0, #2c0e0e)' : 'light-dark(green.0, #0e2c0e)'}>
                                  <Text size="xs" fw={700} c={gap < 0 ? 'red.7' : 'green.7'}>
                                    {(gap * multiplier) > 0 ? `+${gap * multiplier}` : (gap * multiplier)}
                                  </Text>
                                </Table.Td>
                                <Table.Td ta="center" bg={part.rollingGap < 0 ? 'light-dark(red.0, #2c0e0e)' : 'light-dark(green.0, #0e2c0e)'}>
                                  <Text size="xs" fw={700} c={part.rollingGap < 0 ? 'red.7' : 'green.7'}>
                                    {(part.rollingGap * multiplier) > 0 ? `+${part.rollingGap * multiplier}` : (part.rollingGap * multiplier)}
                                  </Text>
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    }))}
                  </Table.Tbody>
                  <Table.Tfoot 
                    className="shadow-[0_-2px_4px_rgba(0,0,0,0.05)]"
                    style={{ 
                      borderTop: '2px solid var(--mantine-color-gray-3)',
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 10,
                      backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-7))'
                    }}
                  >
                    <Table.Tr fw={800}>
                      <Table.Td
                        style={{
                          position: 'sticky',
                          left: 0,
                          zIndex: 2,
                          backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-7))',
                        }}
                      >
                        <Text size="sm" fw={800}>GRAND TOTAL ({displayUnit === 'batches' ? 'Batches' : 'Pieces'})</Text>
                      </Table.Td>
                      <Table.Td ta="center">
                        <Badge variant="filled" size="xs" color="indigo">TOTALS</Badge>
                      </Table.Td>
                      {calculatedTotals.daily.map((day, idx) => (
                        <Table.Td key={idx} ta="center">
                          <Box py="xs" px="xs">
                            <Text size="sm" fw={800}>{day.actual.toLocaleString()}</Text>
                            <Text size="10px" c="light-dark(gray.6, dark.2)">Tgt: {day.target.toLocaleString()}</Text>
                          </Box>
                        </Table.Td>
                      ))}
                      <Table.Td ta="center" bg="light-dark(var(--mantine-color-indigo-0), rgba(0, 40, 120, 0.15))">
                        <Text size="sm" fw={900}>{calculatedTotals.totalActual.toLocaleString()}</Text>
                      </Table.Td>
                      <Table.Td ta="center" bg="light-dark(var(--mantine-color-indigo-0), rgba(0, 40, 120, 0.15))">
                        <Text size="sm" fw={900}>{calculatedTotals.totalTarget.toLocaleString()}</Text>
                      </Table.Td>
                      <Table.Td ta="center" bg={calculatedTotals.gap < 0 ? 'light-dark(var(--mantine-color-red-0), rgba(139, 0, 0, 0.15))' : 'light-dark(var(--mantine-color-green-0), rgba(0, 100, 0, 0.15))'}>
                        <Text size="sm" fw={900} c={calculatedTotals.gap < 0 ? 'light-dark(var(--mantine-color-red-9), var(--mantine-color-red-4))' : 'light-dark(var(--mantine-color-green-9), var(--mantine-color-green-4))'}>
                          {calculatedTotals.gap > 0 ? `+${calculatedTotals.gap.toLocaleString()}` : calculatedTotals.gap.toLocaleString()}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="center" bg={calculatedTotals.rollingGap < 0 ? 'light-dark(var(--mantine-color-red-0), rgba(139, 0, 0, 0.15))' : 'light-dark(var(--mantine-color-green-0), rgba(0, 100, 0, 0.15))'}>
                        <Text size="sm" fw={900} c={calculatedTotals.rollingGap < 0 ? 'light-dark(var(--mantine-color-red-9), var(--mantine-color-red-4))' : 'light-dark(var(--mantine-color-green-9), var(--mantine-color-green-4))'}>
                          {calculatedTotals.rollingGap > 0 ? `+${calculatedTotals.rollingGap.toLocaleString()}` : calculatedTotals.rollingGap.toLocaleString()}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              ) : (
                <Center py={60}>
                  <Stack align="center" gap="md">
                    <Box 
                      p="xl" 
                      style={{ 
                        borderRadius: '50%', 
                        background: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))' 
                      }}
                    >
                      <IconDatabaseX size={48} stroke={1.5} color="var(--mantine-color-indigo-4)" />
                    </Box>
                    <Stack gap={4} align="center">
                      <Text fw={700} size="lg">No Week Selected</Text>
                      <Text c="dimmed" size="sm" ta="center" maw={400}>
                        Please select a week to view performance metrics.
                      </Text>
                    </Stack>
                  </Stack>
                </Center>
              )}
                </Box>
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>

        {/* ═══════ GROUP B: Charts Container (Right in widescreen) ═══════ */}
        <Grid.Col span={isWidescreen ? { base: 12, lg: 5 } : 12}>
          {activeDepartment && activeWeek && editingEntry && (
            <EditEntryModal
              opened={editModalOpened}
              onClose={() => setEditModalOpened(false)}
              departmentName={activeDepartment.departmentName}
              weekId={activeWeek.weekId}
              weekLabel={activeWeek.weekLabel}
              partNumber={editingEntry.partNumber}
              shift={editingEntry.shift}
              rowId={editingEntry.rowId}
              dayOfWeek={editingEntry.dayOfWeek}
              initialData={editingEntry.record}
            />
          )}

          <ShiftProductionEntryModal
            opened={shiftModalOpened}
            onClose={() => setShiftModalOpened(false)}
            onSuccess={() => {
              // Refresh scorecard data after submission
            }}
          />

          {activeTab && (
            <Tabs defaultValue="pareto" variant="outline">
              <Tabs.List>
                <Tabs.Tab value="pareto" leftSection={<IconChartBar size={16} />}>Loss Pareto</Tabs.Tab>
                <Tabs.Tab value="attainment" leftSection={<IconTarget size={16} />}>Shift Attainment</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="pareto">
                <DeliveryLossPareto 
                  weekData={activeWeek}
                  departmentName={activeTab}
                  compact={isWidescreen}
                  displayUnit={displayUnit}
                  batchSizeMap={batchSizeMap}
                />
              </Tabs.Panel>

              <Tabs.Panel value="attainment">
                <ShiftAttainmentChart 
                  weekData={activeWeek}
                  departmentName={activeTab}
                  compact={isWidescreen}
                />
              </Tabs.Panel>
            </Tabs>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
