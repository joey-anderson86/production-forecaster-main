'use client';

import React, { useMemo, useState } from 'react';
import { 
  Card, Text, Title, Group, Badge, Stack, Box, useMantineTheme, 
  Paper, Divider, Tooltip, ActionIcon, Select, Button
} from '@mantine/core';
import { 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  ComposedChart, 
  Line,
  Cell,
  Legend
} from 'recharts';
import { IconChartBar, IconAlertCircle } from '@tabler/icons-react';
import { WeeklyScorecard, DailyScorecardRecord } from '@/lib/scorecardStore';
import { generateParetoData, ParetoDataPoint } from '@/lib/paretoUtils';

interface DeliveryLossParetoProps {
  weekData?: WeeklyScorecard | null;
  departmentName: string;
  compact?: boolean;
  displayUnit: 'batches' | 'pieces';
  batchSizeMap: Map<string, number>;
}

const CustomTooltip = ({ active, payload, label, displayUnit }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as ParetoDataPoint;
    const unitLabel = displayUnit === 'batches' ? 'Batches' : 'Pieces';
    
    // Extract part count entries (excluding fixed fields)
    const partEntries = Object.entries(data)
      .filter(([key]) => !['reason', 'frequency', 'cumulativePercentage'].includes(key))
      .sort((a, b) => (b[1] as number) - (a[1] as number));

    return (
      <Paper 
        p="sm" 
        shadow="md" 
        withBorder 
        style={{ 
          backgroundColor: 'light-dark(rgba(255, 255, 255, 0.95), var(--mantine-color-dark-7))',
          borderColor: 'light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))',
          backdropFilter: 'blur(4px)',
          color: 'light-dark(var(--mantine-color-black), var(--mantine-color-white))'
        }}
      >
        <Stack gap={4}>
          <Text fw={700} size="sm">
            {data.reason}
          </Text>
          <Divider my={4} color="light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))" />
          <Group justify="space-between" gap="xl">
            <Text size="xs" fw={500} c="dimmed">
              Total Misses:
            </Text>
            <Text size="xs" fw={700} c="blue.7">
              {data.frequency.toLocaleString()} {unitLabel}
            </Text>
          </Group>
          <Group justify="space-between" gap="xl">
            <Text size="xs" fw={500} c="dimmed">
              Cumulative %:
            </Text>
            <Text size="xs" fw={700} c="orange.7">{data.cumulativePercentage}%</Text>
          </Group>
          
          {partEntries.length > 0 && (
            <>
              <Text size="10px" fw={700} c="dimmed" mt={4} tt="uppercase">Part Breakdown ({unitLabel})</Text>
              {partEntries.map(([part, count]) => (
                <Group key={part} justify="space-between" gap="xs">
                  <Text size="10px" ff="monospace">
                    {part}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {(count as number).toLocaleString()}
                  </Badge>
                </Group>
              ))}
            </>
          )}
        </Stack>
      </Paper>
    );
  }
  return null;
};

export function DeliveryLossPareto({ 
  weekData, 
  departmentName, 
  compact = false,
  displayUnit,
  batchSizeMap
}: DeliveryLossParetoProps) {
  const theme = useMantineTheme();
  const chartHeight = compact ? 500 : 400;
  
  const [shiftFilter, setShiftFilter] = useState<string | null>(null);
  const [partFilter, setPartFilter] = useState<string | null>(null);

  // Generate unique shifts and parts for the filter dropdowns
  const filterOptions = useMemo(() => {
    if (!weekData?.Parts) return { shifts: [], parts: [] };
    const shifts = Array.from(new Set(weekData.Parts.map(p => p.Shift))).sort();
    const parts = Array.from(new Set(weekData.Parts.map(p => p.PartNumber))).sort();
    
    return {
      shifts: shifts.map(s => ({ value: s, label: `Shift ${s}` })),
      parts: parts.map(p => ({ value: p, label: p }))
    };
  }, [weekData]);

  const paretoData = useMemo(() => {
    if (!weekData) return [];
    
    // Apply filters to the weekData parts before generating Pareto data
    const filteredParts = weekData.Parts.filter(p => {
      const matchShift = !shiftFilter || p.Shift === shiftFilter;
      const matchPart = !partFilter || p.PartNumber === partFilter;
      return matchShift && matchPart;
    });

    const filteredWeekData = {
      ...weekData,
      Parts: filteredParts
    };

    return generateParetoData(filteredWeekData as any, displayUnit, batchSizeMap);
  }, [weekData, displayUnit, batchSizeMap, shiftFilter, partFilter]);

  // Determine if we should show the "no data" placeholder instead of the chart
  const showPlaceholder = !weekData || paretoData.length === 0;

  return (
    <Card withBorder shadow="sm" radius="md" p={compact ? 'md' : 'lg'} mt={compact ? 'md' : 'xl'}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Group gap="xs" mb={4}>
              <IconChartBar size={24} color={theme.colors.indigo[6]} />
              <Title order={4}>Production Loss Pareto</Title>
              <Badge variant="light" color="orange" size="sm">Root Cause Analysis</Badge>
            </Group>
            <Text c="dimmed" size="xs">
              Cumulative distribution of production misses by reason code for <strong>{departmentName}</strong> ({weekData?.WeekLabel || 'Selected Week'}).
            </Text>
          </Box>
          
          <Group gap="sm">
            <Select 
              placeholder="Filter by Shift"
              data={filterOptions.shifts}
              value={shiftFilter}
              onChange={setShiftFilter}
              clearable
              size="xs"
              w={140}
              className="dark:bg-dark-7"
            />
            <Select 
              placeholder="Filter by Part"
              data={filterOptions.parts}
              value={partFilter}
              onChange={setPartFilter}
              clearable
              size="xs"
              w={180}
              className="dark:bg-dark-7"
            />
            <Tooltip label="Pareto principle: 80% of problems often come from 20% of causes. Focus on the tallest bars first." multiline w={220} withArrow>
              <ActionIcon variant="subtle" color="gray" radius="xl">
                <IconAlertCircle size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {showPlaceholder ? (
          <Box py={60}>
            <Stack align="center" gap="xs">
              <IconChartBar size={48} color={theme.colors.gray[3]} />
              <Title order={4} c="dimmed">No Root Cause Data</Title>
              <Text c="dimmed" size="sm" ta="center">
                {(!shiftFilter && !partFilter) 
                  ? "No reason codes recorded for misses this week." 
                  : "No data matches the selected filters."}
                <br/>
                Enter "Reason Codes" in the scorecard for production misses to generate this chart.
              </Text>
              {(shiftFilter || partFilter) && (
                <Button variant="subtle" size="xs" onClick={() => { setShiftFilter(null); setPartFilter(null); }}>
                  Clear All Filters
                </Button>
              )}
            </Stack>
          </Box>
        ) : (
          <>
            <Box h={chartHeight} w="100%">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={paretoData}
                  margin={{ top: 20, right: 40, left: 0, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.colors.gray[2]} />
                  
                  <XAxis 
                    dataKey="reason" 
                    angle={compact ? -60 : -45} 
                    textAnchor="end" 
                    interval={0}
                    height={compact ? 100 : 80}
                    tick={{ fontSize: compact ? 10 : 11, fontWeight: 500 }}
                    stroke={theme.colors.gray[6]}
                  />
                  
                  {/* Left Y-Axis: Frequency count */}
                  <YAxis 
                    yAxisId="left" 
                    orientation="left" 
                    label={{ value: 'Frequency (Misses)', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 12, fontWeight: 600, fill: theme.colors.gray[6] } }}
                    tick={{ fontSize: 11 }}
                    stroke={theme.colors.gray[6]}
                  />
                  
                  {/* Right Y-Axis: Cumulative Percentage */}
                  <YAxis 
                    yAxisId="right" 
                    orientation="right" 
                    domain={[0, 100]}
                    label={{ value: 'Cumulative %', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 12, fontWeight: 600, fill: theme.colors.orange[7] } }}
                    tick={{ fontSize: 11 }}
                    stroke={theme.colors.orange[7]}
                  />
                  
                  <RechartsTooltip content={<CustomTooltip displayUnit={displayUnit} />} />
                  <Legend verticalAlign="top" height={36}/>
    
                  <Bar 
                    yAxisId="left" 
                    dataKey="frequency" 
                    name="Loss Frequency"
                    radius={[4, 4, 0, 0]}
                    barSize={40}
                  >
                    {paretoData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === 0 ? theme.colors.indigo[7] : theme.colors.indigo[4]} />
                    ))}
                  </Bar>
    
                  <Line 
                    yAxisId="right" 
                    type="monotone" 
                    dataKey="cumulativePercentage" 
                    name="Cumulative %"
                    stroke={theme.colors.orange[7]} 
                    strokeWidth={3} 
                    dot={{ r: 4, fill: theme.colors.orange[7], strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
            
            <Text size="xs" c="dimmed" fs="italic" ta="center">
              Hover over bars to see the specific part numbers contributing to each loss category.
            </Text>
          </>
        )}
      </Stack>
    </Card>
  );
}
