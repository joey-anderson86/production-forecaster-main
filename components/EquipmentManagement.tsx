'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
  Divider,
  Loader,
  Center,
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
import { DayOfWeek, DAYS_OF_WEEK, getDayOfWeekLabel, parseISOLocal } from '@/lib/dateUtils';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';

// --- TypeScript Interfaces ---

/** Raw database row from dbo.ProcessInfo */
export interface ProcessInfoRow {
  process: string;
  date: string; // YYYY-MM-DD
  hoursAvailable: number;
  machineId: string;
  shift: 'A' | 'B' | 'C' | 'D';
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
}: {
  allocation: ShiftAllocation;
  onUpdateHour: (day: DayOfWeek, value: number | null) => void;
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
      {DAYS_OF_WEEK.map((day) => (
        <Table.Td key={day} p={2} style={{ borderLeft: '1px solid var(--mantine-color-gray-2)' }}>
          <NumberInput
            value={allocation.dailyHours[day] ?? ''}
            onChange={(val) => onUpdateHour(day, typeof val === 'number' ? val : null)}
            hideControls
            variant="unstyled"
            min={0}
            max={24}
            placeholder="-"
            className="text-center"
            styles={{
              input: {
                textAlign: 'center',
                height: 32,
                fontSize: '12px',
                fontWeight: 500,
                '&:focus': {
                  backgroundColor: 'white',
                  boxShadow: 'inset 0 0 0 1px var(--mantine-color-blue-2)',
                },
              },
            }}
          />
        </Table.Td>
      ))}
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
}: {
  schedule: MachineSchedule;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateShiftHour: (shift: 'A' | 'B' | 'C' | 'D', day: DayOfWeek, value: number | null) => void;
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
          />
        ))}
    </>
  );
};

// --- Main Component ---

export function EquipmentManagement() {
  const [schedules, setSchedules] = useState<MachineSchedule[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>('Machining');
  const [expandedMachines, setExpandedMachines] = useState<Set<string>>(new Set());
  const [selectedWeek, setSelectedWeek] = useState<string | null>('2026-w15');
  
  const [connectionString, setConnectionString] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

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
          <Button leftSection={<IconPlus size={16} />}>
            Add Equipment
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="sm" radius="md" className="bg-gray-50/30">
        <Group justify="space-between">
          <Tabs value={activeTab} onChange={setActiveTab} variant="pills">
            <Tabs.List>
              <Tabs.Tab value="Machining">Machining</Tabs.Tab>
              <Tabs.Tab value="Molding">Molding</Tabs.Tab>
              <Tabs.Tab value="Assembly">Assembly</Tabs.Tab>
              <Tabs.Tab value="Stamping">Stamping</Tabs.Tab>
            </Tabs.List>
          </Tabs>

          <Group>
            <Select
              placeholder="Select Week"
              data={[
                { value: '2026-w14', label: 'Week 14 (3/30 - 4/5)' },
                { value: '2026-w15', label: 'Week 15 (4/6 - 4/12)' },
                { value: '2026-w16', label: 'Week 16 (4/13 - 4/19)' },
                { value: 'Wk14', label: 'Wk14' } // Support user-mentioned format if needed
              ]}
              value={selectedWeek}
              onChange={setSelectedWeek}
              size="sm"
              w={220}
            />
            <Button variant="outline" size="sm" leftSection={<IconCalendarPlus size={16} />}>
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
              {DAYS_OF_WEEK.map((day) => (
                <Table.Th key={day} ta="center" w={80}>
                  <Text size="xs" fw={700} c="dimmed">{day.toUpperCase()}</Text>
                </Table.Th>
              ))}
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
    </Stack>
  );
}

export default EquipmentManagement;
