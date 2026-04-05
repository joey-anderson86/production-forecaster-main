'use client';

import React, { useState, useEffect } from 'react';
import { 
  Modal, 
  Button, 
  Group, 
  NumberInput, 
  Stack, 
  Text,
  Divider,
  Box,
  Badge,
  TextInput,
  Select
} from '@mantine/core';
import { useScorecardStore, DayOfWeek, DailyScorecardRecord } from '@/lib/scorecardStore';
import { REASON_CODES } from './ShiftProductionEntryModal';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconX } from '@tabler/icons-react';

interface EditEntryModalProps {
  opened: boolean;
  onClose: () => void;
  departmentName: string;
  weekId: string;
  weekLabel: string;
  partNumber: string;
  shift: string;
  rowId: string;
  dayOfWeek: DayOfWeek;
  initialData: DailyScorecardRecord;
}

export function EditEntryModal({
  opened,
  onClose,
  departmentName,
  weekId,
  weekLabel,
  partNumber,
  shift,
  rowId,
  dayOfWeek,
  initialData
}: EditEntryModalProps) {
  const [target, setTarget] = useState<number | string>(initialData.target ?? '');
  const [actual, setActual] = useState<number | string>(initialData.actual ?? '');
  const [reasonCode, setReasonCode] = useState<string>(initialData.reasonCode || '');
  const [isSaving, setIsSaving] = useState(false);

  const updateStore = useScorecardStore((state) => state.updateDailyRecord);
  const syncToDb = useScorecardStore((state) => state.syncToDb);
  const [connectionString, setConnectionString] = useState<string | null>(null);

  useEffect(() => {
    async function getConn() {
      const { load } = await import('@tauri-apps/plugin-store');
      const store = await load("store.json", { autoSave: false, defaults: {} });
      const val = await store.get<string>("db_connection_string");
      setConnectionString(val || null);
    }
    getConn();
  }, []);

  // Reset local state when initialData changes or modal opens
  useEffect(() => {
    if (opened) {
      setTarget(initialData.target ?? '');
      setActual(initialData.actual ?? '');
      setReasonCode(initialData.reasonCode || '');
    }
  }, [opened, initialData]);

  const handleSave = async () => {
    // Basic validation
    if (typeof target === 'number' && target < 0) {
      notifications.show({ title: 'Invalid Input', message: 'Target cannot be negative', color: 'red' });
      return;
    }
    if (typeof actual === 'number' && actual < 0) {
      notifications.show({ title: 'Invalid Input', message: 'Actual cannot be negative', color: 'red' });
      return;
    }

    setIsSaving(true);

    try {
      const targetVal = target === '' ? null : Number(target);
      const actualVal = actual === '' ? null : Number(actual);

      // 1. Update Zustand store (UI updates immediately)
      updateStore(departmentName, weekId, rowId, dayOfWeek, 'target', targetVal);
      updateStore(departmentName, weekId, rowId, dayOfWeek, 'actual', actualVal);
      updateStore(departmentName, weekId, rowId, dayOfWeek, 'reasonCode', reasonCode.trim() || null);

      // 2. Sync to DB if connection is available
      if (connectionString) {
        await syncToDb(connectionString);
      }

      notifications.show({
        title: 'Success',
        message: 'Entry updated successfully',
        color: 'green',
        icon: <IconDeviceFloppy size={18} />
      });
      onClose();
    } catch (error: any) {
      console.error('Failed to update entry:', error);
      notifications.show({
        title: 'Update Failed',
        message: error?.message || String(error),
        color: 'red',
        icon: <IconX size={18} />
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal 
      opened={opened} 
      onClose={onClose} 
      title="Edit Production Entry"
      size="md"
      radius="md"
    >
      <Stack gap="md">
        <Box>
            <Text size="xs" fw={700} c="dimmed">ENTRY DETAILS</Text>
            <Group gap="xs" mt={4}>
                <Text size="sm" fw={600}>{departmentName}</Text>
                <Divider orientation="vertical" />
                <Text size="sm" fw={600}>{weekLabel}</Text>
                <Divider orientation="vertical" />
                <Text size="sm" fw={600}>{partNumber}</Text>
                <Divider orientation="vertical" />
                <Badge variant="light" size="sm">Shift {shift}</Badge>
                <Divider orientation="vertical" />
                <Text size="sm" fw={600}>{dayOfWeek}</Text>
            </Group>
        </Box>

        <Divider />

        <Group grow>
          <NumberInput
            label="Target Production"
            placeholder="Enter target"
            value={target}
            onChange={setTarget}
            min={0}
            allowNegative={false}
            disabled
            variant="filled"
          />
          <NumberInput
            label="Actual Production"
            placeholder="Enter actual"
            value={actual}
            onChange={setActual}
            min={0}
            allowNegative={false}
          />
        </Group>

        <Select
          label="Reason Code"
          placeholder="Select reason for variance..."
          description="Standardized reason required for Pareto analysis"
          data={REASON_CODES}
          value={reasonCode}
          onChange={(val) => setReasonCode(val || '')}
          searchable
          clearable
          error={reasonCode.length > 144 ? 'Reason code cannot exceed 144 characters' : undefined}
        />

        <Group justify="flex-end" mt="xl">
          <Button variant="default" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button 
            onClick={handleSave} 
            loading={isSaving}
            disabled={reasonCode.length > 144}
            leftSection={<IconDeviceFloppy size={18} />}
            color="indigo"
          >
            Save Changes
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
