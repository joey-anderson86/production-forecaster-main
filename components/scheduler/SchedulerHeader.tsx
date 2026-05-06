import React from 'react';
import { Box, Group, Stack, Text, Select, Divider, Button } from '@mantine/core';
import { IconFileExport, IconBolt } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { notifications } from '@mantine/notifications';
import { SchedulerMeta } from '@/lib/types';

interface SchedulerHeaderProps {
  currentWeekId: string;
  setCurrentWeekId: (val: string) => void;
  processName: string | null;
  setProcessName: (val: string) => void;
  processes: string[];
  meta: SchedulerMeta | null;
  aggregateStats: { totalLoad: number; totalCapacity: number; utilization: number };
  dataUnassignedLength: number;
  isSubmitting: boolean;
  isAutoScheduling: boolean;
  isClearing: boolean;
  hasScheduledJobs: boolean;
  dirty: boolean;
  wasSubmitted: boolean;
  handleGenerateChangeover: () => void;
  handleAutoSchedule: () => void;
  handleSubmit: () => void;
  setClearModalOpened: (val: boolean) => void;
  setComparisonModalOpened: (val: boolean) => void;
  setComparisonData: (data: any[]) => void;
}

export default function SchedulerHeader({
  currentWeekId,
  setCurrentWeekId,
  processName,
  setProcessName,
  processes,
  meta,
  aggregateStats,
  dataUnassignedLength,
  isSubmitting,
  isAutoScheduling,
  isClearing,
  hasScheduledJobs,
  dirty,
  wasSubmitted,
  handleGenerateChangeover,
  handleAutoSchedule,
  handleSubmit,
  setClearModalOpened,
  setComparisonModalOpened,
  setComparisonData
}: SchedulerHeaderProps) {
  return (
    <Box mb="md">
      <Group justify="end">
        <Group gap="xl">
          <Group gap="xs">
            <Stack gap={0} align="flex-end">
              <Text size="xs" fw={700} c="dimmed">TARGET WEEK</Text>
              <Select
                data={meta?.ActiveWeeks || [currentWeekId]}
                value={currentWeekId}
                onChange={(val) => val && setCurrentWeekId(val)}
                size="xs"
                variant="filled"
                style={{ width: 140 }}
                styles={{ input: { fontWeight: 800 } }}
              />
            </Stack>
            <Stack gap={0} align="flex-end">
              <Text size="xs" fw={700} c="dimmed">PROCESS AREA</Text>
              <Select
                data={processes}
                value={processName}
                onChange={(val) => val && setProcessName(val)}
                size="xs"
                variant="filled"
                style={{ width: 180 }}
                styles={{ input: { fontWeight: 800 } }}
              />
            </Stack>
          </Group>

          <Divider orientation="vertical" />

          <Group gap="xs">
            <Stack gap={0} align="flex-end">
              <Text size="12px" fw={800} c="dimmed">LINE LOAD</Text>
              <Group gap={6}>
                <Text size="lg" fw={900} c="indigo.9">{aggregateStats.totalLoad.toFixed(1)}h</Text>
                <Text size="xs" c="dimmed" fw={700}>/ {aggregateStats.totalCapacity.toFixed(0)}h</Text>
              </Group>
            </Stack>
            <Stack gap={2} w={120}>
              <Group justify="space-between" gap={0}>
                <Text size="12px" fw={800} c="indigo.7">UTILIZATION</Text>
                <Text size="12px" fw={800} c={aggregateStats.utilization > 100 ? 'red.7' : 'indigo.7'}>
                  {aggregateStats.utilization.toFixed(1)}%
                </Text>
              </Group>
              <Box style={{ height: 6, borderRadius: 3, backgroundColor: 'var(--mantine-color-gray-2)', overflow: 'hidden' }}>
                <Box style={{
                  height: '100%',
                  width: `${Math.min(aggregateStats.utilization, 100)}%`,
                  backgroundColor: aggregateStats.utilization > 100 ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-indigo-6)',
                  transition: 'width 0.3s'
                }} />
              </Box>
            </Stack>
          </Group>

          <Group gap="xs">
            <Button
              variant="light"
              color="indigo"
              size="sm"
              onClick={handleGenerateChangeover}
              leftSection={<IconFileExport size={16} />}
            >
              Generate Changeover Schedule
            </Button>
            <Button
              variant="light"
              color="blue"
              size="sm"
              disabled={isSubmitting || isAutoScheduling || dataUnassignedLength === 0}
              loading={isAutoScheduling}
              onClick={handleAutoSchedule}
              leftSection={<IconBolt size={16} />}
            >
              Auto-Schedule
            </Button>
            <Button 
              variant="light" 
              color="gray" 
              size="sm" 
              disabled={isSubmitting || isClearing || (!dirty && !hasScheduledJobs)} 
              onClick={() => setClearModalOpened(true)}
            >
              Reset Schedule
            </Button>
            <Button variant="filled" color="indigo" size="sm" disabled={!dirty || isSubmitting} loading={isSubmitting} onClick={handleSubmit} leftSection={<IconBolt size={16} />}>Submit Schedule</Button>
            <Button 
              variant="outline" 
              color="teal" 
              size="sm" 
              disabled={!wasSubmitted || isSubmitting} 
              onClick={async () => {
                 try {
                   const store = await load("store.json", { autoSave: false, defaults: {} });
                   const connectionString = await store.get<string>("db_connection_string");
                   if (!connectionString) return;
                   const data: any[] = await invoke('get_schedule_comparison', { connectionString, weekId: currentWeekId, department: processName });
                   setComparisonData(data);
                   setComparisonModalOpened(true);
                 } catch (e: any) {
                   notifications.show({ title: 'Failed to fetch comparison', message: e.toString(), color: 'red' });
                 }
              }}
            >
              Compare to Original Plan
            </Button>
          </Group>
        </Group>
      </Group>
    </Box>
  );
}
