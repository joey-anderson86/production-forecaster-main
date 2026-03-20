'use client';

import React, { useState, useEffect } from 'react';
import { 
  Modal, 
  Button, 
  Group, 
  NumberInput, 
  TextInput, 
  Stack, 
  Text,
  Divider
} from '@mantine/core';
import { useScorecardStore, DayOfWeek, DailyScorecardRecord } from '@/lib/scorecardStore';
import { invoke } from '@tauri-apps/api/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconX } from '@tabler/icons-react';

interface EditEntryModalProps {
  opened: boolean;
  onClose: () => void;
  departmentName: string;
  weekId: string;
  weekLabel: string;
  partNumber: string;
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
  dayOfWeek,
  initialData
}: EditEntryModalProps) {
  const [target, setTarget] = useState<number | string>(initialData.target ?? '');
  const [actual, setActual] = useState<number | string>(initialData.actual ?? '');
  const [reasonCode, setReasonCode] = useState(initialData.reasonCode || '');
  const [isSaving, setIsSaving] = useState(false);

  const updateStore = useScorecardStore((state) => state.updateDailyRecord);
  const syncFilePath = useScorecardStore((state) => state.syncFilePath);

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

      // 1. Update CSV via Rust if sync path exists
      if (syncFilePath) {
        await invoke('update_csv_entry', {
          filePath: syncFilePath,
          department: departmentName,
          weekLabel: weekLabel,
          partNumber: partNumber,
          dayOfWeek: dayOfWeek,
          newTarget: targetVal,
          newActual: actualVal,
          newReason: reasonCode
        });
      }

      // 2. Update Zustand store (UI updates immediately)
      // Note: We update individual fields
      updateStore(departmentName, weekId, partNumber, dayOfWeek, 'target', targetVal);
      updateStore(departmentName, weekId, partNumber, dayOfWeek, 'actual', actualVal);
      updateStore(departmentName, weekId, partNumber, dayOfWeek, 'reasonCode', reasonCode);

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
      title={<Text fw={700}>Edit Production Entry</Text>}
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

        <TextInput
          label="Reason for Variance"
          placeholder="e.g. Machine downtime, quality issue..."
          value={reasonCode}
          onChange={(event) => setReasonCode(event.currentTarget.value)}
          description={(actual !== '' && target !== '' && Number(actual) < Number(target)) ? "Reason is required for misses" : undefined}
        />

        <Group justify="flex-end" mt="xl">
          <Button variant="default" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button 
            onClick={handleSave} 
            loading={isSaving}
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

// Helper to keep the file clean
import { Box } from '@mantine/core';
