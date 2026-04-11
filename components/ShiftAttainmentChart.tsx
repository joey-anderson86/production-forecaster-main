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

interface ShiftAttainmentChartProps {
  weekData?: WeeklyScorecard | null;
  departmentName: string;
  compact?: boolean;
}

export function ShiftAttainmentChart({ weekData, departmentName, compact = false }: ShiftAttainmentChartProps) {
  const theme = useMantineTheme();
  const chartHeight = compact ? 450 : 350;
  const [selectedShift, setSelectedShift] = useState<string | null>(null);
  
  const { cappedShiftAttainment: attainmentData } = useAttainmentMath(weekData?.parts);

  // Calculate drill-down data when a shift is selected
  const drillDownData = useMemo(() => {
    if (!selectedShift || !weekData?.parts) return [];
    
    const partStats: Record<string, { cappedActual: number; totalTarget: number }> = {};
    
    weekData.parts
      .filter(p => p.shift === selectedShift)
      .forEach(part => {
        if (!partStats[part.partNumber]) {
          partStats[part.partNumber] = { cappedActual: 0, totalTarget: 0 };
        }
        part.dailyRecords.forEach(record => {
          if (record.actual !== null && record.actual !== undefined) {
            partStats[part.partNumber].cappedActual += Math.min(record.actual, record.target ?? 0);
            partStats[part.partNumber].totalTarget += (record.target ?? 0);
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
                : `Weekly attainment for ${departmentName} (${weekData.weekLabel}). Actuals are capped at 100% of target per run.`
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
            tooltipProps={{
              cursor: false,
              content: ({ active, payload }) => {
                if (active && payload && payload.length) {
                  const label = selectedShift ? payload[0].payload.partNumber : `Shift ${payload[0].payload.shift}`;
                  return (
                    <Paper p="sm" withBorder shadow="md">
                      <Text size="xs" fw={700}>{label}</Text>
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
              onClick: (data) => {
                if (!selectedShift && data && data.shift) {
                  setSelectedShift(data.shift);
                }
              },
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
