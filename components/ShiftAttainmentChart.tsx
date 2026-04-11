'use client';

import React, { useMemo } from 'react';
import { 
  Card, Text, Title, Group, Badge, Stack, Box, useMantineTheme, 
  Paper, Divider, Tooltip, ActionIcon, ThemeIcon
} from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { IconTarget, IconInfoCircle } from '@tabler/icons-react';
import { WeeklyScorecard } from '@/lib/scorecardStore';
import { useAttainmentMath } from '@/lib/hooks/useAttainmentMath';

interface ShiftAttainmentChartProps {
  weekData?: WeeklyScorecard | null;
  departmentName: string;
}

export function ShiftAttainmentChart({ weekData, departmentName }: ShiftAttainmentChartProps) {
  const theme = useMantineTheme();
  
  const { cappedShiftAttainment: attainmentData } = useAttainmentMath(weekData?.parts);

  const hasData = attainmentData.some(d => d.attainment > 0);

  if (!weekData || !hasData) {
    return (
      <Card withBorder shadow="sm" radius="md" p="xl" mt="xl" className="bg-slate-50/50">
        <Stack align="center" gap="xs">
          <ThemeIcon variant="light" size="xl" color="gray">
            <IconTarget size={24} />
          </ThemeIcon>
          <Title order={4} c="dimmed">Shift Attainment — {departmentName}</Title>
          <Text c="dimmed" size="sm" ta="center">
            No production data available to calculate attainment for this week.<br/>
            Enter "Actual" values in the scorecard to generate this chart.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card withBorder shadow="sm" radius="md" p="lg" mt="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Group gap="xs" mb={4}>
              <IconTarget size={24} color={theme.colors.indigo[6]} />
              <Title order={4}>Capped Attainment by Shift</Title>
              <Badge variant="light" color="indigo" size="sm">Performance Analysis</Badge>
            </Group>
            <Text c="dimmed" size="xs">
              Weekly attainment for <strong>{departmentName}</strong> ({weekData.weekLabel}). Actuals are capped at 100% of target per run.
            </Text>
          </Box>
          
          <Tooltip 
            label="Capped Attainment: (Sum of min(Actual, Target) / Sum of Target) * 100. This prevents over-production in one shift from masking misses in another." 
            multiline 
            w={250} 
            withArrow
          >
            <ActionIcon variant="subtle" color="gray" radius="xl">
              <IconInfoCircle size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <Box h={400} w="100%">
          <BarChart
            h={350}
            data={attainmentData}
            dataKey="shift"
            series={[
              { name: 'attainment', color: 'indigo.6', label: 'Attainment %' },
            ]}
            tickLine="xy"
            gridAxis="xy"
            yAxisProps={{ domain: [0, 110] }}
            valueFormatter={(value) => `${value}%`}
            tooltipProps={{
              cursor: false,
              content: ({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <Paper p="sm" withBorder shadow="md">
                      <Text size="xs" fw={700}>Shift {payload[0].payload.shift}</Text>
                      <Text size="xs" c="indigo.7" fw={800}>{payload[0].value}% Attainment</Text>
                    </Paper>
                  );
                }
                return null;
              },
            }}
            referenceLines={[
              { y: 85, color: 'red.6', label: 'Target: 85%', strokeDasharray: '3 3' },
            ]}
            barProps={{
              radius: [4, 4, 0, 0],
              barSize: 60,
              label: { 
                position: 'top', 
                formatter: (val: any) => val !== undefined && val !== null ? `${val}%` : '',
                style: { fontSize: '11px', fontWeight: 700, fill: theme.colors.gray[7] }
              }
            }}
          />
        </Box>
        
        <Divider />
        
        <Group justify="center" gap="xl">
          <Group gap="xs">
            <Box w={12} h={12} bg="indigo.6" style={{ borderRadius: 2 }} />
            <Text size="xs" fw={600}>Shift Attainment</Text>
          </Group>
          <Group gap="xs">
             <Divider orientation="vertical" h={12} variant="dashed" color="red.6" label="---" />
             <Text size="xs" fw={600} c="red.6">85% Goal Line</Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}
