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
  IconChevronsDown,
  IconChevronsUp,
  IconCalendarOff,
  IconDatabaseX,
  IconTrash,
  IconBolt
} from '@tabler/icons-react';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useGlobalWeek } from './WeekContext';
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
import { useProcessStore } from '@/lib/processStore';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { useAvailableMachines } from '@/hooks/useAvailableMachines';

// --- TypeScript Interfaces ---

/** Raw database row from dbo.ProcessInfo */
export interface ProcessInfoRow {
  ProcessName: string;
  Date: string; // YYYY-MM-DD
  HoursAvailable: number;
  MachineID: string;
  Shift: 'A' | 'B' | 'C' | 'D';
  WeekIdentifier: string;
}

export interface ShiftAllocation {
  shift: 'A' | 'B' | 'C' | 'D';
  dailyHours: Record<DayOfWeek, number | null>;
}

export interface MachineSchedule {
  MachineID: string;
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
    if (!machineMap.has(row.MachineID)) {
      machineMap.set(row.MachineID, {
        MachineID: row.MachineID,
        process: row.ProcessName,
        baseAvailableHours: 24, // Default baseline, can be customized
        shifts: (['A', 'B', 'C', 'D'] as const).map((s) => ({
          shift: s,
          dailyHours: { Mon: null, Tue: null, Wed: null, Thu: null, Fri: null, Sat: null, Sun: null },
        })),
      });
    }

    const machine = machineMap.get(row.MachineID)!;
    const shiftAlloc = machine.shifts.find((s) => s.shift === row.Shift);

    if (shiftAlloc) {
      const dateObj = parseISOLocal(row.Date);
      const dayLabel = getDayOfWeekLabel(dateObj);
      shiftAlloc.dailyHours[dayLabel] = row.HoursAvailable;
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
    <Table.Tr style={{ backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))' }}>
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
              borderLeft: '1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))',
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
                        backgroundColor: 'light-dark(white, var(--mantine-color-dark-7))',
                        boxShadow: 'inset 0 0 0 1px var(--mantine-color-blue-4)',
                      },
                    },
                  }}
                />
              </Box>
            </Tooltip>
          </Table.Td>
        );
      })}
      <Table.Td style={{
        backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-7))',
        borderLeft: '2px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))'
      }}>
        <Text fw={700} ta="center" size="xs" c={rowTotal > 0 ? 'blue.7' : 'dimmed'}>
          {rowTotal.toFixed(1)}h
        </Text>
      </Table.Td>
      <Table.Td style={{ width: 50 }} />
    </Table.Tr>
  );
};

// --- Sub-Component: Machine Row (Parent) ---

const MachineRow = ({
  schedule,
  isExpanded,
  onToggle,
  onUpdateShiftHour,
  onDelete,
  weekDates,
  shiftSettings,
}: {
  schedule: MachineSchedule;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateShiftHour: (shift: 'A' | 'B' | 'C' | 'D', day: DayOfWeek, value: number | null) => void;
  onDelete: (MachineID: string) => void;
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
        style={{
          backgroundColor: isExpanded
            ? 'light-dark(var(--mantine-color-blue-0), rgba(24, 100, 171, 0.15))'
            : 'transparent',
          cursor: 'pointer',
          transition: 'background-color 150ms ease'
        }}
      >
        <Table.Td>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon variant="subtle" size="sm" color="blue">
              {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </ActionIcon>
            <Stack gap={0}>
              <Text fw={700} size="sm">
                {schedule.MachineID}
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
          <Table.Td key={i} ta="center" style={{ borderLeft: '1px solid light-dark(var(--mantine-color-blue-1), var(--mantine-color-dark-4))' }}>
            <Text fw={700} size="xs" c={total > 0 ? 'blue.9' : 'dimmed'}>
              {total > 0 ? `${total.toFixed(1)}h` : '—'}
            </Text>
          </Table.Td>
        ))}
        <Table.Td style={{
          backgroundColor: 'light-dark(var(--mantine-color-blue-1), rgba(24, 100, 171, 0.2))',
          borderLeft: '2px solid light-dark(var(--mantine-color-blue-2), var(--mantine-color-dark-4))'
        }}>
          <Text fw={800} ta="center" size="sm" c="blue.9">
            {weeklyTotal.toFixed(1)}h
          </Text>
        </Table.Td>
        <Table.Td style={{ width: 50 }}>
          <Group justify="center" wrap="nowrap">
            <Tooltip label="Remove Equipment" position="left" withArrow>
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(schedule.MachineID);
                }}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
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
  machines,
  isLoading,
  isError,
}: {
  opened: boolean;
  onClose: () => void;
  onAdd: (MachineID: string) => void;
  machines: any[];
  isLoading: boolean;
  isError: string | null;
}) {
  const [MachineID, setMachineID] = useState<string | null>(null);

  const handleSubmit = () => {
    if (MachineID) {
      onAdd(MachineID);
      setMachineID(null);
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
          value={MachineID}
          onChange={setMachineID}
          searchable
          required
          disabled={isLoading}
          rightSection={isLoading ? <Loader size="xs" /> : null}
          nothingFoundMessage={isError ? `Error: ${isError}` : "No machines found for this process"}
          error={isError}
        />
        <Group justify="flex-end" mt="xl">
          <Button variant="subtle" onClick={onClose} color="gray">Cancel</Button>
          <Button onClick={handleSubmit} color="blue" disabled={!MachineID || isLoading}>Add Machine</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// --- Sub-Component: Auto-Schedule Modal ---

function AutoScheduleModal({
  opened,
  onClose,
  onConfirm,
  machineCount,
  processName
}: {
  opened: boolean;
  onClose: () => void;
  onConfirm: (utilization: number, baseHours: number) => void;
  machineCount: number;
  processName: string | null;
}) {
  const [utilization, setUtilization] = useState<number | string>(85);
  const [baseHours, setBaseHours] = useState<number | string>(8);

  const handleSubmit = () => {
    if (typeof utilization === 'number' && typeof baseHours === 'number') {
      onConfirm(utilization, baseHours);
      onClose();
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={900} size="xl">Auto-Schedule Process</Text>} radius="md">
      <Stack gap="md">
        <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
          This will schedule <strong>{machineCount}</strong> machines for <strong>{processName}</strong>. 
          It respects your Panama shift schedule (OFF days will be set to 0 hours). Existing entries for this week will be overwritten.
        </Alert>

        <Group grow>
          <NumberInput
            label={<Text fw={700} size="sm">Base Shift Hours</Text>}
            description="Max hours per shift"
            value={baseHours}
            onChange={setBaseHours}
            min={1}
            max={24}
            required
          />
          <NumberInput
            label={<Text fw={700} size="sm">Target Utilization (%)</Text>}
            description="OEE / Uptime target"
            value={utilization}
            onChange={setUtilization}
            min={1}
            max={100}
            required
            rightSection={<Text size="sm" c="dimmed">%</Text>}
          />
        </Group>

        <Group justify="flex-end" mt="xl">
          <Button variant="subtle" onClick={onClose} color="gray">Cancel</Button>
          <Button 
            onClick={handleSubmit} 
            color="indigo" 
            disabled={!utilization || !baseHours || machineCount === 0}
            leftSection={<IconCalculator size={16} />}
          >
            Generate Schedule
          </Button>
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
          styles={{ input: { backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))' } }}
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
  const { processes, activeProcess: activeTab, setActiveProcess: setActiveTab, fetchProcesses } = useProcessStore();
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());
  const { selectedWeekId: selectedWeek, setSelectedWeekId: setSelectedWeek } = useGlobalWeek();

  const [activeWeeks, setActiveWeeks] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEquipModalOpen, setIsEquipModalOpen] = useState(false);
  const [isAutoScheduleModalOpen, setIsAutoScheduleModalOpen] = useState(false);

  const { machines, isLoading: isMachinesLoading, isError: machinesError } = useAvailableMachines(activeTab);

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

  // Fetch initial config on mount
  useEffect(() => {
    if (!connectionString) return;

    const fetchConfig = async () => {
      try {
        // Fetch processes into global store if empty
        if (processes.length === 0) {
          await fetchProcesses(connectionString);
        }

        // Fetch active weeks locally (or consider globalizing if needed)
        const weekList = await invoke<string[]>('get_active_weeks', { connectionString });
        setActiveWeeks(weekList);

        // Set default week if none selected
        if (weekList.length > 0 && !selectedWeek) {
          setSelectedWeek(weekList[0]);
        }
      } catch (err) {
        console.error('Failed to fetch initial config:', err);
      }
    };

    fetchConfig();
  }, [connectionString, processes.length, fetchProcesses, selectedWeek, setSelectedWeek]);

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

  const handleExpandAll = () => {
    setExpandedMachines(new Set(schedules.map(m => m.MachineID)));
  };

  const handleCollapseAll = () => {
    setExpandedMachines(new Set());
  };

  const handleUpdateShiftHour = (
    MachineID: string,
    shift: 'A' | 'B' | 'C' | 'D',
    day: DayOfWeek,
    value: number | null
  ) => {
    // 1. Optimistic Update (UI updates immediately)
    setSchedules((prev) =>
      prev.map((m) => {
        if (m.MachineID !== MachineID) return m;
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

    const cellKey = `${MachineID}-${shift}-${day}`;
    if (autoSaveTimeoutsRef.current[cellKey]) {
      clearTimeout(autoSaveTimeoutsRef.current[cellKey]);
    }

    autoSaveTimeoutsRef.current[cellKey] = setTimeout(async () => {
      try {
        const dayIdx = DAYS_OF_WEEK.indexOf(day);
        const date = weekDates[dayIdx];
        if (!date) return;

        const record = {
          ProcessName: activeTab,
          Date: formatSqlDate(date),
          HoursAvailable: value || 0,
          MachineID: MachineID,
          Shift: shift,
          WeekIdentifier: selectedWeek,
        };

        await invoke('upsert_process_info', {
          connectionString,
          records: [record],
        });

        console.log(`Auto-saved capacity for ${MachineID} on ${day}`);
        delete autoSaveTimeoutsRef.current[cellKey];
      } catch (err) {
        console.error('Auto-save failed:', err);
        setFetchError('Failed to auto-save change to database');
      }
    }, 750);
  };

  const handleAddEquipment = async (MachineID: string) => {
    if (!connectionString || !activeTab || !selectedWeek) return;

    try {
      const dates = getWeekDates(selectedWeek);
      const newRows: ProcessInfoRow[] = [];

      dates.forEach((date) => {
        (['A', 'B', 'C', 'D'] as const).forEach((shift) => {
          newRows.push({
            ProcessName: activeTab!,
            Date: formatSqlDate(date),
            HoursAvailable: 0,
            MachineID: MachineID,
            Shift: shift,
            WeekIdentifier: selectedWeek!,
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

  const handleDeleteEquipment = (MachineID: string) => {
    modals.openConfirmModal({
      title: <Text fw={700}>Remove Equipment</Text>,
      children: (
        <Text size="sm">
          Are you sure you want to remove <strong>{MachineID}</strong> and all its scheduled hours for this week? This action cannot be undone.
        </Text>
      ),
      labels: { confirm: 'Remove Equipment', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        if (!connectionString || !activeTab || !selectedWeek) return;

        try {
          const dates = getWeekDates(selectedWeek);
          const identifiers: any[] = [];
          dates.forEach(date => {
            (['A', 'B', 'C', 'D'] as const).forEach(shift => {
              identifiers.push({
                ProcessName: activeTab,
                Date: formatSqlDate(date),
                MachineID: MachineID,
                Shift: shift
              });
            });
          });

          await invoke('delete_process_infos', {
            connectionString,
            identifiers
          });

          // Optimistic update
          setSchedules(prev => prev.filter(m => m.MachineID !== MachineID));

          notifications.show({
            title: 'Equipment Removed',
            message: `Successfully removed ${MachineID} and all associated shifts.`,
            color: 'green'
          });
        } catch (err) {
          console.error('Failed to delete equipment:', err);
          notifications.show({
            title: 'Deletion Failed',
            message: 'An error occurred while trying to remove the equipment from the database.',
            color: 'red'
          });
        }
      }
    });
  };

  const handleAutoSchedule = async (utilizationRate: number, baseShiftHours: number) => {
    if (!connectionString || !activeTab || !selectedWeek || !machines.length) return;

    try {
      setIsLoading(true);
      const newRows: ProcessInfoRow[] = [];
      const dates = getWeekDates(selectedWeek);
      const targetHours = baseShiftHours * (utilizationRate / 100);

      const machineIds = machines.map((m: any) => typeof m === 'string' ? m : m.value);

      machineIds.forEach((machineId) => {
        dates.forEach((date) => {
          (['A', 'B', 'C', 'D'] as const).forEach((shift) => {
            const isWorking = isWorkingDay(date, shiftSettings[shift] || '');
            
            newRows.push({
              ProcessName: activeTab,
              Date: formatSqlDate(date),
              HoursAvailable: isWorking ? Number(targetHours.toFixed(1)) : 0,
              MachineID: machineId,
              Shift: shift,
              WeekIdentifier: selectedWeek,
            });
          });
        });
      });

      await invoke('upsert_process_info', {
        connectionString,
        records: newRows,
      });

      await fetchData(); 
      notifications.show({
        title: 'Auto-Schedule Complete',
        message: `Successfully overwrote schedule for ${machineIds.length} machines.`,
        color: 'green'
      });
    } catch (err) {
      console.error('Failed to auto-schedule:', err);
      notifications.show({ title: 'Error', message: 'Failed to generate schedule.', color: 'red' });
    } finally {
      setIsLoading(false);
      setIsAutoScheduleModalOpen(false);
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
            const dateObj = parseISOLocal(row.Date);
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
    <Stack gap="md">
      <Group justify="space-between">
        <Group>
          <Group gap={4}>
            <Tooltip label="Expand All Rows" withArrow position="bottom">
              <ActionIcon variant="subtle" color="blue" size="md" onClick={handleExpandAll}>
                <IconChevronsDown size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Collapse All Rows" withArrow position="bottom">
              <ActionIcon variant="subtle" color="blue" size="md" onClick={handleCollapseAll}>
                <IconChevronsUp size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
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
          <Button
            variant="light"
            color="indigo"
            leftSection={<IconBolt size={16} />}
            onClick={() => setIsAutoScheduleModalOpen(true)}
            disabled={!activeTab || !selectedWeek || isLoading}
          >
            Auto-Schedule
          </Button>
        </Group>
      </Group>

      <Box>
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
              data={[
                ...activeWeeks.map((w) => ({ value: w, label: generateWeekLabel(w) })),
                ...(selectedWeek && !activeWeeks.includes(selectedWeek) ? [{ value: selectedWeek, label: generateWeekLabel(selectedWeek) }] : [])
              ]}
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
      </Box>

      {fetchError && (
        <Alert variant="light" color="red" title="Data Load Error" icon={<IconAlertCircle size={18} />}>
          {fetchError}. Verify your database connection settings.
        </Alert>
      )}

      <Box style={{
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
        position: 'relative'
      }}>
        {isLoading && (
          <Box style={{ position: 'absolute', inset: 0, backgroundColor: 'light-dark(rgba(255,255,255,0.6), rgba(0,0,0,0.4))', zIndex: 20 }}>
            <Center h="100%">
              <Loader size="xl" type="dots" />
            </Center>
          </Box>
        )}

        {selectedWeek ? (
          <Table verticalSpacing="xs" highlightOnHover withTableBorder>
            <Table.Thead
              style={{
                backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                boxShadow: 'var(--mantine-shadow-sm)'
              }}
            >
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
                <Table.Th ta="center" w={100} style={{ backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-8))' }}>
                  <Group gap={4} justify="center">
                    <IconCalculator size={14} />
                    <Text size="xs" fw={700}>TOTAL</Text>
                  </Group>
                </Table.Th>
                <Table.Th key="actions" w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>

            <Table.Tbody>
              {schedules.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={10} py="xl">
                    <Center>
                      <Stack align="center" gap="xs">
                        <IconDatabaseX size={32} color="var(--mantine-color-gray-4)" />
                        <Text c="dimmed" size="sm">No data available for {generateWeekLabel(selectedWeek)}.</Text>
                      </Stack>
                    </Center>
                  </Table.Td>
                </Table.Tr>
              ) : (
                schedules.map((m) => (
                  <MachineRow
                    key={m.MachineID}
                    schedule={m}
                    isExpanded={expandedMachines.has(m.MachineID)}
                    onToggle={() => toggleMachine(m.MachineID)}
                    onUpdateShiftHour={(shift, day, val) => handleUpdateShiftHour(m.MachineID, shift, day, val)}
                    onDelete={handleDeleteEquipment}
                    weekDates={weekDates}
                    shiftSettings={shiftSettings}
                  />
                ))
              )}
            </Table.Tbody>

            <Table.Tfoot
              style={{
                backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))',
                position: 'sticky',
                bottom: 0,
                zIndex: 10,
                boxShadow: '0 -1px 2px rgba(0,0,0,0.05)',
                borderTop: '2px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))'
              }}
            >
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
                              {scheduled.toFixed(1)}h / {available.toFixed(1)}h
                            </Text>
                          </Stack>
                        </HoverCard.Target>
                        <HoverCard.Dropdown p="sm">
                          <Stack gap="xs">
                            <Text size="sm" fw={700} className="border-b pb-1">Capacity: {day}</Text>
                            <Group justify="space-between">
                              <Text size="xs" c="dimmed">Scheduled:</Text>
                              <Text size="xs" fw={600}>{scheduled.toFixed(1)}h</Text>
                            </Group>
                            <Group justify="space-between">
                              <Text size="xs" c="dimmed">Available:</Text>
                              <Text size="xs" fw={600}>{available.toFixed(1)}h</Text>
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
                <Table.Td style={{ backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-8))' }}></Table.Td>
                <Table.Td style={{ width: 50, backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-8))' }}></Table.Td>
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
                <IconCalendarOff size={48} stroke={1.5} color="var(--mantine-color-blue-4)" />
              </Box>
              <Stack gap={4} align="center">
                <Text fw={700} size="lg">No Week Selected</Text>
                <Text c="dimmed" size="sm" ta="center" maw={400}>
                  Please select a week to manage equipment capacity.
                </Text>
              </Stack>
            </Stack>
          </Center>
        )}
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
        machines={machines}
        isLoading={isMachinesLoading}
        isError={machinesError}
      />
      <AutoScheduleModal
        opened={isAutoScheduleModalOpen}
        onClose={() => setIsAutoScheduleModalOpen(false)}
        onConfirm={handleAutoSchedule}
        processName={activeTab}
        machineCount={machines.length}
      />
    </Stack>
  );
}

export default EquipmentManagement;
