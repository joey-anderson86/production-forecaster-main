'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Button,
  Group,
  NumberInput,
  TextInput,
  Select,
  Table,
  Stack,
  Text,
  Divider,
  Box,
  Badge,
  ActionIcon,
  Alert,
  Loader,
  Tooltip,
  ScrollArea,
  Card,
  ThemeIcon,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useLocalStorage } from '@mantine/hooks';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
dayjs.extend(isoWeek);
import { notifications } from '@mantine/notifications';
import {
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
  IconClipboardList,
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconSearch,
} from '@tabler/icons-react';
import { useScorecardStore } from '@/lib/scorecardStore';
import { useProcessStore } from '@/lib/processStore';
import { isWorkingDay, getWeekIdentifier, getDayOfWeekLabel, getWeekDates } from '@/lib/dateUtils';
import { useReasonCodes } from '@/lib/hooks/useReasonCodes';

// ─── Type Interfaces ───────────────────────────────────────────────

/** Mirrors the PlanRow returned from the Rust backend */
interface PlanRow {
  date: string | null;
  partNumber: string | null;
  partName: string | null;
  process: string | null;
  qty: number | null;
  actual: number | null;
  shift: string | null;
  weekIdentifier: string | null;
  dayOfWeek: string | null;
  reasonCode: string | null;
}

/** Internal state for each row in the shift production table */
interface ShiftProductionEntry {
  id: string;               // unique key for React list rendering
  partNumber: string;
  partName: string;
  target: number;            // planned Qty (0 for unplanned)
  actual: number | '';       // supervisor input
  reasonCode: string;        // required when actual < target or unplanned
  isUnplanned: boolean;
}

/** Payload shape sent to submit_shift_production */
interface ShiftProductionPayload {
  date: string;
  department: string;
  weekIdentifier: string;
  partNumber: string;
  dayOfWeek: string;
  target: number | null;
  actual: number | null;
  shift: string;
  reasonCode: string | null;
}

// ─── Props ─────────────────────────────────────────────────────────

interface ShiftProductionEntryModalProps {
  opened: boolean;
  onClose: () => void;
  /** Called after successful submission so the parent can refresh data */
  onSuccess?: () => void;
}

// ─── Constants ─────────────────────────────────────────────────────

const SHIFTS = [
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// Deprecated static REASON_CODES removed in favor of useReasonCodes hook

// ─── Utility Functions ─────────────────────────────────────────────

/** Convert a Date to "YYYY-MM-DD" string */
function toISODateString(date: Date | string): string {
  return dayjs(date).format('YYYY-MM-DD');
}

/** Get day-of-week label (e.g. "Mon") from a Date */
function getDayOfWeek(date: Date | string): string {
  return getDayOfWeekLabel(dayjs(date).toDate());
}

/** Get ISO-8601 week identifier "YYYY-wWW" from a Date */
function getWeekIdentifierLocal(date: Date | string): string {
  return getWeekIdentifier(dayjs(date).toDate());
}

/** Generate a unique id */
let _entryIdCounter = 0;
function nextEntryId(): string {
  return `entry-${Date.now()}-${++_entryIdCounter}`;
}

// ─── Component ─────────────────────────────────────────────────────

export function ShiftProductionEntryModal({
  opened,
  onClose,
  onSuccess,
}: ShiftProductionEntryModalProps) {
  // ── Selector State ──
  const processes = useProcessStore((s) => s.processes);
  const shiftSettings = useScorecardStore((s) => s.shiftSettings);
  
  // Retrieve the global active week from local storage
  const [activeWeekId] = useLocalStorage<string | null>({
    key: 'production-planner-selected-week',
    defaultValue: null,
  });

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedShift, setSelectedShift] = useState<string | null>(null);

  // ── Data State ──
  const [entries, setEntries] = useState<ShiftProductionEntry[]>([]);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);

  // ── Dynamic Reason Codes ──
  const { data: reasonCodes, isLoading: isReasonCodesLoading } = useReasonCodes(selectedDept);

  // ── Unplanned Part Picker ──
  const [allPartNumbers, setAllPartNumbers] = useState<string[]>([]);
  const [isLoadingParts, setIsLoadingParts] = useState(false);
  const [unplannedPartValue, setUnplannedPartValue] = useState<string | null>(null);

  // ── Submission ──
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Connection String ──
  const [connectionString, setConnectionString] = useState<string | null>(null);

  const syncToDb = useScorecardStore((s) => s.syncToDb);
  const fetchFromDb = useScorecardStore((s) => s.fetchFromDb);

  // ── Calculate Week Boundaries ──
  const weekRange = React.useMemo(() => {
    if (!activeWeekId) return null;
    try {
      const dates = getWeekDates(activeWeekId);
      if (dates.length === 0) return null;
      // Start is Monday, end is Sunday
      const start = dayjs(dates[0]).startOf('day');
      const end = dayjs(dates[6]).endOf('day');
      return { start, end };
    } catch (e) {
      return null;
    }
  }, [activeWeekId]);

  // ── Date Filtering Logic ──
  const shouldExcludeDate = React.useCallback((date: any) => {
    const d = dayjs(date);
    // 1. Must be within the active week
    if (!weekRange) return true;
    const isOutsideWeek = d.isBefore(weekRange.start, 'day') || d.isAfter(weekRange.end, 'day');
    if (isOutsideWeek) return true;

    // 2. Must be a working day for the selected shift
    if (selectedShift && shiftSettings[selectedShift]) {
      return !isWorkingDay(d.toDate(), shiftSettings[selectedShift]);
    }

    return false;
  }, [weekRange, selectedShift, shiftSettings]);

  // Load connection string on mount
  useEffect(() => {
    async function loadConn() {
      try {
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load('store.json', { autoSave: false, defaults: {} });
        const val = await store.get<string>('db_connection_string');
        setConnectionString(val || null);
      } catch (err) {
        console.error('Failed to load connection string:', err);
      }
    }
    if (opened) loadConn();
  }, [opened]);

  // Reset state when modal opens
  useEffect(() => {
    if (opened) {
      setEntries([]);
      setPlanLoaded(false);
      setUnplannedPartValue(null);
    }
  }, [opened]);

  // ── Load Plan Data ──
  const handleLoadPlan = useCallback(async () => {
    if (!selectedDate || !selectedDept || !selectedShift) {
      notifications.show({
        title: 'Missing Fields',
        message: 'Please select Date, Department, and Shift before loading the plan.',
        color: 'orange',
      });
      return;
    }
    if (!connectionString) {
      notifications.show({
        title: 'Configuration Missing',
        message: 'Please set up your database connection string in Settings.',
        color: 'red',
      });
      return;
    }

    setIsLoadingPlan(true);
    setIsLoadingPlan(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const dateStr = dayjs(selectedDate).format('YYYY-MM-DD');

      const planRows = await invoke<PlanRow[]>('get_plan_data_for_shift', {
        connectionString,
        date: dateStr,
        process: selectedDept,
        shift: selectedShift,
      });

      const newEntries: ShiftProductionEntry[] = planRows.map((row) => ({
        id: nextEntryId(),
        partNumber: row.partNumber?.trim() || 'UNKNOWN',
        partName: row.partName?.trim() || '',
        target: row.qty ?? 0,
        actual: row.actual !== null && row.actual !== undefined ? row.actual : '',
        reasonCode: row.reasonCode?.trim() || '',
        isUnplanned: false,
      }));

      setEntries(newEntries);
      setPlanLoaded(true);

      if (newEntries.length === 0) {
        notifications.show({
          title: 'No Plan Data',
          message: `No planned production found for ${selectedDept} on ${dateStr} (Shift ${selectedShift}).`,
          color: 'yellow',
        });
      } else {
        notifications.show({
          title: 'Plan Loaded',
          message: `${newEntries.length} planned part(s) loaded.`,
          color: 'teal',
        });
      }
    } catch (err: any) {
      console.error('Failed to load plan:', err);
      notifications.show({
        title: 'Load Failed',
        message: typeof err === 'string' ? err : err?.message || 'Unknown error',
        color: 'red',
      });
    } finally {
      setIsLoadingPlan(false);
    }
  }, [selectedDate, selectedDept, selectedShift, connectionString]);

  // ── Fetch Part Numbers for Unplanned ──
  const handleLoadPartNumbers = useCallback(async () => {
    if (allPartNumbers.length > 0) return; // already loaded
    if (!connectionString) return;

    setIsLoadingParts(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const parts = await invoke<string[]>('get_all_part_numbers', { connectionString });
      setAllPartNumbers(parts);
    } catch (err: any) {
      console.error('Failed to load part numbers:', err);
    } finally {
      setIsLoadingParts(false);
    }
  }, [connectionString, allPartNumbers.length]);

  // ── Entry Update Handlers ──
  const updateEntry = (id: string, field: keyof ShiftProductionEntry, value: any) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  // ── Add Unplanned Part ──
  const handleAddUnplanned = () => {
    if (!unplannedPartValue) {
      notifications.show({
        title: 'Select Part',
        message: 'Please select a part number to add.',
        color: 'orange',
      });
      return;
    }

    // Prevent duplicates
    if (entries.some((e) => e.partNumber === unplannedPartValue)) {
      notifications.show({
        title: 'Duplicate Entry',
        message: `${unplannedPartValue} is already in the list.`,
        color: 'orange',
      });
      return;
    }

    setEntries((prev) => [
      ...prev,
      {
        id: nextEntryId(),
        partNumber: unplannedPartValue,
        partName: '',
        target: 0,
        actual: '',
        reasonCode: '',
        isUnplanned: true,
      },
    ]);
    setUnplannedPartValue(null);
  };

  // ── Validation ──
  const getValidationErrors = (): string[] => {
    const errors: string[] = [];

    entries.forEach((entry, idx) => {
      const label = `Row ${idx + 1} (${entry.partNumber})`;

      if (entry.actual === '' || entry.actual === null || entry.actual === undefined) {
        errors.push(`${label}: Actual quantity is required.`);
        return;
      }

      const actualNum = Number(entry.actual);
      if (isNaN(actualNum) || actualNum < 0) {
        errors.push(`${label}: Actual must be a non-negative number.`);
        return;
      }

      const needsReason = actualNum < entry.target || entry.isUnplanned;
      if (needsReason && !entry.reasonCode.trim()) {
        errors.push(`${label}: Reason Code is required when actual < target or part is unplanned.`);
      }
    });

    return errors;
  };

  // ── Submission ──
  const handleSubmit = async () => {
    if (entries.length === 0) {
      notifications.show({
        title: 'No Entries',
        message: 'There are no entries to submit.',
        color: 'orange',
      });
      return;
    }

    const errors = getValidationErrors();
    if (errors.length > 0) {
      notifications.show({
        title: 'Validation Failed',
        message: errors[0], // show first error
        color: 'red',
      });
      return;
    }

    if (!connectionString || !selectedDate || !selectedDept || !selectedShift) {
      notifications.show({
        title: 'Missing Configuration',
        message: 'Connection string or form fields are missing.',
        color: 'red',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const dateStr = dayjs(selectedDate).format('YYYY-MM-DD');
      const parsedDate = selectedDate!;
      const weekId = getWeekIdentifierLocal(parsedDate);
      const dayOfWeek = getDayOfWeek(parsedDate);

      const payload: ShiftProductionPayload[] = entries.map((entry) => ({
        date: dateStr,
        department: selectedDept!,
        weekIdentifier: weekId,
        partNumber: entry.partNumber,
        dayOfWeek,
        target: entry.target,
        actual: typeof entry.actual === 'number' ? entry.actual : 0,
        shift: selectedShift!,
        reasonCode: entry.reasonCode.trim() || null,
      }));

      await invoke('submit_shift_production', {
        connectionString,
        records: payload,
      });

      // Refresh scorecard store if possible
      try {
        await fetchFromDb(connectionString);
      } catch {
        // Non-fatal — scorecard refresh can fail silently
      }

      notifications.show({
        title: 'Production Recorded',
        message: `${payload.length} entries saved for ${selectedDept} — ${dateStr} (Shift ${selectedShift}).`,
        color: 'green',
        icon: <IconCheck size={18} />,
      });

      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Submit failed:', err);
      notifications.show({
        title: 'Submission Failed',
        message: typeof err === 'string' ? err : err?.message || 'Unknown error',
        color: 'red',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Derived State ──
  const canLoadPlan = !!selectedDate && !!selectedDept && !!selectedShift;
  const parsedDateForDisplay = selectedDate;
  const totalTarget = entries.reduce((sum, e) => sum + e.target, 0);
  const totalActual = entries.reduce((sum, e) => {
    const val = typeof e.actual === 'number' ? e.actual : 0;
    return sum + val;
  }, 0);
  const totalVariance = totalActual - totalTarget;

  // ── Render ──
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon variant="light" color="indigo" size="md">
            <IconClipboardList size={18} />
          </ThemeIcon>
          <Text fw={700} size="lg">
            Shift Production Entry
          </Text>
        </Group>
      }
      size="xl"
      radius="md"
      centered
      closeOnClickOutside={false}
      styles={{
        body: { padding: '0 24px 24px 24px' },
      }}
    >
      <Stack gap="lg" mt="sm">
        {/* ─── Step 1: Selectors ─── */}
        <Card withBorder radius="md" p="md" bg="gray.0">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="sm">
            Step 1 — Select Shift Parameters
          </Text>
          <Group grow align="flex-end">
            <Select
              label="Shift"
              placeholder="Select shift first"
              data={SHIFTS}
              value={selectedShift}
              onChange={(val) => {
                setSelectedShift(val);
                setSelectedDate(null); // Reset date when shift changes to force re-validation
                setPlanLoaded(false);
                setEntries([]);
              }}
              size="sm"
            />
            <DatePickerInput
              label="Production Date"
              placeholder={selectedShift ? "Pick a working day" : "Select shift first"}
              value={selectedDate}
              onChange={(val) => {
                setSelectedDate(val as Date | null);
                setPlanLoaded(false);
                setEntries([]);
              }}
              disabled={!selectedShift}
              excludeDate={shouldExcludeDate as any}
              maxDate={new Date()}
              size="sm"
              valueFormat="YYYY-MM-DD"
              clearable
              allowDeselect={false}
              leftSection={<IconClipboardList size={16} stroke={1.5} />}
            />
            <Select
              label="Department"
              placeholder="Select department"
              data={processes}
              value={selectedDept}
              onChange={(val) => {
                setSelectedDept(val);
                setPlanLoaded(false);
                setEntries([]);
              }}
              size="sm"
              searchable
            />
          </Group>
          <Button
            fullWidth
            mt="md"
            variant="filled"
            color="indigo"
            leftSection={<IconDownload size={16} />}
            onClick={handleLoadPlan}
            loading={isLoadingPlan}
            disabled={!canLoadPlan}
          >
            Load Production Plan
          </Button>
        </Card>

        {/* ─── Computed Fields Preview ─── */}
        {planLoaded && parsedDateForDisplay && (
          <Group gap="lg">
            <Badge variant="light" color="indigo" size="lg">
              Week: {getWeekIdentifierLocal(parsedDateForDisplay)}
            </Badge>
            <Badge variant="light" color="blue" size="lg">
              Day: {getDayOfWeek(parsedDateForDisplay)}
            </Badge>
            <Badge variant="light" color="violet" size="lg">
              {entries.filter((e) => !e.isUnplanned).length} Planned ·{' '}
              {entries.filter((e) => e.isUnplanned).length} Unplanned
            </Badge>
          </Group>
        )}

        {/* ─── Step 2: Entries Table ─── */}
        {planLoaded && (
          <Card withBorder radius="md" p="md">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="sm">
              Step 2 — Enter Actual Production
            </Text>

            {entries.length > 0 ? (
              <ScrollArea>
                <Table
                  verticalSpacing="sm"
                  horizontalSpacing="md"
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        <Text size="xs" fw={700} c="dimmed">PART NUMBER</Text>
                      </Table.Th>
                      <Table.Th>
                        <Text size="xs" fw={700} c="dimmed">PART NAME</Text>
                      </Table.Th>
                      <Table.Th ta="center">
                        <Text size="xs" fw={700} c="dimmed">TARGET</Text>
                      </Table.Th>
                      <Table.Th ta="center" miw={100}>
                        <Text size="xs" fw={700} c="dimmed">ACTUAL</Text>
                      </Table.Th>
                      <Table.Th miw={180}>
                        <Text size="xs" fw={700} c="dimmed">REASON CODE</Text>
                      </Table.Th>
                      <Table.Th ta="center" w={50}>
                        <Text size="xs" fw={700} c="dimmed"></Text>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {entries.map((entry) => {
                      const actualNum = typeof entry.actual === 'number' ? entry.actual : null;
                      const needsReason =
                        (actualNum !== null && actualNum < entry.target) || entry.isUnplanned;
                      const variance =
                        actualNum !== null ? actualNum - entry.target : null;

                      return (
                        <Table.Tr key={entry.id}>
                          <Table.Td>
                            <Group gap="xs" wrap="nowrap">
                              <Text size="sm" fw={600}>
                                {entry.partNumber}
                              </Text>
                              {entry.isUnplanned && (
                                <Badge size="xs" variant="light" color="orange">
                                  Unplanned
                                </Badge>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              {entry.partName || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="center">
                            <Text size="sm" fw={600}>
                              {entry.target}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <NumberInput
                              value={entry.actual}
                              onChange={(val) => updateEntry(entry.id, 'actual', val)}
                              min={0}
                              allowNegative={false}
                              hideControls
                              size="sm"
                              placeholder="0"
                              styles={{
                                input: {
                                  textAlign: 'center',
                                  fontWeight: 600,
                                  ...(variance !== null && variance < 0
                                    ? { color: 'var(--mantine-color-red-7)', backgroundColor: 'var(--mantine-color-red-0)' }
                                    : variance !== null && variance >= 0
                                      ? { color: 'var(--mantine-color-green-7)', backgroundColor: 'var(--mantine-color-green-0)' }
                                      : {}),
                                },
                              }}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Select
                              value={entry.reasonCode}
                              onChange={(val) => updateEntry(entry.id, 'reasonCode', val || '')}
                              data={reasonCodes.length > 0 ? reasonCodes : []}
                              placeholder={
                                isReasonCodesLoading 
                                  ? "Loading..." 
                                  : reasonCodes.length === 0 
                                    ? "No codes configured" 
                                    : needsReason 
                                      ? "Select reason..." 
                                      : "Optional"
                              }
                              size="sm"
                              searchable
                              clearable
                              error={needsReason && !entry.reasonCode.trim() ? 'Required' : undefined}
                              disabled={(!needsReason && entry.target > 0) || isReasonCodesLoading || reasonCodes.length === 0}
                              rightSection={isReasonCodesLoading ? <Loader size="xs" /> : undefined}
                              leftSection={
                                needsReason ? (
                                  <IconAlertTriangle
                                    size={14}
                                    color="var(--mantine-color-orange-6)"
                                  />
                                ) : undefined
                              }
                              styles={{
                                input: !needsReason ? { backgroundColor: 'transparent', border: '1px dashed var(--mantine-color-gray-3)' } : {}
                              }}
                            />
                          </Table.Td>
                          <Table.Td ta="center">
                            {entry.isUnplanned && (
                              <Tooltip label="Remove unplanned part">
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  size="sm"
                                  onClick={() => removeEntry(entry.id)}
                                >
                                  <IconTrash size={14} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            ) : (
              <Alert
                variant="light"
                color="yellow"
                title="No Planned Parts Found"
                icon={<IconAlertTriangle size={18} />}
              >
                No production was planned for this shift. You can still add unplanned parts below.
              </Alert>
            )}

            {/* ─── Summary Strip ─── */}
            {entries.length > 0 && (
              <Group justify="flex-end" mt="sm" gap="lg">
                <Group gap="xs">
                  <Text size="xs" fw={700} c="dimmed">
                    TOTAL TARGET:
                  </Text>
                  <Text size="sm" fw={700}>
                    {totalTarget}
                  </Text>
                </Group>
                <Group gap="xs">
                  <Text size="xs" fw={700} c="dimmed">
                    TOTAL ACTUAL:
                  </Text>
                  <Text size="sm" fw={700}>
                    {totalActual}
                  </Text>
                </Group>
                <Group gap="xs">
                  <Text size="xs" fw={700} c="dimmed">
                    VARIANCE:
                  </Text>
                  <Text
                    size="sm"
                    fw={700}
                    c={totalVariance < 0 ? 'red.7' : 'green.7'}
                  >
                    {totalVariance > 0 ? `+${totalVariance}` : totalVariance}
                  </Text>
                </Group>
              </Group>
            )}
          </Card>
        )}

        {/* ─── Step 3: Add Unplanned Part ─── */}
        {planLoaded && (
          <Card withBorder radius="md" p="md" bg="orange.0">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb="sm">
              Add Unplanned Part (Optional)
            </Text>
            <Group align="flex-end">
              <Select
                label="Part Number"
                placeholder="Search part numbers..."
                data={allPartNumbers.map((p) => ({ value: p, label: p }))}
                value={unplannedPartValue}
                onChange={setUnplannedPartValue}
                searchable
                clearable
                nothingFoundMessage="No parts found"
                onDropdownOpen={handleLoadPartNumbers}
                rightSection={isLoadingParts ? <Loader size={14} /> : <IconSearch size={14} />}
                className="flex-1"
                size="sm"
              />
              <Button
                variant="light"
                color="orange"
                leftSection={<IconPlus size={16} />}
                onClick={handleAddUnplanned}
                size="sm"
                disabled={!unplannedPartValue}
              >
                Add Part
              </Button>
            </Group>
          </Card>
        )}

        {/* ─── Actions ─── */}
        {planLoaded && (
          <>
            <Divider />
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                loading={isSubmitting}
                leftSection={<IconDeviceFloppy size={18} />}
                color="indigo"
                disabled={entries.length === 0}
              >
                Submit Production Data
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
