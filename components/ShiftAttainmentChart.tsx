'use client';

import React, { useMemo, useState } from 'react';
import { 
  Card, Text, Title, Group, Badge, Stack, Box, useMantineTheme, 
  Paper, Divider, Tooltip, ActionIcon, ThemeIcon, Button
} from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { IconTarget, IconInfoCircle, IconArrowLeft } from '@tabler/icons-react';
import { WeeklyScorecard, PartScorecard } from '@/lib/scorecardStore';
import { useAttainmentMath } from '@/lib/hooks/useAttainmentMath';

/**
 * Configuration properties for the ShiftAttainmentChart component.
 */
interface ShiftAttainmentChartProps {
  /** The full data set for the target week, containing parts and their daily records. */
  weekData?: WeeklyScorecard | null;
  /** The name of the department being displayed (for titles and labels). */
  departmentName: string;
  /** If true, reduces padding and chart height for display in dashboard sidebars. */
  compact?: boolean;
}

/**
 * A drill-down bar chart component that visualizes production attainment by shift and part.
 * 
 * Performance metrics are "capped" at 100% per run to ensure that over-production
 * on one shift doesn't mask missed targets in another, providing a more accurate
 * view of operational consistency.
 * 
 * @param props - Component properties including week data and department context.
 */
export function ShiftAttainmentChart({ weekData, departmentName, compact = false }: ShiftAttainmentChartProps) {
  const theme = useMantineTheme();
  const chartHeight = compact ? 450 : 350;
  const [selectedShift, setSelectedShift] = useState<string | null>(null);
  
  const { cappedShiftAttainment: attainmentData, hasData: hookHasData } = useAttainmentMath(weekData?.Parts);

  /**
   * Computes the detailed attainment breakdown for a specific shift when selected.
   * 
   * The logic filters all parts by the selected shift and calculates the attainment
   * for each part number individually. Attainment for each part is capped at 100%
   * of the target to maintain consistency with the high-level shift metrics.
   * 
   * @returns An array of objects containing part numbers and their respective attainment percentages.
   */
  const drillDownData = useMemo(() => {
    if (!selectedShift || !weekData?.Parts) return [];
    
    const partStats: Record<string, { cappedActual: number; totalTarget: number }> = {};
    
    // Aggregate stats per part number within the chosen shift
    weekData.Parts
      .filter(p => p.Shift === selectedShift)
      .forEach(part => {
        if (!partStats[part.PartNumber]) {
          partStats[part.PartNumber] = { cappedActual: 0, totalTarget: 0 };
        }
        part.DailyRecords.forEach(record => {
          // Capping logic: Actuals exceeding target are ignored to prevent skewing
          if (record.Actual !== null && record.Actual !== undefined) {
            partStats[part.PartNumber].cappedActual += Math.min(record.Actual, record.Target ?? 0);
            partStats[part.PartNumber].totalTarget += (record.Target ?? 0);
          }
        });
      });

    return Object.entries(partStats)
      .map(([partNumber, stats]) => ({
        partNumber,
        attainment: stats.totalTarget > 0 
          ? parseFloat(((stats.cappedActual / stats.totalTarget) * 100).toFixed(1)) 
          : 0
      }))
      .sort((a, b) => b.attainment - a.attainment);
  }, [selectedShift, weekData]);

  const hasData = hookHasData && (selectedShift ? drillDownData.length > 0 : attainmentData.some(d => d.attainment >= 0));

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
    <Card withBorder shadow="sm" radius="md" p={compact ? 'md' : 'lg'} mt={compact ? 'md' : 'xl'}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Group gap="xs" mb={4}>
              <IconTarget size={24} color={theme.colors.indigo[6]} />
              <Title order={4}>
                {selectedShift ? `Shift ${selectedShift} Attainment by Part` : 'Capped Attainment by Shift'}
              </Title>
              <Badge variant="light" color="indigo" size="sm">Performance Analysis</Badge>
            </Group>
            <Text c="dimmed" size="xs">
              {selectedShift 
                ? `Performance breakdown by part number for Shift ${selectedShift}.`
                : `Weekly attainment for ${departmentName} (${weekData.WeekLabel}). Actuals are capped at 100% of target per run.`
              }
            </Text>
          </Box>
          
          <Group gap="xs">
            {selectedShift && (
              <Button 
                variant="subtle" 
                size="xs" 
                leftSection={<IconArrowLeft size={16} />}
                onClick={() => setSelectedShift(null)}
              >
                Back to All Shifts
              </Button>
            )}
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
        </Group>

        <Box h={chartHeight + 50} w="100%">
          <BarChart
            h={chartHeight}
            data={selectedShift ? drillDownData : attainmentData}
            dataKey={selectedShift ? "partNumber" : "shift"}
            series={[
              { name: 'attainment', color: 'indigo.6', label: 'Attainment %' },
            ]}
            tickLine="xy"
            gridAxis="xy"
            yAxisProps={{ domain: [0, 110] }}
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
                  const label = selectedShift ? payload[0].payload.partNumber : `Shift ${payload[0].payload.shift}`;
                  return (
                    <Paper p="sm" withBorder shadow="md" style={{ 
                      backgroundColor: 'light-dark(rgba(255, 255, 255, 0.95), var(--mantine-color-dark-7))',
                      backdropFilter: 'blur(4px)'
                    }}>
                      <Text size="xs" fw={700} c="light-dark(var(--mantine-color-black), var(--mantine-color-white))">
                        {label}
                      </Text>
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
              barSize: compact ? 40 : 60,
              style: { cursor: selectedShift ? 'default' : 'pointer' },
              onClick: (data: any) => {
                const shiftValue = data?.payload?.shift;
                if (!selectedShift && shiftValue) {
                  setSelectedShift(shiftValue);
                }
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
