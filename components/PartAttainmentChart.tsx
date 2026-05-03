'use client';

import React from 'react';
import { 
  Card, Text, Title, Group, Badge, Stack, Box, useMantineTheme, 
  Paper, Divider, Tooltip, ActionIcon, ThemeIcon
} from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { IconTarget, IconInfoCircle } from '@tabler/icons-react';
import { WeeklyScorecard } from '@/lib/scorecardStore';
import { useAttainmentMath } from '@/lib/hooks/useAttainmentMath';

interface PartAttainmentChartProps {
  weekData?: WeeklyScorecard | null;
  departmentName: string;
  compact?: boolean;
  height?: number;
}

export function PartAttainmentChart({ weekData, departmentName, compact = false, height }: PartAttainmentChartProps) {
  const theme = useMantineTheme();
  const chartHeight = height || (compact ? 450 : 350);
  
  const { cappedPartAttainment, hasData: hookHasData } = useAttainmentMath(weekData?.Parts);

  const sortedData = React.useMemo(() => {
    return [...cappedPartAttainment].sort((a, b) => a.partNumber.localeCompare(b.partNumber));
  }, [cappedPartAttainment]);

  const hasData = hookHasData && sortedData.length > 0;

  if (!weekData || !hasData) {
    return (
      <Card withBorder shadow="sm" radius="md" p="xl" mt="xl" className="bg-slate-50/50">
        <Stack align="center" gap="xs">
          <ThemeIcon variant="light" size="xl" color="gray">
            <IconTarget size={24} />
          </ThemeIcon>
          <Title order={4} c="dimmed">Part Attainment — {departmentName}</Title>
          <Text c="dimmed" size="sm" ta="center">
            No production data available to calculate attainment for this week.<br/>
            Enter "Actual" values in the scorecard to generate this chart.
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
              <IconTarget size={24} color={theme.colors.indigo[6]} />
              <Title order={4}>Capped Attainment by Part Number</Title>
              <Badge variant="light" color="indigo" size="sm">Part Performance</Badge>
            </Group>
            <Text c="dimmed" size="xs">
              Weekly attainment aggregated by part number across all shifts. Actuals are capped at 100% of target.
            </Text>
          </Box>
          
          <Group gap="xs">
            <Tooltip 
              label="Capped Attainment: (Sum of Actual / Sum of Target) * 100, capped at 100%. This shows how each part is performing relative to its total weekly plan." 
              multiline 
              w={250} 
              withArrow
            >
              <ActionIcon variant="subtle" color="gray" radius="xl">
                <IconInfoCircle size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Box h={chartHeight + 50} w="100%">
          <BarChart
            h={chartHeight}
            data={sortedData}
            dataKey="partNumber"
            series={[
              { name: 'attainment', color: 'indigo.6', label: 'Attainment %' },
            ]}
            tickLine="xy"
            gridAxis="xy"
            xAxisProps={{ 
              angle: -45, 
              textAnchor: 'end',
              height: 80,
              interval: 0
            }}
            yAxisProps={{ domain: [0, 100] }}
            valueFormatter={(value) => `${value}%`}
            withBarValueLabel
            valueLabelProps={{ 
              position: 'top', 
              fontSize: 11, 
              fontWeight: 700,
              fill: theme.colors.gray[7],
              formatter: (val: any) => val !== undefined && val !== null ? `${val}%` : ''
            }}
            tooltipProps={{
              cursor: false,
              content: ({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <Paper p="sm" withBorder shadow="md" style={{ 
                      backgroundColor: 'light-dark(rgba(255, 255, 255, 0.95), var(--mantine-color-dark-7))',
                      backdropFilter: 'blur(4px)'
                    }}>
                      <Text size="xs" fw={700} c="light-dark(var(--mantine-color-black), var(--mantine-color-white))">
                        {data.partNumber}
                      </Text>
                      <Text size="xs" c="indigo.7" fw={800}>{data.attainment}% Attainment</Text>
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
              barSize: compact ? 30 : 50,
            }}
          />
        </Box>
        
        <Divider />
        
        <Group justify="center" gap="xl">
          <Group gap="xs">
            <Box w={12} h={12} bg="indigo.6" style={{ borderRadius: 2 }} />
            <Text size="xs" fw={600}>Part Attainment</Text>
          </Group>
          <Group gap="xs">
             <Divider orientation="vertical" h={12} variant="dashed" color="red.6" />
             <Text size="xs" fw={600} c="red.6">85% Goal Line</Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}
