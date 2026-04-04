'use client';

import React, { useState } from 'react';
import { useScorecardStore, DayOfWeek, DailyScorecardRecord, PartScorecard } from '@/lib/scorecardStore';
import { 
  Tabs, Select, Table, Card, Text, Group, Badge, Title, Box, Tooltip, Stack, Button, ActionIcon
} from '@mantine/core';
import { 
  IconFlask, IconBox, IconShip, IconClipboardCheck, IconPlus, 
  IconChevronDown, IconChevronRight 
} from '@tabler/icons-react';
import { EditEntryModal } from './EditEntryModal';
import { ShiftProductionEntryModal } from './ShiftProductionEntryModal';
import { DeliveryLossPareto } from './DeliveryLossPareto';
import { getTodayNumeric, getWeekDates } from '@/lib/dateUtils';
import { useProcessStore } from '@/lib/processStore';

const PROCESS_ICONS: Record<string, React.ReactNode> = {
  'Plating': <IconFlask size={20} />,
  'VPA': <IconClipboardCheck size={20} />,
  'EBPVD': <IconBox size={20} />,
  'Shipping': <IconShip size={20} />
};

const getProcessIcon = (name: string) => PROCESS_ICONS[name] || <IconBox size={20} />;

const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  const processes = useProcessStore(state => state.processes);
  const store = useScorecardStore();
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());

  const toggleExpand = (partNumber: string) => {
    setExpandedParts(prev => {
      const next = new Set(prev);
      if (next.has(partNumber)) next.delete(partNumber);
      else next.add(partNumber);
      return next;
    });
  };

  // Edit Modal State
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editingEntry, setEditingEntry] = useState<{
    partNumber: string;
    shift: string;
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

  // Default to first week if available and no week is selected
  React.useEffect(() => {
    if (activeDepartment) {
      const weekIds = Object.keys(activeDepartment.weeks);
      if (weekIds.length > 0 && (!selectedWeekId || !weekIds.includes(selectedWeekId))) {
        setSelectedWeekId(weekIds[0]);
      } else if (weekIds.length === 0) {
        setSelectedWeekId(null);
      }
    } else {
      setSelectedWeekId(null);
    }
  }, [activeDepartment, selectedWeekId]);

  const activeWeek = activeDepartment && selectedWeekId ? activeDepartment.weeks[selectedWeekId] : null;

  const getCellStyles = (actual: number | null, target: number | null) => {
    if (actual === null || target === null) return {};
    if (actual >= target) {
      return { bg: 'green.0', color: 'green.8', fw: 700 };
    }
    return { bg: 'red.0', color: 'red.8', fw: 700 };
  };

  const activeDeptIcon = activeTab ? getProcessIcon(activeTab) : <IconBox size={20} />;

  const handleCellClick = (partNumber: string, shift: string, dayOfWeek: DayOfWeek, record: DailyScorecardRecord) => {
    setEditingEntry({ partNumber, shift, dayOfWeek, record });
    setEditModalOpened(true);
  };

  // Grouped data transformation
  const groupedParts = React.useMemo(() => {
     if (!activeWeek) return [];

     const todayNumeric = getTodayNumeric();
     const groups: Record<string, GroupedPartScorecard> = {};

     activeWeek.parts.forEach(part => {
        // Calculate child rolling gap
        let childRollingGap = 0;
        part.dailyRecords.forEach(record => {
           if (record.date) {
              const dateNumeric = parseInt(record.date.replace(/-/g, ''));
              if (dateNumeric <= todayNumeric) {
                 childRollingGap += ((record.actual ?? 0) - (record.target ?? 0));
              }
           }
        });

        if (!groups[part.partNumber]) {
           groups[part.partNumber] = {
              partNumber: part.partNumber,
              aggregatedRecords: DAYS_OF_WEEK.map(day => ({
                 dayOfWeek: day as DayOfWeek,
                 actual: 0,
                 target: 0
              })),
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
           const agg = group.aggregatedRecords[idx];
           agg.actual = (agg.actual ?? 0) + (record.actual ?? 0);
           agg.target = (agg.target ?? 0) + (record.target ?? 0);
        });

        const partActual = part.dailyRecords.reduce((sum, r) => sum + (r.actual || 0), 0);
        const partTarget = part.dailyRecords.reduce((sum, r) => sum + (r.target || 0), 0);
        
        group.totalActual += partActual;
        group.totalTarget += partTarget;
        group.gap += (partActual - partTarget);
        group.rollingGap += childRollingGap;
     });

     return Object.values(groups);
  }, [activeWeek]);

  return (
    <Box className="w-full">
      <Title order={3} mb={0}>Delivery Scorecard & Loss Pareto — by Department</Title>
      <Group justify="space-between" align="flex-end" mb="xl">
        <Text c="dimmed" size="sm">Daily actual vs target and root cause accumulation per department.</Text>
        <Button
          variant="filled"
          color="indigo"
          leftSection={<IconPlus size={16} />}
          onClick={() => setShiftModalOpened(true)}
          size="sm"
        >
          Record Shift Production
        </Button>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab} variant="outline" mb="md">
        <Tabs.List>
          {processes.map(name => (
            <Tabs.Tab 
              key={name} 
              value={name} 
              leftSection={getProcessIcon(name)}
              color="indigo"
            >
              <Text fw={600} size="sm">{name}</Text>
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group justify="space-between" align="flex-start" mb="md" gap="xl">
        <Box>
           <Group gap="xs" mb="xs">
             <Text c="indigo.6" className="flex items-center gap-2" fw={700} size="xl">
               {activeDeptIcon} {activeTab}
             </Text>
             <Badge variant="light" color="indigo" size="sm">Dept Scorecard</Badge>
           </Group>
           <Text c="dimmed" size="xs">Daily actual vs target by part number, and root<br/>cause accumulation.</Text>
        </Box>

        <Select
          label={<Text size="xs" fw={700} c="dimmed">SELECT WORK WEEK TO VIEW</Text>}
          value={selectedWeekId}
          onChange={setSelectedWeekId}
          data={weekOptions}
          placeholder="Select a week"
          size="md"
          className="flex-1 max-w-md"
        />
      </Group>

      <Card withBorder shadow="sm" radius="md" mt="sm">
        {activeWeek ? (
          <Table verticalSpacing="sm" striped highlightOnHover className="w-full">
            <Table.Thead>
              <Table.Tr>
                <Table.Th><Text size="xs" fw={700} c="dimmed">PART NUMBER</Text></Table.Th>
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
                <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">TOTAL ACTUAL</Text></Table.Th>
                <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">TOTAL TARGET</Text></Table.Th>
                <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">GAP</Text></Table.Th>
                <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">ROLLING GAP</Text></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groupedParts.map(group => {
                const isExpanded = expandedParts.has(group.partNumber);
                
                return (
                  <React.Fragment key={group.partNumber}>
                    {/* Parent Row */}
                    <Table.Tr 
                      bg="indigo.0" 
                      style={{ cursor: 'pointer' }} 
                      onClick={() => toggleExpand(group.partNumber)}
                    >
                      <Table.Td fw={700}>
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
                            <Box py="xs" px="xs">
                              <Text size="sm" fw={700} c={styles.color}>{record.actual}</Text>
                              <Text size="10px" c="dimmed">Tgt: {record.target}</Text>
                            </Box>
                          </Table.Td>
                        );
                      })}
                      <Table.Td ta="center" bg="indigo.1">
                        <Text size="sm" fw={800}>{group.totalActual}</Text>
                      </Table.Td>
                      <Table.Td ta="center" bg="indigo.1">
                        <Text size="sm" fw={800}>{group.totalTarget}</Text>
                      </Table.Td>
                      <Table.Td ta="center" bg={group.gap < 0 ? 'red.1' : 'green.1'}>
                        <Text size="sm" fw={800} c={group.gap < 0 ? 'red.9' : 'green.9'}>
                          {group.gap > 0 ? `+${group.gap}` : group.gap}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="center" bg={group.rollingGap < 0 ? 'red.1' : 'green.1'}>
                        <Text size="sm" fw={800} c={group.rollingGap < 0 ? 'red.9' : 'green.9'}>
                          {group.rollingGap > 0 ? `+${group.rollingGap}` : group.rollingGap}
                        </Text>
                      </Table.Td>
                    </Table.Tr>

                    {/* Child Rows */}
                    {isExpanded && group.shifts.map(part => {
                      const totalActual = part.dailyRecords.reduce((sum, r) => sum + (r.actual || 0), 0);
                      const totalTarget = part.dailyRecords.reduce((sum, r) => sum + (r.target || 0), 0);
                      const gap = totalActual - totalTarget;

                      return (
                        <Table.Tr key={`${part.partNumber}_${part.shift}`} bg="var(--mantine-color-gray-0)">
                          <Table.Td pl={40}>
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
                            if (!record || record.actual === null || record.target === null) {
                              return (
                                <Table.Td 
                                  key={day} 
                                  ta="center"
                                  className="cursor-pointer hover:bg-white"
                                  onClick={() => record && handleCellClick(part.partNumber, part.shift, day, record)}
                                >
                                  <Box py="xs" px="xs">
                                    <Text size="sm" fw={500} c="gray.4">-</Text>
                                    <Text size="10px" c="dimmed">Tgt: -</Text>
                                  </Box>
                                </Table.Td>
                              );
                            }

                            const styles = getCellStyles(record.actual, record.target);

                            return (
                              <Table.Td 
                                key={day} 
                                ta="center" 
                                bg={styles.bg} 
                                p={0}
                                className="cursor-pointer hover:opacity-80"
                                onClick={() => handleCellClick(part.partNumber, part.shift, day, record)}
                              >
                                <Tooltip 
                                  label={
                                    <Stack gap={2}>
                                      <Text size="xs" fw={700}>Part: {part.partNumber} (Shift {part.shift})</Text>
                                      <Text size="xs">Actual: {record.actual}</Text>
                                      <Text size="xs">Target: {record.target}</Text>
                                      <Text size="xs" c="indigo.4" mt={4} fw={700}>Click to Edit</Text>
                                    </Stack>
                                  }
                                  withArrow
                                  position="top"
                                >
                                  <Box py="xs" px="xs">
                                    <Text size="sm" fw={styles.fw} c={styles.color}>{record.actual}</Text>
                                    <Text size="10px" c="dimmed">Tgt: {record.target}</Text>
                                  </Box>
                                </Tooltip>
                              </Table.Td>
                            );
                          })}
                          <Table.Td ta="center" bg="gray.1">
                            <Text size="sm" fw={600}>{totalActual}</Text>
                          </Table.Td>
                          <Table.Td ta="center" bg="gray.1">
                            <Text size="sm" fw={600}>{totalTarget}</Text>
                          </Table.Td>
                          <Table.Td ta="center" bg={gap < 0 ? 'red.0' : 'green.0'}>
                            <Text size="sm" fw={600} c={gap < 0 ? 'red.8' : 'green.8'}>
                              {gap > 0 ? `+${gap}` : gap}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="center" bg={part.rollingGap < 0 ? 'red.0' : 'green.0'}>
                            <Text size="sm" fw={600} c={part.rollingGap < 0 ? 'red.8' : 'green.8'}>
                              {part.rollingGap > 0 ? `+${part.rollingGap}` : part.rollingGap}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {groupedParts.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={11} ta="center" py="xl">
                    <Text c="dimmed">No parts tracked for this week yet.</Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" ta="center" py="xl">No work week selected or no data available.</Text>
        )}
      </Card>

      {activeDepartment && activeWeek && editingEntry && (
        <EditEntryModal
          opened={editModalOpened}
          onClose={() => setEditModalOpened(false)}
          departmentName={activeDepartment.departmentName}
          weekId={activeWeek.weekId}
          weekLabel={activeWeek.weekLabel}
          partNumber={editingEntry.partNumber}
          shift={editingEntry.shift}
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
        <DeliveryLossPareto 
          weekData={activeWeek}
          departmentName={activeTab}
        />
      )}
    </Box>
  );
}
