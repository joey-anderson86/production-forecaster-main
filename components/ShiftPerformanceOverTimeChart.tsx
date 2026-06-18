'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { 
  Card, Text, Title, Group, Badge, Stack, Box, useMantineTheme, 
  Paper, Center, ThemeIcon, Popover, Button, ScrollArea, Checkbox, Chip, SegmentedControl
} from '@mantine/core';
import { BarChart, LineChart } from '@mantine/charts';
import { IconTimeline, IconDatabaseX, IconChevronDown, IconChartBar, IconChartLine } from '@tabler/icons-react';
import { WeeklyScorecard } from '@/lib/scorecardStore';
import { parseISOLocal } from '@/lib/dateUtils';

interface ShiftPerformanceOverTimeChartProps {
  weeksData: Record<string, WeeklyScorecard>;
  departmentName: string;
  compact?: boolean;
  height?: number;
}

export function ShiftPerformanceOverTimeChart({ weeksData, departmentName, compact = false, height }: ShiftPerformanceOverTimeChartProps) {
  const theme = useMantineTheme();
  const chartHeight = height || (compact ? 450 : 350);

  // Derive all available weeks sorted chronologically
  const availableWeeks = useMemo(() => {
    return Object.values(weeksData)
      .sort((a, b) => a.WeekId.localeCompare(b.WeekId))
      .map(w => ({ value: w.WeekId, label: w.WeekLabel }));
  }, [weeksData]);

  // Default to the last 4 weeks
  const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
  
  useEffect(() => {
    if (availableWeeks.length > 0 && selectedWeeks.length === 0) {
      const lastFour = availableWeeks.slice(-4).map(w => w.value);
      setSelectedWeeks(lastFour);
    }
  }, [availableWeeks, selectedWeeks.length]);

  const allShifts = ['A', 'B', 'C', 'D'];
  const [selectedShifts, setSelectedShifts] = useState<string[]>(allShifts);
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  const chartData = useMemo(() => {
    if (selectedWeeks.length === 0 || selectedShifts.length === 0) return [];

    const statsByDate: Record<string, Record<string, { cappedActual: number; totalTarget: number }>> = {};

    selectedWeeks.forEach(weekId => {
      const week = weeksData[weekId];
      if (!week) return;

      week.Parts.forEach(part => {
        const shift = part.Shift || 'Unknown';
        if (!selectedShifts.includes(shift)) return;

        part.DailyRecords.forEach(record => {
          const actual = record.Actual;
          const target = record.Target ?? 0;
          const dateStr = record.Date;

          if (dateStr && actual !== null && actual !== undefined && target > 0) {
            if (!statsByDate[dateStr]) {
              statsByDate[dateStr] = {};
            }
            if (!statsByDate[dateStr][shift]) {
              statsByDate[dateStr][shift] = { cappedActual: 0, totalTarget: 0 };
            }

            statsByDate[dateStr][shift].cappedActual += Math.min(actual, target);
            statsByDate[dateStr][shift].totalTarget += target;
          }
        });
      });
    });

    const dates = Object.keys(statsByDate).sort();

    return dates.map(dateStr => {
      const dataPoint: any = { date: dateStr };
      const parsedDate = parseISOLocal(dateStr);
      dataPoint.displayDate = parsedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      selectedShifts.forEach(shift => {
        const stats = statsByDate[dateStr][shift];
        if (stats && stats.totalTarget > 0) {
          dataPoint[shift] = parseFloat(((stats.cappedActual / stats.totalTarget) * 100).toFixed(1));
        } else {
          dataPoint[shift] = null;
        }
      });

      return dataPoint;
    });
  }, [selectedWeeks, selectedShifts, weeksData]);

  const shiftColors: Record<string, string> = {
    'A': 'indigo.6',
    'B': 'teal.6',
    'C': 'orange.6',
    'D': 'pink.6'
  };

  const series = useMemo(() => {
    return selectedShifts.map(shift => ({
      name: shift,
      color: shiftColors[shift] || 'gray.6',
      label: `Shift ${shift}`
    }));
  }, [selectedShifts]);

  if (!weeksData || Object.keys(weeksData).length === 0) {
    return (
      <Card withBorder shadow="sm" radius="md" p="xl" mt="xl" className="bg-slate-50/50">
        <Stack align="center" gap="xs">
          <ThemeIcon variant="light" size="xl" color="gray">
            <IconTimeline size={24} />
          </ThemeIcon>
          <Title order={4} c="dimmed">Shift Performance Over Time — {departmentName}</Title>
          <Text c="dimmed" size="sm" ta="center">
            No production data available for this department.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card withBorder shadow="sm" radius="md" p={compact ? 'md' : 'lg'} mt={height ? 'sm' : (compact ? 'md' : 'xl')}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Group gap="xs" mb={4}>
              <IconTimeline size={24} color={theme.colors.indigo[6]} />
              <Title order={4}>Shift Performance Over Time</Title>
              <Badge variant="light" color="indigo" size="sm">Trend Analysis</Badge>
            </Group>
            <Text c="dimmed" size="xs">
              Evaluate shift attainment scores across multiple work weeks.
            </Text>
          </Box>
          
          <Group gap="sm">
            <SegmentedControl
              size="xs"
              data={[
                { label: <Center><IconChartBar size={14} /></Center>, value: 'bar' },
                { label: <Center><IconChartLine size={14} /></Center>, value: 'line' },
              ]}
              value={chartType}
              onChange={(value) => setChartType(value as 'bar' | 'line')}
            />
            <Popover width={240} position="bottom-end" shadow="md" withArrow>
              <Popover.Target>
                <Button 
                  variant="default" 
                  size="xs" 
                  rightSection={<IconChevronDown size={14} />}
                >
                  {selectedWeeks.length === availableWeeks.length && availableWeeks.length > 0 
                    ? 'All Weeks' 
                    : `${selectedWeeks.length} Week${selectedWeeks.length !== 1 ? 's' : ''} Selected`}
                </Button>
              </Popover.Target>
              <Popover.Dropdown p="sm">
                <Group justify="space-between" mb="xs">
                  <Text size="xs" fw={700} c="dimmed">Select Work Weeks</Text>
                  <Button 
                    variant="subtle" 
                    size="compact-xs" 
                    onClick={() => setSelectedWeeks(availableWeeks.map(w => w.value))}
                  >
                    All
                  </Button>
                </Group>
                <ScrollArea.Autosize mah={250} type="scroll">
                  <Stack gap="xs">
                    {availableWeeks.map(w => (
                      <Checkbox 
                        key={w.value}
                        label={<Text size="sm">{w.label}</Text>}
                        checked={selectedWeeks.includes(w.value)}
                        onChange={(e) => {
                          if (e.currentTarget.checked) setSelectedWeeks([...selectedWeeks, w.value]);
                          else setSelectedWeeks(selectedWeeks.filter(v => v !== w.value));
                        }}
                        size="sm"
                        color="indigo"
                      />
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </Popover.Dropdown>
            </Popover>

            <Chip.Group multiple value={selectedShifts} onChange={setSelectedShifts}>
              <Group gap="xs">
                {['A', 'B', 'C', 'D'].map(shift => (
                  <Chip 
                    key={shift} 
                    value={shift} 
                    size="xs" 
                    variant="light" 
                    color={shiftColors[shift]}
                  >
                    Shift {shift}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Group>
        </Group>

        {chartData.length > 0 ? (
          <Box h={chartHeight + 50} w="100%">
            {chartType === 'bar' ? (
              <BarChart
                h={chartHeight}
                data={chartData}
                dataKey="displayDate"
                series={series}
                tickLine="xy"
                gridAxis="xy"
                type="default"
                xAxisProps={{ 
                  angle: -45, 
                  textAnchor: 'end',
                  height: 60,
                  interval: 0
                }}
                yAxisProps={{ domain: [0, 110] }}
                valueFormatter={(value) => `${value}%`}
                withTooltip
                tooltipProps={{
                  cursor: { fill: 'var(--mantine-color-blue-0)', opacity: 0.6 },
                  content: ({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <Paper p="sm" withBorder shadow="md" style={{ 
                          backgroundColor: 'light-dark(rgba(255, 255, 255, 0.95), var(--mantine-color-dark-7))',
                          backdropFilter: 'blur(4px)'
                        }}>
                          <Text size="xs" fw={700} mb="xs">{label}</Text>
                          {payload.map((entry: any, index: number) => (
                            <Group key={index} gap="xs" justify="space-between" mb={4}>
                              <Group gap="xs">
                                <Box w={8} h={8} style={{ backgroundColor: entry.color, borderRadius: '50%' }} />
                                <Text size="xs">Shift {entry.name}</Text>
                              </Group>
                              <Text size="xs" fw={700}>{entry.value}%</Text>
                            </Group>
                          ))}
                        </Paper>
                      );
                    }
                    return null;
                  }
                }}
                referenceLines={[
                  { y: 85, color: 'red.6', label: 'Target: 85%', strokeDasharray: '3 3' },
                ]}
                barProps={{
                  radius: [4, 4, 0, 0]
                }}
              />
            ) : (
              <LineChart
                h={chartHeight}
                data={chartData}
                dataKey="displayDate"
                series={series}
                tickLine="xy"
                gridAxis="xy"
                xAxisProps={{ 
                  angle: -45, 
                  textAnchor: 'end',
                  height: 60,
                  interval: 0
                }}
                yAxisProps={{ domain: [0, 110] }}
                valueFormatter={(value) => `${value}%`}
                withTooltip
                tooltipProps={{
                  content: ({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <Paper p="sm" withBorder shadow="md" style={{ 
                          backgroundColor: 'light-dark(rgba(255, 255, 255, 0.95), var(--mantine-color-dark-7))',
                          backdropFilter: 'blur(4px)'
                        }}>
                          <Text size="xs" fw={700} mb="xs">{label}</Text>
                          {payload.map((entry: any, index: number) => (
                            <Group key={index} gap="xs" justify="space-between" mb={4}>
                              <Group gap="xs">
                                <Box w={8} h={8} style={{ backgroundColor: entry.color, borderRadius: '50%' }} />
                                <Text size="xs">Shift {entry.name}</Text>
                              </Group>
                              <Text size="xs" fw={700}>{entry.value}%</Text>
                            </Group>
                          ))}
                        </Paper>
                      );
                    }
                    return null;
                  }
                }}
                referenceLines={[
                  { y: 85, color: 'red.6', label: 'Target: 85%', strokeDasharray: '3 3' },
                ]}
                curveType="linear"
                withDots={true}
                strokeWidth={2}
              />
            )}
          </Box>
        ) : (
          <Center h={chartHeight}>
            <Stack align="center" gap="xs">
               <IconDatabaseX size={32} color="var(--mantine-color-gray-4)" />
               <Text c="dimmed" size="sm">No data available for the selected filters.</Text>
            </Stack>
          </Center>
        )}
      </Stack>
    </Card>
  );
}
