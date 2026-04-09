'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Button,
  Group,
  Title,
  Text,
  Badge,
  Stack,
  Paper,
  Box,
  ActionIcon,
  Tabs,
  Select,
  NumberInput,
  Progress,
  HoverCard,
  Tooltip,
  Divider,
  Loader,
  Center,
  Modal,
  TextInput,
  Alert,
} from '@mantine/core';
import {
  IconPlus,
  IconDatabase,
  IconCalendarPlus,
  IconChevronRight,
  IconChevronDown,
  IconCalculator,
  IconAlertCircle,
} from '@tabler/icons-react';
import { 
  DayOfWeek, 
  DAYS_OF_WEEK, 
  getDayOfWeekLabel, 
  parseISOLocal, 
  generateWeekLabel,
  getWeekDates,
  formatISODate,
  formatSqlDate,
  isWorkingDay
} from '@/lib/dateUtils';
import { useScorecardStore } from '@/lib/scorecardStore';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { useAvailableMachines } from '@/hooks/useAvailableMachines';

// --- TypeScript Interfaces ---

/** Raw database row from dbo.ProcessInfo */
export interface ProcessInfoRow {
  process: string;
  date: string; // YYYY-MM-DD
  hoursAvailable: number;
  machineId: string;
  shift: 'A' | 'B' | 'C' | 'D';
  weekIdentifier: string;
}

export interface ShiftAllocation {
  shift: 'A' | 'B' | 'C' | 'D';
  dailyHours: Record<DayOfWeek, number | null>;
}

export interface MachineSchedule {
  id: string;
  machineId: string;
  process: string;
  baseAvailableHours: number; // Derived or static
  shifts: ShiftAllocation[];
}

// --- Data Transformation Utility ---

/**
 * Transforms flat DB rows into nested Machine -> Shift -> Day hierarchy.
 */
export function transformProcessData(rows: ProcessInfoRow[]): MachineSchedule[] {
  const machineMap = new Map<string, MachineSchedule>();

  rows.forEach((row) => {
    if (!machineMap.has(row.machineId)) {
      machineMap.set(row.machineId, {
        id: row.machineId, // Using machineId as unique ID for this view
        machineId: row.machineId,
        process: row.process,
        baseAvailableHours: 24, // Default baseline, can be customized
        shifts: (['A', 'B', 'C', 'D'] as const).map((s) => ({
          shift: s,
          dailyHours: { Mon: null, Tue: null, Wed: null, Thu: null, Fri: null, Sat: null, Sun: null },
        })),
      });
    }

    const machine = machineMap.get(row.machineId)!;
    const shiftAlloc = machine.shifts.find((s) => s.shift === row.shift);
    
    if (shiftAlloc) {
      const dateObj = parseISOLocal(row.date);
      const dayLabel = getDayOfWeekLabel(dateObj);
      shiftAlloc.dailyHours[dayLabel] = row.hoursAvailable;
    }
  });

  return Array.from(machineMap.values());
}

// --- Sub-Component: Shift Row (Child) ---

const ShiftRow = ({
  allocation,
  onUpdateHour,
  weekDates,
  shiftSettings,
}: {
  allocation: ShiftAllocation;
  onUpdateHour: (day: DayOfWeek, value: number | null) => void;
  weekDates: Date[];
  shiftSettings: Record<string, string>;
}) => {
  const rowTotal = Object.values(allocation.dailyHours).reduce((sum: number, h) => sum + (h || 0), 0);

  return (
    <Table.Tr className="bg-gray-50/50">
      <Table.Td pl={40}>
        <Text size="xs" fw={700} c="dimmed">
          SHIFT {allocation.shift}
        </Text>
      </Table.Td>
      <Table.Td />
      {DAYS_OF_WEEK.map((day, idx) => {
        const date = weekDates[idx];
        const isWorking = date ? isWorkingDay(date, shiftSettings[allocation.shift] || '') : true;
        const isDisabled = !isWorking;

        return (
          <Table.Td 
            key={day} 
            p={2} 
            style={{ 
              borderLeft: '1px solid var(--mantine-color-gray-2)',
              backgroundColor: isDisabled ? 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))' : 'transparent',
            }}
          >
            <Tooltip 
              label={`Shift ${allocation.shift} is OFF on this day`} 
              disabled={!isDisabled}
              position="top"
              withinPortal
            >
              <Box>
                <NumberInput
                  value={allocation.dailyHours[day] ?? ''}
                  onChange={(val) => onUpdateHour(day, typeof val === 'number' ? val : null)}
                  hideControls
                  variant="unstyled"
                  min={0}
                  max={24}
                  placeholder={isDisabled ? "" : "-"}
                  disabled={isDisabled}
                  className="text-center"
                  styles={{
                    input: {
                      textAlign: 'center',
                      height: 32,
                      fontSize: '12px',
                      fontWeight: isDisabled ? 400 : 500,
                      opacity: isDisabled ? 0.6 : 1,
                      cursor: isDisabled ? 'not-allowed' : 'text',
                      '&:focus': {
                        backgroundColor: 'white',
                        boxShadow: 'inset 0 0 0 1px var(--mantine-color-blue-2)',
                      },
                    },
                  }}
                />
              </Box>
            </Tooltip>
          </Table.Td>
        );
      })}
      <Table.Td className="bg-gray-100/50" style={{ borderLeft: '2px solid var(--mantine-color-gray-3)' }}>
        <Text fw={700} ta="center" size="xs" c={rowTotal > 0 ? 'blue.7' : 'dimmed'}>
          {rowTotal}h
        </Text>
      </Table.Td>
    </Table.Tr>
  );
};

// --- Sub-Component: Machine Row (Parent) ---

const MachineRow = ({
  schedule,
  isExpanded,
  onToggle,
  onUpdateShiftHour,
  weekDates,
  shiftSettings,
}: {
  schedule: MachineSchedule;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateShiftHour: (shift: 'A' | 'B' | 'C' | 'D', day: DayOfWeek, value: number | null) => void;
  weekDates: Date[];
  shiftSettings: Record<string, string>;
}) => {
  const dailyTotals = useMemo(() => {
    return DAYS_OF_WEEK.map((day) =>
      schedule.shifts.reduce((sum: number, s) => sum + (s.dailyHours[day] || 0), 0)
    );
  }, [schedule.shifts]);

  const weeklyTotal = dailyTotals.reduce((a: number, b) => a + b, 0);

  return (
    <>
      <Table.Tr 
        onClick={onToggle} 
        className="cursor-pointer hover:bg-blue-50/30 transition-colors"
        style={{ backgroundColor: isExpanded ? 'var(--mantine-color-blue-0)' : 'transparent' }}
      >
        <Table.Td>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon variant="subtle" size="sm" color="blue">
              {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </ActionIcon>
            <Stack gap={0}>
              <Text fw={700} size="sm">
                {schedule.machineId}
              </Text>
              <Text size="10px" c="dimmed">
                Cap: {schedule.baseAvailableHours}h/day
              </Text>
            </Stack>
          </Group>
        </Table.Td>
        <Table.Td ta="center">
          <Badge variant="light" color="blue" size="xs">
            {schedule.shifts.length} SHIFTS
          </Badge>
        </Table.Td>
        {dailyTotals.map((total, i) => (
          <Table.Td key={i} ta="center" style={{ borderLeft: '1px solid var(--mantine-color-blue-1)' }}>
            <Text fw={700} size="xs" c={total > 0 ? 'blue.9' : 'dimmed'}>
              {total > 0 ? `${total}h` : '—'}
            </Text>
          </Table.Td>
        ))}
        <Table.Td className="bg-blue-100/50" style={{ borderLeft: '2px solid var(--mantine-color-blue-2)' }}>
          <Text fw={800} ta="center" size="sm" c="blue.9">
            {weeklyTotal}h
          </Text>
        </Table.Td>
      </Table.Tr>
      {isExpanded && schedule.shifts.map((s) => (
          <ShiftRow
            key={s.shift}
            allocation={s}
            onUpdateHour={(day, val) => onUpdateShiftHour(s.shift, day, val)}
            weekDates={weekDates}
            shiftSettings={shiftSettings}
          />
        ))}
    </>
  );
};

// --- Sub-Component: Add Equipment Modal ---

function AddEquipmentModal({ 
  opened, 
  onClose, 
  onAdd,
  activeProcess,
}: { 
  opened: boolean; 
  onClose: () => void; 
  onAdd: (machineId: string) => void;
  activeProcess: string | null;
}) {
  const [machineId, setMachineId] = useState<string | null>(null);
  const { machines, isLoading, isError } = useAvailableMachines(activeProcess);

  const handleSubmit = () => {
    if (machineId) {
      onAdd(machineId);
      setMachineId(null);
      onClose();
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={900} size="xl">Add New Equipment</Text>} radius="md">
      <Stack gap="md">
        <Select
          label={<Text fw={700} size="sm">Machine ID <Text span c="red">*</Text></Text>}
          placeholder={isLoading ? "Loading machines..." : "Select machine"}
          data={machines}
          value={machineId}
          onChange={setMachineId}
          searchable
          required
          disabled={isLoading}
          rightSection={isLoading ? <Loader size="xs" /> : null}
          nothingFoundMessage={isError ? `Error: ${isError}` : "No machines found for this process"}
          error={isError}
        />
        <Group justify="flex-end" mt="xl">
          <Button variant="subtle" onClick={onClose} color="gray">Cancel</Button>
          <Button onClick={handleSubmit} color="blue" disabled={!machineId || isLoading}>Add Machine</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// --- Sub-Component: Add Week Modal ---

function AddWorkWeekModal({ 
  opened, 
  onClose, 
  onGenerate, 
  availableWeeks 
}: { 
  opened: boolean; 
  onClose: () => void; 
  onGenerate: (data: any) => void;
  availableWeeks: string[];
}) {
  const [weekId, setWeekId] = useState('');
  const [displayLabel, setDisplayLabel] = useState('');
  const [copyFrom, setCopyFrom] = useState<string | null>(null);

  // Auto-generate label when weekId changes
  useEffect(() => {
    if (weekId && weekId.length >= 7) {
      setDisplayLabel(generateWeekLabel(weekId));
    } else {
      setDisplayLabel('');
    }
  }, [weekId]);

  const handleSubmit = () => {
    onGenerate({ weekId, displayLabel, copyFrom });
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={900} size="xl">Add New Work Week</Text>} radius="md">
      <Stack gap="md">
        <TextInput
          label={<Text fw={700} size="sm">Week Identifier <Text span c="red">*</Text></Text>}
          placeholder="2026-w15"
          description="ISO-8601 format recommended"
          value={weekId}
          onChange={(e) => setWeekId(e.currentTarget.value)}
          required
        />
        <TextInput
          label={<Text fw={700} size="sm">Display Label</Text>}
          description="Used for selection dropdowns"
          value={displayLabel}
          readOnly
          variant="filled"
          styles={{ input: { backgroundColor: 'var(--mantine-color-gray-0)' } }}
        />
        <Select
          label={<Text fw={700} size="sm">Copy schedule from... (Optional)</Text>}
          placeholder="Start Blank"
          data={[
            { value: 'blank', label: 'Start Blank' },
            ...availableWeeks.map(w => ({ value: w, label: generateWeekLabel(w) }))
          ]}
          value={copyFrom}
          onChange={setCopyFrom}
          clearable
        />
        <Group justify="flex-end" mt="xl">
          <Button variant="subtle" onClick={onClose} color="gray">Cancel</Button>
          <Button onClick={handleSubmit} color="blue" disabled={!weekId}>Generate Plan</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// --- Main Component ---

export function EquipmentManagement() {
  const [schedules, setSchedules] = useState<MachineSchedule[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  
  const [processes, setProcesses] = useState<string[]>([]);
  const [activeWeeks, setActiveWeeks] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEquipModalOpen, setIsEquipModalOpen] = useState(false);

  const [connectionString, setConnectionString] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const autoSaveTimeoutsRef = useRef<Record<string, any>>({});

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      Object.keys(autoSaveTimeoutsRef.current).forEach(key => {
        clearTimeout(autoSaveTimeoutsRef.current[key]);
      });
    };
  }, []);

  // Load connection string from store on mount
  useEffect(() => {
    async function loadConnStr() {
      try {
        const store = await load('store.json', { autoSave: false, defaults: {} });
        const val = await store.get<string>('db_connection_string');
        if (val) setConnectionString(val);
      } catch (err) {
        console.error('Failed to load DB connection string:', err);
      }
    }
    loadConnStr();
  }, []);

  // Fetch processes and weeks on mount (once connection string is available)
  useEffect(() => {
    if (!connectionString) return;

    const fetchConfig = async () => {
      try {
        const [procList, weekList] = await Promise.all([
          invoke<string[]>('get_processes', { connectionString }),
          invoke<string[]>('get_active_weeks', { connectionString }),
        ]);
        
        setProcesses(procList);
        setActiveWeeks(weekList);

        // Set defaults if current values are placeholder or not in the lists
        if (procList.length > 0 && !activeTab) {
          setActiveTab(procList[0]);
        }
        if (weekList.length > 0 && !selectedWeek) {
          setSelectedWeek(weekList[0]);
        }
      } catch (err) {
        console.error('Failed to fetch initial config:', err);
      }
    };

    fetchConfig();
  }, [connectionString]);

  const shiftSettings = useScorecardStore(state => state.shiftSettings);

  const weekDates = useMemo(() => {
    if (!selectedWeek) return [];
    try {
      return getWeekDates(selectedWeek);
    } catch (e) {
      return [];
    }
  }, [selectedWeek]);

  // Fetch and transform data
  const fetchData = useCallback(async () => {
    if (!connectionString || !activeTab || !selectedWeek) return;

    setIsLoading(true);
    setFetchError(null);

    try {
      const rows = await invoke<ProcessInfoRow[]>('get_process_info', {
        connectionString,
        process: activeTab,
        weekIdentifier: selectedWeek,
      });

      const transformed = transformProcessData(rows);
      setSchedules(transformed);
    } catch (err: any) {
      console.error('Failed to fetch process info:', err);
      setFetchError(typeof err === 'string' ? err : 'Database connection error');
    } finally {
      setIsLoading(false);
    }
  }, [connectionString, activeTab, selectedWeek]);

  // Trigger fetch on tab/week change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleMachine = (id: string) => {
    const next = new Set(expandedMachines);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedMachines(next);
  };

  const handleUpdateShiftHour = (
    machineId: string,
    shift: 'A' | 'B' | 'C' | 'D',
    day: DayOfWeek,
    value: number | null
  ) => {
    // 1. Optimistic Update (UI updates immediately)
    setSchedules((prev) =>
      prev.map((m) => {
        if (m.id !== machineId) return m;
        return {
          ...m,
          shifts: m.shifts.map((s) => {
            if (s.shift !== shift) return s;
            return {
              ...s,
              dailyHours: { ...s.dailyHours, [day]: value },
            };
          }),
        };
      })
    );

    // 2. Debounced Save to DB
    if (!connectionString || !activeTab || !selectedWeek) return;

    const cellKey = `${machineId}-${shift}-${day}`;
    if (autoSaveTimeoutsRef.current[cellKey]) {
      clearTimeout(autoSaveTimeoutsRef.current[cellKey]);
    }

    autoSaveTimeoutsRef.current[cellKey] = setTimeout(async () => {
      try {
        const dayIdx = DAYS_OF_WEEK.indexOf(day);
        const date = weekDates[dayIdx];
        if (!date) return;

        const record: ProcessInfoRow = {
          process: activeTab,
          date: formatSqlDate(date),
          hoursAvailable: value || 0,
          machineId,
          shift,
          weekIdentifier: selectedWeek,
        };

        await invoke('upsert_process_info', {
          connectionString,
          records: [record],
        });

        console.log(`Auto-saved capacity for ${machineId} on ${day}`);
        delete autoSaveTimeoutsRef.current[cellKey];
      } catch (err) {
        console.error('Auto-save failed:', err);
        setFetchError('Failed to auto-save change to database');
      }
    }, 750);
  };

  const handleAddEquipment = async (machineId: string) => {
    if (!connectionString || !activeTab || !selectedWeek) return;

    try {
      const dates = getWeekDates(selectedWeek);
      const newRows: ProcessInfoRow[] = [];

      dates.forEach((date) => {
        (['A', 'B', 'C', 'D'] as const).forEach((shift) => {
          newRows.push({
            process: activeTab!,
            date: formatSqlDate(date),
            hoursAvailable: 0,
            machineId,
            shift,
            weekIdentifier: selectedWeek!,
          });
        });
      });

      await invoke('upsert_process_info', {
        connectionString,
        records: newRows,
      });

      fetchData();
    } catch (err) {
      console.error('Failed to add equipment:', err);
    }
  };

  const handleGeneratePlan = async (data: { weekId: string; displayLabel: string; copyFrom: string | null }) => {
    if (!connectionString || !activeTab) return;

    try {
      if (data.copyFrom && data.copyFrom !== 'blank') {
        // Fetch source week data
        const sourceRows = await invoke<ProcessInfoRow[]>('get_process_info', {
          connectionString,
          process: activeTab,
          weekIdentifier: data.copyFrom,
        });

        if (sourceRows.length > 0) {
          // Calculate date offset
          const sourceDates = getWeekDates(data.copyFrom);
          const targetDates = getWeekDates(data.weekId);
          const timeDiff = targetDates[0].getTime() - sourceDates[0].getTime();
          const dayOffset = Math.round(timeDiff / (1000 * 60 * 60 * 24));

          const newRows = sourceRows.map(row => {
            const dateObj = parseISOLocal(row.date);
            dateObj.setDate(dateObj.getDate() + dayOffset);
            return {
              ...row,
              date: formatSqlDate(dateObj),
              weekIdentifier: data.weekId,
            };
          });

          await invoke('upsert_process_info', {
            connectionString,
            records: newRows,
          });
        }
      }

      // Refresh weeks and select the new one
      const weekList = await invoke<string[]>('get_active_weeks', { connectionString });
      setActiveWeeks(weekList);
      setSelectedWeek(data.weekId);
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to generate plan:', err);
    }
  };

  const dailyUtilization = useMemo(() => {
    const stats: Record<DayOfWeek, { scheduled: number; available: number }> = {} as any;
    
    DAYS_OF_WEEK.forEach((day) => {
      stats[day] = { scheduled: 0, available: 0 };
    });

    schedules.forEach((m) => {
      DAYS_OF_WEEK.forEach((day) => {
        stats[day].available += m.baseAvailableHours;
        stats[day].scheduled += m.shifts.reduce((sum: number, s) => sum + (s.dailyHours[day] || 0), 0);
      });
    });

    return stats;
  }, [schedules]);

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={2}>Equipment Management</Title>
        <Group>
          <Button 
            variant="light" 
            leftSection={<IconDatabase size={16} />} 
            onClick={fetchData}
            loading={isLoading}
          >
            Sync from DB
          </Button>
          <Button 
            variant="light" 
            leftSection={<IconPlus size={16} />}
            onClick={() => setIsEquipModalOpen(true)}
            disabled={!activeTab || !selectedWeek}
          >
            Add Equipment
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="sm" radius="md" className="bg-gray-50/30">
        <Group justify="space-between">
          <Tabs value={activeTab} onChange={setActiveTab} variant="pills">
            <Tabs.List>
              {processes.map((proc) => (
                <Tabs.Tab key={proc} value={proc}>{proc}</Tabs.Tab>
              ))}
              {processes.length === 0 && <Tabs.Tab value="none" disabled>No Processes Found</Tabs.Tab>}
            </Tabs.List>
          </Tabs>

          <Group>
            <Select
              placeholder="Select Week"
              data={activeWeeks.map((w) => ({ value: w, label: generateWeekLabel(w) }))}
              value={selectedWeek}
              onChange={setSelectedWeek}
              size="sm"
              w={260}
            />
            <Button 
              variant="outline" 
              size="sm" 
              leftSection={<IconCalendarPlus size={16} />}
              onClick={() => setIsModalOpen(true)}
            >
              Add New Week
            </Button>
          </Group>
        </Group>
      </Paper>

      {fetchError && (
        <Alert variant="light" color="red" title="Data Load Error" icon={<IconAlertCircle size={18} />}>
          {fetchError}. Verify your database connection settings.
        </Alert>
      )}

      <Box className="border-t border-gray-200" style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--mantine-color-gray-3)', position: 'relative' }}>
        {isLoading && (
          <Box style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.6)', zIndex: 20 }}>
            <Center h="100%">
              <Loader size="xl" type="dots" />
            </Center>
          </Box>
        )}
        
        <Table verticalSpacing="xs" highlightOnHover withTableBorder>
          <Table.Thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
            <Table.Tr>
              <Table.Th w={200}><Text size="xs" fw={700} c="dimmed">MACHINE ID</Text></Table.Th>
              <Table.Th ta="center" w={100}><Text size="xs" fw={700} c="dimmed">SCHEDULE</Text></Table.Th>
              {DAYS_OF_WEEK.map((day, idx) => {
                const dateStr = weekDates[idx] ? weekDates[idx].toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '';
                return (
                  <Table.Th key={day} ta="center" w={85}>
                    <Stack gap={0} align="center">
                      <Text size="xs" fw={700} c="dimmed">{day.toUpperCase()}</Text>
                      {dateStr && <Text size="10px" c="blue.4" fw={700}>{dateStr}</Text>}
                    </Stack>
                  </Table.Th>
                );
              })}
              <Table.Th ta="center" w={100} className="bg-gray-100">
                <Group gap={4} justify="center">
                  <IconCalculator size={14} />
                  <Text size="xs" fw={700}>TOTAL</Text>
                </Group>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {schedules.map((m) => (
              <MachineRow
                key={m.id}
                schedule={m}
                isExpanded={expandedMachines.has(m.id)}
                onToggle={() => toggleMachine(m.id)}
                onUpdateShiftHour={(shift, day, val) => handleUpdateShiftHour(m.id, shift, day, val)}
                weekDates={weekDates}
                shiftSettings={shiftSettings}
              />
            ))}
            {!isLoading && schedules.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={10} py="xl">
                  <Center h={100}>
                    <Stack gap="xs" align="center">
                      <IconAlertCircle size={32} color="var(--mantine-color-gray-4)" />
                      <Text ta="center" c="dimmed" size="sm">No schedules found for this process and week.</Text>
                    </Stack>
                  </Center>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>

          <Table.Tfoot className="bg-gray-50 sticky bottom-0 z-10 shadow-sm border-t-2">
            <Table.Tr>
              <Table.Td colSpan={2}>
                <Text size="xs" fw={800} c="dimmed" ta="right" pr="md">DAILY CAPACITY UTILIZATION</Text>
              </Table.Td>
              {DAYS_OF_WEEK.map((day) => {
                const { scheduled, available } = dailyUtilization[day];
                const utilization = available > 0 ? (scheduled / available) * 100 : 0;
                let color = "teal";
                if (utilization > 100) color = "red";
                else if (utilization >= 80) color = "yellow";

                return (
                  <Table.Td key={day} p="xs">
                    <HoverCard width={220} shadow="md" position="top" withArrow withinPortal>
                      <HoverCard.Target>
                        <Stack gap={4} align="center" className="cursor-help">
                          <Progress
                            value={Math.min(utilization, 100)}
                            color={color}
                            size="md"
                            radius="xl"
                            w="100%"
                          />
                          <Text size="10px" fw={700} c="dimmed">
                            {scheduled}h / {available}h
                          </Text>
                        </Stack>
                      </HoverCard.Target>
                      <HoverCard.Dropdown p="sm">
                        <Stack gap="xs">
                          <Text size="sm" fw={700} className="border-b pb-1">Capacity: {day}</Text>
                          <Group justify="space-between">
                            <Text size="xs" c="dimmed">Scheduled:</Text>
                            <Text size="xs" fw={600}>{scheduled}h</Text>
                          </Group>
                          <Group justify="space-between">
                            <Text size="xs" c="dimmed">Available:</Text>
                            <Text size="xs" fw={600}>{available}h</Text>
                          </Group>
                          <Divider />
                          <Group justify="space-between">
                            <Text size="xs" fw={700}>Utilization:</Text>
                            <Text size="xs" fw={800} style={{ color: `var(--mantine-color-${color}-filled)` }}>{utilization.toFixed(1)}%</Text>
                          </Group>
                        </Stack>
                      </HoverCard.Dropdown>
                    </HoverCard>
                  </Table.Td>
                );
              })}
              <Table.Td className="bg-gray-100"></Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Box>
      <AddWorkWeekModal 
        opened={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onGenerate={handleGeneratePlan}
        availableWeeks={activeWeeks}
      />
      <AddEquipmentModal 
        opened={isEquipModalOpen} 
        onClose={() => setIsEquipModalOpen(false)} 
        onAdd={handleAddEquipment}
        activeProcess={activeTab}
      />
    </Stack>
  );
}

export default EquipmentManagement;
