'use client';

import React, { useState } from 'react';
import { useScorecardStore, DayOfWeek, DailyScorecardRecord } from '@/lib/scorecardStore';
import { generateParetoData } from '@/lib/paretoUtils';
import { 
  Tabs, Select, Table, Card, Text, Group, Badge, Title, Box, Tooltip, Stack 
} from '@mantine/core';
import { IconFlask, IconBox, IconShip, IconClipboardCheck } from '@tabler/icons-react';
import { 
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { EditEntryModal } from './EditEntryModal';

const DEFAULT_DEPARTMENTS = [
  { name: 'Plating', icon: <IconFlask size={20} /> },
  { name: 'VPA', icon: <IconClipboardCheck size={20} /> },
  { name: 'EBPVD', icon: <IconBox size={20} /> },
  { name: 'Shipping', icon: <IconShip size={20} /> }
];

const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function DeliveryScorecardDisplay() {
  const store = useScorecardStore();
  const [activeTab, setActiveTab] = useState<string | null>('Plating');
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);

  // Edit Modal State
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [editingEntry, setEditingEntry] = useState<{
    partNumber: string;
    dayOfWeek: DayOfWeek;
    record: DailyScorecardRecord;
  } | null>(null);

  const activeDepartment = activeTab ? store.departments[activeTab] : null;

  // Render variables
  const weekOptions = activeDepartment 
    ? Object.values(activeDepartment.weeks).map(w => ({ value: w.weekId, label: w.weekLabel })) 
    : [];

  // Default to first week if available and no week is selected
  React.useEffect(() => {
    if (activeDepartment) {
      const weekIds = Object.keys(activeDepartment.weeks);
      if (weekIds.length > 0 && !weekIds.includes(selectedWeekId || '')) {
        setSelectedWeekId(weekIds[0]);
      } else if (weekIds.length === 0) {
        setSelectedWeekId(null);
      }
    } else {
      setSelectedWeekId(null);
    }
  }, [activeDepartment, selectedWeekId]);

  const activeWeek = activeDepartment && selectedWeekId ? activeDepartment.weeks[selectedWeekId] : null;
  const paretoData = generateParetoData(activeWeek);

  // Calculate Rolling Gaps using useMemo
  const rollingGaps = React.useMemo(() => {
    if (!activeWeek) return {};

    const now = new Date();
    // Mon=0, Tue=1, ..., Sun=6
    const todayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;

    // Helper to determine if we should cap the calculation to today
    // We assume the week is "current" if it's the one we are in.
    // Since weekId format varies, we'll try to find if activeWeek represents the current week.
    // For this context, we'll use todayIndex to limit calculation if the week seems current or future.
    // Requirement 4: "Stop calculating... for future dates beyond the current chronological date"
    
    return activeWeek.parts.reduce((acc, part) => {
      let cumulative = 0;
      DAYS_OF_WEEK.forEach((day, index) => {
        // Current date check: if index > todayIndex, it's a "future" day in the current week.
        // We stop summing if it's a future day.
        if (index <= todayIndex) {
          const record = part.dailyRecords.find(r => r.dayOfWeek === day);
          if (record) {
            const actual = record.actual ?? 0;
            const target = record.target ?? 0;
            cumulative += (actual - target);
          }
        }
      });
      acc[part.partNumber] = cumulative;
      return acc;
    }, {} as Record<string, number>);
  }, [activeWeek]);

  const getCellStyles = (actual: number | null, target: number | null) => {
    if (actual === null || target === null) return {};
    if (actual >= target) {
      return { bg: 'green.0', color: 'green.8', fw: 700 };
    }
    return { bg: 'red.0', color: 'red.8', fw: 700 };
  };

  const activeDeptConfig = DEFAULT_DEPARTMENTS.find(d => d.name === activeTab);

  const handleCellClick = (partNumber: string, dayOfWeek: DayOfWeek, record: DailyScorecardRecord) => {
    setEditingEntry({ partNumber, dayOfWeek, record });
    setEditModalOpened(true);
  };

  return (
    <Box className="w-full">
      <Title order={3} mb={0}>Delivery Scorecard & Loss Pareto — by Department</Title>
      <Text c="dimmed" size="sm" mb="xl">Daily actual vs target and root cause accumulation per department.</Text>

      <Tabs value={activeTab} onChange={setActiveTab} variant="outline" mb="md">
        <Tabs.List>
          {DEFAULT_DEPARTMENTS.map(dept => (
            <Tabs.Tab 
              key={dept.name} 
              value={dept.name} 
              leftSection={dept.icon}
              color="indigo"
            >
              <Text fw={600} size="sm">{dept.name}</Text>
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group justify="space-between" align="flex-start" mb="md" gap="xl">
        <Box>
           <Group gap="xs" mb="xs">
             <Text c="indigo.6" className="flex items-center gap-2" fw={700} size="xl">
               {activeDeptConfig?.icon} {activeTab}
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
                {DAYS_OF_WEEK.map(day => (
                  <Table.Th key={day} ta="center"><Text size="xs" fw={700} c="dimmed">{day.toUpperCase()}</Text></Table.Th>
                ))}
                <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">TOTAL ACTUAL</Text></Table.Th>
                <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">TOTAL TARGET</Text></Table.Th>
                <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">GAP</Text></Table.Th>
                <Table.Th ta="center"><Text size="xs" fw={700} c="dimmed">ROLLING GAP</Text></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {activeWeek.parts.map(part => {
                const totalActual = part.dailyRecords.reduce((sum, r) => sum + (r.actual || 0), 0);
                const totalTarget = part.dailyRecords.reduce((sum, r) => sum + (r.target || 0), 0);
                const gap = totalActual - totalTarget;

                return (
                  <Table.Tr key={part.partNumber}>
                    <Table.Td fw={600}>{part.partNumber}</Table.Td>
                    {DAYS_OF_WEEK.map(day => {
                       const record = part.dailyRecords.find(r => r.dayOfWeek === day);
                        if (!record || record.actual === null || record.target === null) {
                          return (
                            <Table.Td 
                              key={day} 
                              ta="center"
                              className="cursor-pointer hover:bg-gray-50 transition-colors"
                              onClick={() => record && handleCellClick(part.partNumber, day, record)}
                            >
                               <Tooltip 
                                 label={
                                   <Stack gap={2}>
                                     <Text size="xs" fw={700}>Part: {part.partNumber}</Text>
                                     <Text size="xs">Actual: -</Text>
                                     <Text size="xs">Target: -</Text>
                                     <Text size="xs" c="indigo.4" mt={4} fw={700}>Click to Initialize</Text>
                                   </Stack>
                                 }
                                 withArrow
                                 position="top"
                               >
                                 <Box py="sm" px="xs">
                                   <Text size="md" fw={700} c="gray.4">-</Text>
                                   <Text size="xs" c="dimmed">Tgt: -</Text>
                                 </Box>
                               </Tooltip>
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
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => handleCellClick(part.partNumber, day, record)}
                          >
                             <Tooltip 
                               label={
                                 <Stack gap={2}>
                                   <Text size="xs" fw={700}>Part: {part.partNumber}</Text>
                                   <Text size="xs">Actual: {record.actual}</Text>
                                   <Text size="xs">Target: {record.target}</Text>
                                   <Text size="xs">Reason for Miss: {record.reasonCode || 'N/A'}</Text>
                                   <Text size="xs" c="indigo.4" mt={4} fw={700}>Click to Edit</Text>
                                 </Stack>
                               }
                               withArrow
                               position="top"
                             >
                               <Box py="sm" px="xs">
                                 <Text size="md" fw={styles.fw} c={styles.color}>{record.actual}</Text>
                                 <Text size="xs" c="dimmed">Tgt: {record.target}</Text>
                               </Box>
                             </Tooltip>
                          </Table.Td>
                       );
                    })}
                    <Table.Td ta="center" bg="gray.0">
                      <Text size="md" fw={700}>{totalActual}</Text>
                    </Table.Td>
                    <Table.Td ta="center" bg="gray.0">
                      <Text size="md" fw={700}>{totalTarget}</Text>
                    </Table.Td>
                    <Table.Td ta="center" bg={gap < 0 ? 'red.0' : 'green.0'}>
                      <Text size="md" fw={700} c={gap < 0 ? 'red.8' : 'green.8'}>
                        {gap > 0 ? `+${gap}` : gap}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="center" bg={rollingGaps[part.partNumber] < 0 ? 'red.0' : 'green.0'}>
                      <Text size="md" fw={700} c={rollingGaps[part.partNumber] < 0 ? 'red.8' : 'green.8'}>
                        {rollingGaps[part.partNumber] > 0 ? `+${rollingGaps[part.partNumber]}` : rollingGaps[part.partNumber]}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {activeWeek.parts.length === 0 && (
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

        {/* Pareto Chart */}
        {activeWeek && paretoData.length > 0 && (
          <Box mt="xl" pt="xl" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
            <Text ta="center" fw={700} c="dimmed" size="sm" mb="xl">
               ROOT CAUSE FREQUENCY (MISSED TARGETS)
            </Text>
            <Box h={400} w="100%" className="max-w-4xl mx-auto">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={paretoData}
                  margin={{ top: 20, right: 20, bottom: 60, left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="reason" 
                    angle={-45} 
                    textAnchor="end" 
                    height={80} 
                    tick={{ fontSize: 12, fill: 'var(--mantine-color-gray-6)' }}
                  />
                  <YAxis 
                     yAxisId="left" 
                     orientation="left" 
                     label={{ value: 'Occurrence Count', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
                     tick={{ fontSize: 12, fill: 'var(--mantine-color-gray-6)' }}
                  />
                  <YAxis 
                     yAxisId="right" 
                     orientation="right" 
                     domain={[0, 100]}
                     tickFormatter={(tick) => `${tick}%`}
                     label={{ value: 'Cumulative %', angle: 90, position: 'insideRight', style: { textAnchor: 'middle' } }}
                     tick={{ fontSize: 12, fill: 'var(--mantine-color-gray-6)' }}
                  />
                  <RechartsTooltip 
                     formatter={(value: any, name: any) => [
                       name === 'Cumulative %' ? `${value}%` : value, 
                       name
                     ]} 
                     contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Legend verticalAlign="top" height={36} />
                  {/* Stacked bars for each part number */}
                  {Array.from(new Set(activeWeek.parts.map(p => p.partNumber))).map((partNum, index) => {
                    const colors = [
                      'var(--mantine-color-indigo-6)',
                      'var(--mantine-color-blue-6)',
                      'var(--mantine-color-cyan-6)',
                      'var(--mantine-color-teal-6)',
                      'var(--mantine-color-green-6)',
                      'var(--mantine-color-lime-6)',
                      'var(--mantine-color-yellow-6)',
                      'var(--mantine-color-orange-6)'
                    ];
                    return (
                      <Bar 
                        key={partNum}
                        yAxisId="left" 
                        dataKey={partNum} 
                        fill={colors[index % colors.length]} 
                        name={partNum} 
                        stackId="a"
                        legendType="none"
                        barSize={60}
                      />
                    );
                  })}
                  <Line 
                    yAxisId="right" 
                    type="monotone" 
                    dataKey="cumulativePercentage" 
                    stroke="var(--mantine-color-red-6)" 
                    strokeWidth={3}
                    dot={{ r: 5, fill: 'var(--mantine-color-red-6)', strokeWidth: 2, stroke: 'white' }}
                    activeDot={{ r: 7 }}
                    name="Cumulative %" 
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          </Box>
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
          dayOfWeek={editingEntry.dayOfWeek}
          initialData={editingEntry.record}
        />
      )}
    </Box>
  );
}
