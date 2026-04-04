'use client';

import React, { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { 
  Table, Select, NumberInput, ActionIcon, Group, Text, 
  Box, Stack, Tooltip, Badge 
} from '@mantine/core';
import { 
  IconTrash, IconAlertCircle, IconCalculator, 
  IconChevronRight, IconChevronDown 
} from '@tabler/icons-react';
import { DayOfWeek, DAYS_OF_WEEK, getWeekDates, isWorkingDay } from '@/lib/dateUtils';
import { PartScorecard, useScorecardStore } from '@/lib/scorecardStore';

interface WeeklyPlanTableProps {
  department: string;
  weekId: string;
  parts: PartScorecard[];
  availableParts: string[];
  onUpdateRecord: (rowId: string, day: DayOfWeek, field: 'target', value: number | null) => void;
  onRemovePart: (rowId: string) => void;
  onUpdatePartIdentity: (rowId: string, updates: { partNumber?: string, shift?: string }) => void;
  onUpdatePartGroupIdentity: (groupId: string, partNumber: string) => void;
  onAddPart: (partNumber: string, shift: string) => void;
  isLoadingParts?: boolean;
}

/**
 * Parent row component showing aggregate sums for a group of shirts.
 */
const ParentRow = ({ 
  partNumber, 
  childRows, 
  isExpanded, 
  availableParts,
  onToggle,
  onUpdatePartGroupIdentity,
  onUpdatePartIdentity
}: { 
  partNumber: string; 
  childRows: PartScorecard[]; 
  isExpanded: boolean; 
  availableParts: string[];
  onToggle: () => void;
  onUpdatePartGroupIdentity: WeeklyPlanTableProps['onUpdatePartGroupIdentity'];
  onUpdatePartIdentity: WeeklyPlanTableProps['onUpdatePartIdentity'];
}) => {
  const dailyTotals = useMemo(() => {
    return DAYS_OF_WEEK.map(day => 
      childRows.reduce((sum, part) => {
        const record = part.dailyRecords.find(r => r.dayOfWeek === day);
        return sum + (record?.target || 0);
      }, 0)
    );
  }, [childRows]);

  const grandTotal = useMemo(() => dailyTotals.reduce((a, b) => a + b, 0), [dailyTotals]);
  
  // Check if this is a "New Batch" (no part number)
  const groupId = childRows[0]?.groupId;
  const isNewBatch = !partNumber;

  return (
    <Table.Tr bg="indigo.0" style={{ cursor: 'pointer' }} onClick={onToggle}>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          <ActionIcon variant="subtle" size="sm" color="indigo" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
          
          {isNewBatch ? (
            <Box onClick={(e) => e.stopPropagation()} style={{ flex: 1, minWidth: 200 }}>
              <Select
                placeholder="Select part for this batch..."
                data={availableParts}
                searchable
                size="xs"
                comboboxProps={{ withinPortal: true }}
                onChange={(val) => {
                  if (!val) return;
                  if (groupId) {
                    onUpdatePartGroupIdentity(groupId, val);
                  } else {
                    // Fallback: This group doesn't have a groupId, update all child rows individually
                    childRows.forEach(row => onUpdatePartIdentity(row.id, { partNumber: val }));
                  }
                }}
                styles={{ 
                  input: { 
                    fontWeight: 700,
                    backgroundColor: 'white',
                    borderColor: 'var(--mantine-color-indigo-2)'
                  } 
                }}
              />
            </Box>
          ) : (
            <Text fw={700} size="sm" c="indigo.9">
              {partNumber || <Text span c="dimmed" fs="italic">Unassigned Part</Text>}
            </Text>
          )}
        </Group>
      </Table.Td>
      <Table.Td ta="center">
        <Badge variant="light" color="indigo" size="sm">ALL SHIFTS</Badge>
      </Table.Td>
      {dailyTotals.map((total, i) => (
        <Table.Td key={i} ta="center" style={{ borderLeft: '1px solid var(--mantine-color-indigo-1)' }}>
          <Text fw={700} size="xs" c={total > 0 ? "indigo.7" : "dimmed"}>
            {total.toLocaleString()}
          </Text>
        </Table.Td>
      ))}
      <Table.Td bg="indigo.1" style={{ borderLeft: '2px solid var(--mantine-color-indigo-2)' }}>
        <Text fw={800} ta="center" size="sm" c="indigo.9">
          {grandTotal.toLocaleString()}
        </Text>
      </Table.Td>
      <Table.Td></Table.Td>
    </Table.Tr>
  );
};

/**
 * Highly optimized individual row component for individual shift data entry.
 */
const PlanRow = memo(({ 
  part, 
  onUpdateRecord, 
  onRemovePart,
  onUpdatePartIdentity,
  weekDates,
  shiftSettings,
}: { 
  part: PartScorecard;
  onUpdateRecord: WeeklyPlanTableProps['onUpdateRecord'];
  onRemovePart: WeeklyPlanTableProps['onRemovePart'];
  onUpdatePartIdentity: WeeklyPlanTableProps['onUpdatePartIdentity'];
  weekDates: Date[];
  shiftSettings: Record<string, string>;
}) => {
  const rowTotal = useMemo(() => {
    return part.dailyRecords.reduce((sum, rec) => sum + (rec.target || 0), 0);
  }, [part.dailyRecords]);

  return (
    <Table.Tr>
      <Table.Td pl={50} style={{ minWidth: 200 }}>
        <Text size="xs" fw={500} c="dimmed">
          {part.partNumber || "Not assigned"}
        </Text>
      </Table.Td>

      <Table.Td style={{ width: 100 }}>
        <Select
          data={['A', 'B', 'C', 'D']}
          value={part.shift}
          placeholder="Shift"
          onChange={(val) => onUpdatePartIdentity(part.id, { shift: val || '' })}
          comboboxProps={{ withinPortal: true }}
          variant="unstyled"
          styles={{ input: { fontWeight: 700, textAlign: 'center', fontSize: '13px' } }}
        />
      </Table.Td>

      {DAYS_OF_WEEK.map((day, idx) => {
        const record = part.dailyRecords.find(r => r.dayOfWeek === day);
        const date = weekDates[idx];
        const isWorking = date ? isWorkingDay(date, shiftSettings[part.shift] || '') : true;
        const isDisabled = !isWorking;

        return (
          <Table.Td 
            key={day} 
            p={0} 
            style={{ 
              borderLeft: '1px solid var(--mantine-color-gray-2)',
              backgroundColor: isDisabled ? 'var(--mantine-color-gray-1)' : 'transparent',
              transition: 'background-color 0.2s ease'
            }}
          >
            <Tooltip 
              label={isDisabled ? `Shift ${part.shift} is OFF on this day` : ""} 
              disabled={!isDisabled}
              position="top"
              withinPortal
            >
              <Box>
                <NumberInput
                  value={record?.target ?? ''}
                  onChange={(val) => onUpdateRecord(part.id, day, 'target', typeof val === 'number' ? val : null)}
                  hideControls
                  variant="unstyled"
                  min={0}
                  placeholder={isDisabled ? "" : "-"}
                  disabled={isDisabled}
                  styles={{ 
                    input: { 
                      textAlign: 'center', 
                      height: 36,
                      fontSize: '13px',
                      fontWeight: isDisabled ? 400 : 500,
                      color: isDisabled ? 'var(--mantine-color-gray-5)' : 'inherit',
                      cursor: isDisabled ? 'not-allowed' : 'text',
                      '&:focus': {
                        backgroundColor: 'var(--mantine-color-indigo-0)',
                      }
                    } 
                  }}
                />
              </Box>
            </Tooltip>
          </Table.Td>
        );
      })}

      <Table.Td bg="gray.0" style={{ borderLeft: '2px solid var(--mantine-color-gray-3)' }}>
        <Text fw={600} ta="center" size="xs" c={rowTotal > 0 ? "indigo.7" : "dimmed"}>
          {rowTotal.toLocaleString()}
        </Text>
      </Table.Td>

      <Table.Td style={{ width: 50 }}>
        <Tooltip label="Remove Row" position="left" withArrow>
          <ActionIcon 
            variant="subtle" 
            color="red" 
            size="sm"
            onClick={() => onRemovePart(part.id)}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Tooltip>
      </Table.Td>
    </Table.Tr>
  );
});

PlanRow.displayName = 'PlanRow';

export default function WeeklyPlanTable({ 
  weekId, 
  parts, 
  availableParts,
  onUpdateRecord,
  onRemovePart,
  onUpdatePartIdentity,
  onUpdatePartGroupIdentity,
}: WeeklyPlanTableProps) {
  
  const shiftSettings = useScorecardStore(state => state.shiftSettings);
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());

  // Group parts by Part Number OR Group ID if part is unassigned
  const groupedParts = useMemo(() => {
    const groups: Record<string, PartScorecard[]> = {};
    parts.forEach(part => {
      const key = part.partNumber || part.groupId || 'Unassigned';
      if (!groups[key]) groups[key] = [];
      groups[key].push(part);
    });
    return groups;
  }, [parts]);

  // Expand new part groups automatically when rows are added
  useEffect(() => {
    const partKeys = Object.keys(groupedParts);
    if (partKeys.length > 0) {
      setExpandedParts(prev => {
        const next = new Set(prev);
        partKeys.forEach(k => {
          if (!prev.has(k)) next.add(k);
        });
        return next;
      });
    }
  }, [Object.keys(groupedParts).length]);

  const toggleExpand = (key: string) => {
    setExpandedParts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const weekDates = useMemo(() => {
    try {
      return getWeekDates(weekId);
    } catch (e) {
      return [];
    }
  }, [weekId]);

  return (
    <Box style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: '8px', overflow: 'hidden' }}>
      <Table 
        verticalSpacing="xs" 
        highlightOnHover 
        withTableBorder
        styles={{ 
          thead: { backgroundColor: 'var(--mantine-color-gray-0)' },
          th: { borderBottom: '2px solid var(--mantine-color-gray-3)' }
        }}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th key="part"><Text size="xs" fw={700} c="dimmed">PART NUMBER</Text></Table.Th>
            <Table.Th key="shift" ta="center"><Text size="xs" fw={700} c="dimmed">SHIFT</Text></Table.Th>
            {DAYS_OF_WEEK.map((day, idx) => {
              const dateStr = weekDates[idx] ? weekDates[idx].toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '';
              return (
                <Table.Th key={day} ta="center" style={{ width: 85 }}>
                  <Stack gap={0} align="center">
                    <Text size="xs" fw={700} c="dimmed">{day.toUpperCase()}</Text>
                    {dateStr && <Text size="10px" c="indigo.4" fw={700}>{dateStr}</Text>}
                  </Stack>
                </Table.Th>
              );
            })}
            <Table.Th key="total" ta="center" bg="gray.1" style={{ width: 90 }}>
              <Group gap={4} justify="center">
                <IconCalculator size={14} />
                <Text size="xs" fw={700}>TOTAL</Text>
              </Group>
            </Table.Th>
            <Table.Th key="actions" style={{ width: 50 }}></Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {Object.entries(groupedParts).map(([groupKey, childRows]) => (
            <React.Fragment key={groupKey}>
              <ParentRow 
                partNumber={childRows[0].partNumber} 
                childRows={childRows} 
                isExpanded={expandedParts.has(groupKey)}
                availableParts={availableParts}
                onToggle={() => toggleExpand(groupKey)}
                onUpdatePartGroupIdentity={onUpdatePartGroupIdentity}
                onUpdatePartIdentity={onUpdatePartIdentity}
              />
              {expandedParts.has(groupKey) && 
                [...childRows]
                  .sort((a, b) => {
                    const order: Record<string, number> = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 };
                    return (order[a.shift] || 99) - (order[b.shift] || 99);
                  })
                  .map((part) => (
                    <PlanRow 
                      key={part.id}
                      part={part}
                      onUpdateRecord={onUpdateRecord}
                      onRemovePart={onRemovePart}
                      onUpdatePartIdentity={onUpdatePartIdentity}
                      weekDates={weekDates}
                      shiftSettings={shiftSettings}
                    />
                  ))
              }
            </React.Fragment>
          ))}

          {parts.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={11} py="xl">
                <Stack align="center" gap="xs">
                  <IconAlertCircle size={32} color="var(--mantine-color-gray-4)" />
                  <Text c="dimmed" size="sm">No parts scheduled for this week. Start by adding a row below.</Text>
                </Stack>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Box>
  );
}
