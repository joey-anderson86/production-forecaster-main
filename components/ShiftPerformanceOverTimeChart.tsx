'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { 
  Card, Text, Title, Group, Badge, Stack, Box, useMantineTheme, 
  Paper, Center, ThemeIcon, Popover, Button, ScrollArea, Checkbox, Chip, SegmentedControl, Switch
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

  type TimeInterval = 'day' | 'week' | 'month';
  const [interval, setInterval] = useState<TimeInterval>('day');
  const [combineShifts, setCombineShifts] = useState(false);

  const chartData = useMemo(() => {
    if (selectedWeeks.length === 0 || selectedShifts.length === 0) return [];

    const statsByInterval: Record<string, Record<string, { cappedActual: number; totalTarget: number }>> = {};

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
            let intervalKey = dateStr;
            if (interval === 'week') {
              intervalKey = weekId;
            } else if (interval === 'month') {
              intervalKey = dateStr.substring(0, 7);
            }

            if (!statsByInterval[intervalKey]) {
              statsByInterval[intervalKey] = {};
            }
            if (!statsByInterval[intervalKey][shift]) {
              statsByInterval[intervalKey][shift] = { cappedActual: 0, totalTarget: 0 };
            }

            statsByInterval[intervalKey][shift].cappedActual += Math.min(actual, target);
            statsByInterval[intervalKey][shift].totalTarget += target;
          }
        });
      });
    });

    const intervalKeys = Object.keys(statsByInterval).sort();

    return intervalKeys.map(key => {
      const dataPoint: any = { date: key };
      
      if (interval === 'day') {
        const parsedDate = parseISOLocal(key);
        dataPoint.displayDate = parsedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } else if (interval === 'month') {
        const parsedDate = parseISOLocal(key + '-01');
        dataPoint.displayDate = parsedDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      } else {
        const week = weeksData[key];
        dataPoint.displayDate = week ? week.WeekLabel : key;
      }

      if (combineShifts) {
        let totalActual = 0;
        let totalTarget = 0;
        selectedShifts.forEach(shift => {
          const stats = statsByInterval[key][shift];
          if (stats) {
            totalActual += stats.cappedActual;
            totalTarget += stats.totalTarget;
          }
        });
        if (totalTarget > 0) {
          dataPoint['Combined'] = parseFloat(((totalActual / totalTarget) * 100).toFixed(1));
        } else {
          dataPoint['Combined'] = null;
        }
      } else {
        selectedShifts.forEach(shift => {
          const stats = statsByInterval[key][shift];
          if (stats && stats.totalTarget > 0) {
            dataPoint[shift] = parseFloat(((stats.cappedActual / stats.totalTarget) * 100).toFixed(1));
          } else {
            dataPoint[shift] = null;
          }
        });
      }

      return dataPoint;
    });
  }, [selectedWeeks, selectedShifts, weeksData, interval, combineShifts]);

  const shiftColors: Record<string, string> = {
    'A': 'indigo.6',
    'B': 'teal.6',
    'C': 'orange.6',
    'D': 'pink.6'
  };

  const series = useMemo(() => {
    if (combineShifts) {
      return [{
        name: 'Combined',
        color: 'indigo.6',
        label: 'Combined Attainment'
      }];
    }
    return selectedShifts.map(shift => ({
      name: shift,
      color: shiftColors[shift] || 'gray.6',
      label: `Shift ${shift}`
    }));
  }, [selectedShifts, combineShifts]);

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
          
          <Group gap="sm" align="center">
            <SegmentedControl
              size="xs"
              data={[
                { label: 'Day', value: 'day' },
                { label: 'Week', value: 'week' },
                { label: 'Month', value: 'month' },
              ]}
              value={interval}
              onChange={(value) => setInterval(value as TimeInterval)}
            />
            <Switch
              size="xs"
              label="Combine Shifts"
              checked={combineShifts}
              onChange={(e) => setCombineShifts(e.currentTarget.checked)}
            />
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
                                <Text size="xs">{entry.name === 'Combined' ? 'Combined Attainment' : `Shift ${entry.name}`}</Text>
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
                                <Text size="xs">{entry.name === 'Combined' ? 'Combined Attainment' : `Shift ${entry.name}`}</Text>
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
