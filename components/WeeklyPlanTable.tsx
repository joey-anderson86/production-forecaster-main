'use client';

import React, { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { 
  Table, Select, NumberInput, ActionIcon, Group, Text, 
  Box, Stack, Tooltip, Badge, Progress, HoverCard, Divider
} from '@mantine/core';
import { 
  IconTrash, IconAlertCircle, IconCalculator, 
  IconChevronRight, IconChevronDown, IconWand
} from '@tabler/icons-react';
import { DayOfWeek, DAYS_OF_WEEK, getWeekDates, isWorkingDay } from '@/lib/dateUtils';
import { PartScorecard, useScorecardStore } from '@/lib/scorecardStore';

export interface ProcessInfoRecord {
  process: string;
  date: string;
  hoursAvailable: number;
  machineId: string;
}

export interface PartInfoRecord {
  partNumber: string;
  process: string;
  processingTime: number; // Processing time in minutes
}

export interface DailyCapacityMetric {
  totalCapacity: number;
  totalLoad: number;
  utilization: number;
  machineBreakdown: { machineId: string, hours: number }[];
  breakdown: {
    partNumber: string;
    scheduledQty: number;
    processingTimeMin: number;
    calculatedHours: number;
  }[];
}

interface WeeklyPlanTableProps {
  department: string;
  weekId: string;
  parts: PartScorecard[];
  availableParts: string[];
  onUpdateRecord: (rowId: string, day: DayOfWeek, field: 'target', value: number | null) => void;
  onBatchUpdateRecords?: (updates: { rowId: string, day: DayOfWeek, field: 'target' | 'actual', value: number | null }[]) => void;
  onRemovePart: (rowId: string) => void;
  onUpdatePartIdentity: (rowId: string, updates: { partNumber?: string, shift?: string }) => void;
  onUpdatePartGroupIdentity: (groupId: string, partNumber: string) => void;
  onAddPart: (partNumber: string, shift: string) => void;
  isLoadingParts?: boolean;
  processInfo?: ProcessInfoRecord[];
  partInfo?: PartInfoRecord[];
}

export function distributeDemand(
  totalDemand: number, 
  childRows: PartScorecard[], 
  weekDates: Date[], 
  anchorDates: Record<string, string>
) {
  const validSlots: { rowId: string, day: DayOfWeek }[] = [];
  
  // Sort childRows by Shift (A, B, C, D) to ensure consistent ordering per day
  const sortedRows = [...childRows].sort((a, b) => a.shift.localeCompare(b.shift));

  DAYS_OF_WEEK.forEach((day, idx) => {
    const date = weekDates[idx];
    if (!date) return;

    sortedRows.forEach(part => {
      const anchorDate = anchorDates[part.shift] || '';
      if (isWorkingDay(date, anchorDate)) {
        validSlots.push({ rowId: part.id, day });
      }
    });
  });

  if (validSlots.length === 0) return [];

  const baseAmount = Math.floor(totalDemand / validSlots.length);
  const remainder = totalDemand % validSlots.length;

  return validSlots.map((slot, index) => ({
    ...slot,
    value: baseAmount + (index < remainder ? 1 : 0)
  }));
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
  onUpdatePartIdentity,
  onLevelLoad
}: { 
  partNumber: string; 
  childRows: PartScorecard[]; 
  isExpanded: boolean; 
  availableParts: string[];
  onToggle: () => void;
  onUpdatePartGroupIdentity: WeeklyPlanTableProps['onUpdatePartGroupIdentity'];
  onUpdatePartIdentity: WeeklyPlanTableProps['onUpdatePartIdentity'];
  onLevelLoad?: (childRows: PartScorecard[], totalDemand: number) => void;
}) => {
  const [weeklyTarget, setWeeklyTarget] = useState<number | ''>('');
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
      <Table.Td ta="center">
        <Group gap={4} justify="center" wrap="nowrap">
          <NumberInput
            value={weeklyTarget}
            onChange={(val) => setWeeklyTarget(typeof val === 'number' ? val : '')}
            hideControls
            min={0}
            placeholder="Total"
            size="xs"
            styles={{ input: { width: 60, textAlign: 'center', fontWeight: 600 } }}
            onClick={(e) => e.stopPropagation()}
          />
          {onLevelLoad && (
            <Tooltip label="Auto Level Load" withinPortal>
              <ActionIcon 
                variant="light" 
                color="indigo" 
                size="sm"
                onClick={(e) => {
                   e.stopPropagation();
                   if (typeof weeklyTarget === 'number' && weeklyTarget > 0) {
                     onLevelLoad(childRows, weeklyTarget);
                   }
                }}
              >
                <IconWand size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
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
      
      <Table.Td></Table.Td>

      {DAYS_OF_WEEK.map((day, idx) => {
        const record = part.dailyRecords.find(r => r.dayOfWeek === day);
        const date = weekDates[idx];
        const isWorking = date ? isWorkingDay(date, shiftSettings[part.shift] || '') : true;
        const isDisabled = !isWorking;

        const showEmDash = isDisabled && (record?.target === 0 || record?.target === null);

        return (
          <Table.Td 
            key={day} 
            p={0} 
            style={{ 
              borderLeft: '1px solid var(--mantine-color-gray-2)',
              backgroundColor: isDisabled ? 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))' : 'transparent',
              transition: 'background-color 0.2s ease'
            }}
          >
            <Tooltip 
              label={isDisabled ? `Shift ${part.shift} is OFF on this day` : ""} 
              disabled={!isDisabled}
              position="top"
              withinPortal
            >
              <Box style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36 }}>
                {showEmDash ? (
                  <Text c="dimmed" size="sm" fw={400}>—</Text>
                ) : (
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
                        color: isDisabled ? 'inherit' : 'inherit',
                        opacity: isDisabled ? 0.7 : 1,
                        cursor: isDisabled ? 'not-allowed' : 'text',
                        '&:focus': {
                          backgroundColor: 'var(--mantine-color-indigo-0)',
                        }
                      } 
                    }}
                  />
                )}
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
  department,
  weekId, 
  parts, 
  availableParts,
  onUpdateRecord,
  onBatchUpdateRecords,
  onRemovePart,
  onUpdatePartIdentity,
  onUpdatePartGroupIdentity,
  processInfo,
  partInfo,
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

  const handleLevelLoad = useCallback((childRows: PartScorecard[], totalDemand: number) => {
    const distributions = distributeDemand(totalDemand, childRows, weekDates, shiftSettings);
    if (onBatchUpdateRecords) {
      onBatchUpdateRecords(distributions.map(d => ({ ...d, field: 'target' })));
    }
  }, [weekDates, shiftSettings, onBatchUpdateRecords]);

  const dailyCapacityMetrics = useMemo(() => {
    const capacityData = {
      totalCapacity: 24, // Fallback
      machineBreakdown: [] as { machineId: string, hours: number }[]
    };

    if (processInfo) {
      const uniqueMachines = new Map<string, number>();
      processInfo.forEach(record => {
        if (record.process === department) {
          if (!uniqueMachines.has(record.machineId)) {
            uniqueMachines.set(record.machineId, record.hoursAvailable);
          }
        }
      });

      let totalCapacity = 0;
      const machineBreakdown = Array.from(uniqueMachines.entries()).map(([machineId, hours]) => {
        totalCapacity += hours;
        return { machineId, hours };
      });

      if (totalCapacity > 0) {
        capacityData.totalCapacity = totalCapacity;
        capacityData.machineBreakdown = machineBreakdown;
      }
    }

    const metrics = {} as Record<DayOfWeek, DailyCapacityMetric>;
    DAYS_OF_WEEK.forEach(day => {
      metrics[day] = {
        totalCapacity: capacityData.totalCapacity,
        machineBreakdown: capacityData.machineBreakdown,
        totalLoad: 0,
        utilization: 0,
        breakdown: []
      };
    });

    // Create an O(1) lookup map for Part Processing Times
    const partMap = new Map<string, number>();
    if (partInfo) {
      partInfo.forEach(p => {
        if (p.process === department) {
          partMap.set(p.partNumber, p.processingTime);
        }
      });
    }

    parts.forEach(part => {
      const processingTimeMins = partMap.get(part.partNumber) || 0;
      
      if (processingTimeMins > 0) {
        part.dailyRecords.forEach(record => {
          if (record.target && record.target > 0) {
            const calculatedHours = (record.target * processingTimeMins) / 60;
            metrics[record.dayOfWeek].totalLoad += calculatedHours;
            
            const partName = part.partNumber || 'Unassigned';
            const existingEntry = metrics[record.dayOfWeek].breakdown.find(b => b.partNumber === partName);
            
            if (existingEntry) {
              existingEntry.scheduledQty += record.target;
              existingEntry.calculatedHours += calculatedHours;
            } else {
              metrics[record.dayOfWeek].breakdown.push({
                partNumber: partName,
                scheduledQty: record.target,
                processingTimeMin: processingTimeMins,
                calculatedHours: calculatedHours
              });
            }
          }
        });
      }
    });

    DAYS_OF_WEEK.forEach(day => {
      metrics[day].utilization = capacityData.totalCapacity > 0 ? (metrics[day].totalLoad / capacityData.totalCapacity) * 100 : 0;
    });

    return metrics;
  }, [parts, partInfo, processInfo, department]);

  return (
    <Box style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: '8px', overflow: 'hidden' }}>
      <Box style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        <Table 
          verticalSpacing="xs" 
          highlightOnHover 
          withTableBorder
          styles={{ 
            thead: { 
              backgroundColor: 'var(--mantine-color-gray-0)',
              position: 'sticky',
              top: 0,
              zIndex: 10,
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
            },
            tfoot: {
              backgroundColor: 'var(--mantine-color-gray-0)',
              position: 'sticky',
              bottom: 0,
              zIndex: 10,
              boxShadow: '0 -2px 4px rgba(0,0,0,0.05)'
            },
            th: { borderBottom: '2px solid var(--mantine-color-gray-3)' }
          }}
        >
          <Table.Thead>
          <Table.Tr>
            <Table.Th key="part"><Text size="xs" fw={700} c="dimmed">PART NUMBER</Text></Table.Th>
            <Table.Th key="shift" ta="center"><Text size="xs" fw={700} c="dimmed">SHIFT</Text></Table.Th>
            <Table.Th key="weekly-target" ta="center"><Text size="xs" fw={700} c="dimmed">WEEKLY TARGET</Text></Table.Th>
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
                onLevelLoad={handleLevelLoad}
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

        <Table.Tfoot>
          <Table.Tr bg="gray.0" style={{ borderTop: '2px solid var(--mantine-color-gray-3)' }}>
            <Table.Td colSpan={3}>
              <Group justify="flex-end" px="sm">
                <Text size="xs" fw={800} c="dimmed">DAILY CAPACITY UTILIZATION</Text>
              </Group>
            </Table.Td>
            {DAYS_OF_WEEK.map((day) => {
              const metric = dailyCapacityMetrics[day];
              const utilization = metric.utilization;
              const load = metric.totalLoad;
              
              let color = "teal";
              if (utilization > 100) color = "red";
              else if (utilization >= 80) color = "yellow";

              return (
                <Table.Td key={day} ta="center" p="xs">
                  {metric.totalCapacity > 0 ? (
                    <HoverCard width={280} shadow="md" position="top" withArrow withinPortal>
                      <HoverCard.Target>
                        <Box style={{ cursor: 'pointer' }}>
                          <Stack gap={4} align="center">
                            <Progress 
                              value={Math.min(utilization, 100)} 
                              color={color} 
                              size="md" 
                              radius="xl"
                              w="100%"
                            />
                            <Text size="10px" fw={700} c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                              {load.toFixed(1)}h / {metric.totalCapacity}h
                            </Text>
                          </Stack>
                        </Box>
                      </HoverCard.Target>
                      <HoverCard.Dropdown p="sm">
                        <Stack gap="xs">
                          <Text size="sm" fw={700} style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', paddingBottom: 4 }}>
                            Capacity Breakdown
                          </Text>
                          <Group justify="space-between" mt={4}>
                            <Text size="xs" c="dimmed">Total Available:</Text>
                            <Text size="xs" fw={600}>{metric.totalCapacity}h</Text>
                          </Group>
                          
                          {metric.machineBreakdown.length > 0 && (
                            <Stack gap={2} pl="md" mt={2}>
                              {metric.machineBreakdown.map((machine, idx) => (
                                <Group key={idx} justify="space-between" wrap="nowrap" align="center">
                                  <Text size="xs" c="dimmed" truncate w={100}>
                                    {machine.machineId}
                                  </Text>
                                  <Text size="xs" c="dimmed" fw={500} ta="right" w={40}>
                                    {machine.hours}h
                                  </Text>
                                </Group>
                              ))}
                            </Stack>
                          )}
                          
                          <Divider my={4} color="gray.2" />
                          
                          {metric.breakdown.length > 0 ? (
                            <Stack gap={2} mt={4}>
                              {metric.breakdown.map((b, idx) => (
                                <Group key={idx} justify="space-between" wrap="nowrap" align="center">
                                  <Text size="xs" fw={500} truncate w={80}>
                                    {b.partNumber}
                                  </Text>
                                  <Text size="10px" c="dimmed">
                                    {b.scheduledQty}x {b.processingTimeMin}m
                                  </Text>
                                  <Text size="xs" fw={600} ta="right" w={40}>
                                    {b.calculatedHours.toFixed(1)}h
                                  </Text>
                                </Group>
                              ))}
                            </Stack>
                          ) : (
                            <Text size="xs" c="dimmed" fs="italic" ta="center" py="xs">No parts scheduled</Text>
                          )}
                          
                          <Group justify="space-between" style={{ borderTop: '1px solid var(--mantine-color-gray-2)', paddingTop: 8 }} mt={4}>
                            <Text size="xs" fw={700}>Total Scheduled:</Text>
                            <Text size="xs" fw={800} c={color}>
                              {load.toFixed(1)}h ({utilization.toFixed(1)}%)
                            </Text>
                          </Group>
                        </Stack>
                      </HoverCard.Dropdown>
                    </HoverCard>
                  ) : (
                    <Text size="10px" c="dimmed">—</Text>
                  )}
                </Table.Td>
              );
            })}
            <Table.Td colSpan={2}></Table.Td>
          </Table.Tr>
        </Table.Tfoot>
      </Table>
      </Box>
    </Box>
  );
}
