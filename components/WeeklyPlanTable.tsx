'use client';

import React, { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { 
  Table, Select, NumberInput, ActionIcon, Group, Text, 
  Box, Stack, Tooltip, Badge, Progress, HoverCard, Divider, useMantineTheme, rgba
} from '@mantine/core';
import { 
  IconTrash, IconAlertCircle, IconCalculator, 
  IconChevronRight, IconChevronDown, IconWand
} from '@tabler/icons-react';
import { DayOfWeek, DAYS_OF_WEEK, getWeekDates, isWorkingDay, formatISODate, generateWeekLabel } from '@/lib/dateUtils';
import { PartScorecard, useScorecardStore } from '@/lib/scorecardStore';
import { ProductionDisplayUnit } from '@/hooks/useProductionDisplayUnit';

export interface ProcessInfoRecord {
  process: string;
  date: string;
  hoursAvailable: number;
  machineId: string;
  shift: string;
}

export interface PartInfoRecord {
  partNumber: string;
  process: string;
  processingTime: number; // Processing time in minutes
  batchSize?: number;
}

export interface ShiftMetric {
  load: number;
  capacity: number;
  isOver: boolean;
  isWorking: boolean;
  breakdown: {
    partNumber: string;
    scheduledQty: number;
    processingTimeMin: number;
    calculatedHours: number;
  }[];
}

export interface DailyCapacityMetric {
  totalCapacity: number;
  totalLoad: number;
  utilization: number;
  machineBreakdown: { machineId: string, hours: number }[];
  shiftBreakdown: Record<string, ShiftMetric>;
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
  onRemovePartGroup: (groupKey: string) => void;
  onUpdatePartIdentity: (rowId: string, updates: { partNumber?: string, shift?: string }) => void;
  onUpdatePartGroupIdentity: (groupId: string, partNumber: string) => void;
  onAddPart: (partNumber: string, shift: string) => void;
  isLoadingParts?: boolean;
  processInfo?: ProcessInfoRecord[];
  partInfo?: PartInfoRecord[];
  displayUnit: ProductionDisplayUnit;
  expandAllSignal?: number;
  collapseAllSignal?: number;
}

// The distributeDemand logic has been moved to Rust for performance and memory optimization.
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
  onLevelLoad,
  onRemovePartGroup,
  displayUnit,
  batchSize,
  isCalculatingDemand,
}: { 
  partNumber: string; 
  childRows: PartScorecard[]; 
  isExpanded: boolean; 
  availableParts: string[];
  onToggle: () => void;
  onUpdatePartGroupIdentity: WeeklyPlanTableProps['onUpdatePartGroupIdentity'];
  onUpdatePartIdentity: WeeklyPlanTableProps['onUpdatePartIdentity'];
  onLevelLoad?: (childRows: PartScorecard[], totalDemand: number) => void;
  onRemovePartGroup: (groupKey: string) => void;
  displayUnit: ProductionDisplayUnit;
  batchSize: number;
  isCalculatingDemand: boolean;
}) => {
  const theme = useMantineTheme();
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

  const displayedDailyTotals = dailyTotals.map(t => displayUnit === 'pieces' ? t * batchSize : t);
  const displayedGrandTotal = displayUnit === 'pieces' ? grandTotal * batchSize : grandTotal;
  
  // Check if this is a "New Batch" (no part number)
  const groupId = childRows[0]?.groupId;
  const isNewBatch = !partNumber;

  return (
    <Table.Tr 
      bg={`light-dark(indigo.0, ${rgba(theme.colors.indigo[9], 0.15)})`} 
      style={{ cursor: 'pointer' }} 
      onClick={onToggle}
    >
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
                    backgroundColor: 'light-dark(white, var(--mantine-color-dark-6))',
                    borderColor: 'light-dark(var(--mantine-color-indigo-2), var(--mantine-color-dark-4))'
                  } 
                }}
              />
            </Box>
          ) : (
            <Text fw={700} size="sm" c="light-dark(indigo.9, indigo.2)">
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
            step={displayUnit === 'pieces' ? batchSize : 1}
            placeholder={displayUnit === 'pieces' ? "Pieces" : "Batches"}
            size="xs"
            styles={{ input: { 
              width: 70, 
              textAlign: 'center', 
              fontWeight: 600,
              backgroundColor: 'light-dark(white, var(--mantine-color-dark-6))',
              borderColor: 'light-dark(var(--mantine-color-gray-4), var(--mantine-color-dark-4))'
            } }}
            onClick={(e) => e.stopPropagation()}
          />
          {onLevelLoad && (
            <Tooltip label="Auto Level Load" withinPortal>
              <ActionIcon 
                variant="light" 
                color="indigo" 
                size="sm"
                loading={isCalculatingDemand}
                disabled={isCalculatingDemand}
                onClick={(e) => {
                   e.stopPropagation();
                   if (typeof weeklyTarget === 'number' && weeklyTarget > 0) {
                     const demandInBatches = displayUnit === 'pieces' ? Math.round(weeklyTarget / batchSize) : weeklyTarget;
                     onLevelLoad(childRows, demandInBatches);
                   }
                }}
              >
                <IconWand size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Table.Td>
      {displayedDailyTotals.map((total, i) => (
        <Table.Td key={i} ta="center" style={{ borderLeft: `1px solid light-dark(var(--mantine-color-indigo-1), var(--mantine-color-dark-5))` }}>
          <Text fw={700} size="xs" c={total > 0 ? "light-dark(indigo.7, indigo.2)" : "dimmed"}>
            {total.toLocaleString()}
          </Text>
        </Table.Td>
      ))}
      <Table.Td bg={`light-dark(indigo.1, ${rgba(theme.colors.indigo[8], 0.1)})`} style={{ borderLeft: `2px solid light-dark(var(--mantine-color-indigo-2), var(--mantine-color-dark-4))` }}>
        <Text fw={800} ta="center" size="sm" c="light-dark(indigo.9, indigo.2)">
          {displayedGrandTotal.toLocaleString()}
        </Text>
      </Table.Td>
        <Table.Td style={{ width: 50 }}>
          <Group justify="center" wrap="nowrap">
            <Tooltip label="Remove Part Group" position="left" withArrow>
              <ActionIcon 
                variant="subtle" 
                color="red" 
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemovePartGroup(partNumber || childRows[0].groupId || 'Unassigned');
                }}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Table.Td>
      </Table.Tr>
    );
  };

/**
 * Highly optimized individual row component for individual shift data entry.
 */
const PlanRow = memo(({ 
  part, 
  onUpdateRecord, 
  onUpdatePartIdentity,
  weekDates,
  shiftSettings,
  displayUnit,
  batchSize,
}: { 
  part: PartScorecard;
  onUpdateRecord: WeeklyPlanTableProps['onUpdateRecord'];
  onUpdatePartIdentity: WeeklyPlanTableProps['onUpdatePartIdentity'];
  weekDates: Date[];
  shiftSettings: Record<string, string>;
  displayUnit: ProductionDisplayUnit;
  batchSize: number;
}) => {
  const theme = useMantineTheme();
  const rowTotal = useMemo(() => {
    return part.dailyRecords.reduce((sum, rec) => sum + (rec.target || 0), 0);
  }, [part.dailyRecords]);

  const displayedRowTotal = displayUnit === 'pieces' ? rowTotal * batchSize : rowTotal;

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
              borderLeft: `1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))`,
              backgroundColor: isDisabled ? 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))' : 'transparent',
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
                    value={record?.target !== null && record?.target !== undefined ? (displayUnit === 'pieces' ? record.target * batchSize : record.target) : ''}
                    onChange={(val) => {
                      if (typeof val === 'number') {
                        const batchVal = displayUnit === 'pieces' ? Math.round(val / batchSize) : val;
                        onUpdateRecord(part.id, day, 'target', batchVal);
                      } else {
                        onUpdateRecord(part.id, day, 'target', null);
                      }
                    }}
                    hideControls
                    variant="unstyled"
                    min={0}
                    step={displayUnit === 'pieces' ? batchSize : 1}
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
                          backgroundColor: 'light-dark(var(--mantine-color-indigo-0), var(--mantine-color-dark-7))',
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

      <Table.Td bg={`light-dark(gray.0, ${rgba(theme.colors.gray[9], 0.1)})`} style={{ borderLeft: `2px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))` }}>
        <Text fw={600} ta="center" size="xs" c={rowTotal > 0 ? "light-dark(indigo.7, indigo.2)" : "dimmed"}>
          {displayedRowTotal.toLocaleString()}
        </Text>
      </Table.Td>

      <Table.Td style={{ width: 50 }} />
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
  onRemovePartGroup,
  onUpdatePartIdentity,
  onUpdatePartGroupIdentity,
  processInfo,
  partInfo,
  displayUnit,
  expandAllSignal,
  collapseAllSignal,
}: WeeklyPlanTableProps) {
  const theme = useMantineTheme();
  
  const shiftSettings = useScorecardStore(state => state.shiftSettings);
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());
  const [isCalculatingDemand, setIsCalculatingDemand] = useState(false);

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

  // Expand All / Collapse All via signal props
  useEffect(() => {
    if (expandAllSignal && expandAllSignal > 0) {
      setExpandedParts(new Set(Object.keys(groupedParts)));
    }
  }, [expandAllSignal]);

  useEffect(() => {
    if (collapseAllSignal && collapseAllSignal > 0) {
      setExpandedParts(new Set());
    }
  }, [collapseAllSignal]);

  const weekDates = useMemo(() => {
    try {
      return getWeekDates(weekId);
    } catch (e) {
      return [];
    }
  }, [weekId]);  const batchSizeMap = useMemo(() => {
    const map = new Map<string, number>();
    if (partInfo) {
      partInfo.forEach(p => {
        if (p.process === department) {
          map.set(p.partNumber, p.batchSize || 1);
        }
      });
    }
    return map;
  }, [partInfo, department]);

  const dailyCapacityMetrics = useMemo(() => {
    const metrics = {} as Record<DayOfWeek, DailyCapacityMetric>;
    
    // Group process info by Date and Shift
    const shiftCapacityMap = new Map<string, Map<string, number>>();
    if (processInfo) {
      processInfo.forEach(record => {
        if (record.process === department && record.date) {
          if (!shiftCapacityMap.has(record.date)) {
            shiftCapacityMap.set(record.date, new Map());
          }
          const shiftMap = shiftCapacityMap.get(record.date)!;
          const shiftKey = record.shift || 'A';
          const currentHours = shiftMap.get(shiftKey) || 0;
          shiftMap.set(shiftKey, currentHours + (record.hoursAvailable || 0));
        }
      });
    }

    DAYS_OF_WEEK.forEach((day, idx) => {
      const date = weekDates[idx];
      const targetDate = date ? formatISODate(date) : '';
      const shiftsOnDate = shiftCapacityMap.get(targetDate);
      
      let totalCapacity = 0;
      const shifts = ['A', 'B', 'C', 'D'];
      const shiftBreakdown: Record<string, ShiftMetric> = {};

      shifts.forEach(s => {
        const capacity = shiftsOnDate?.get(s) || 0;
        totalCapacity += capacity;
        
        shiftBreakdown[s] = {
          load: 0,
          capacity: capacity,
          isOver: false,
          isWorking: date ? isWorkingDay(date, shiftSettings[s] || '') : true,
          breakdown: []
        };
      });

      metrics[day] = {
        totalCapacity,
        machineBreakdown: [], // This was used for per-machine hours, but user example focused on shift
        shiftBreakdown,
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
      const shift = part.shift || 'A';
      
      if (processingTimeMins > 0) {
        part.dailyRecords.forEach(record => {
          if (record.target && record.target > 0) {
            const calculatedHours = (record.target * processingTimeMins) / 60;
            const dayMetric = metrics[record.dayOfWeek];
            
            dayMetric.totalLoad += calculatedHours;
            
            // Add to shift breakdown
            if (dayMetric.shiftBreakdown[shift]) {
              dayMetric.shiftBreakdown[shift].load += calculatedHours;
              
              const partName = part.partNumber || 'Unassigned';
              const existingShiftEntry = dayMetric.shiftBreakdown[shift].breakdown.find(b => b.partNumber === partName);
              
              if (existingShiftEntry) {
                existingShiftEntry.scheduledQty += record.target;
                existingShiftEntry.calculatedHours += calculatedHours;
              } else {
                dayMetric.shiftBreakdown[shift].breakdown.push({
                  partNumber: partName,
                  scheduledQty: record.target,
                  processingTimeMin: processingTimeMins,
                  calculatedHours: calculatedHours
                });
              }
            }
            
            // Still populate the general breakdown for backward compatibility/summary
            const partName = part.partNumber || 'Unassigned';
            const existingEntry = dayMetric.breakdown.find(b => b.partNumber === partName);
            
            if (existingEntry) {
              existingEntry.scheduledQty += record.target;
              existingEntry.calculatedHours += calculatedHours;
            } else {
              dayMetric.breakdown.push({
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
      const metric = metrics[day];
      const load = metric.totalLoad;
      const capacity = metric.totalCapacity;
      
      if (capacity > 0) {
        metric.utilization = (load / capacity) * 100;
      } else {
        metric.utilization = load > 0 ? 101 : 0;
      }

      // Finalize shift over-capacity flags
      Object.keys(metric.shiftBreakdown).forEach(shift => {
        const sMetric = metric.shiftBreakdown[shift];
        // If shift is working but has 0 capacity and >0 load, it's over
        if (sMetric.isWorking && sMetric.capacity === 0 && sMetric.load > 0) {
          sMetric.isOver = true;
        } else if (sMetric.capacity > 0) {
          // Allow 0.01h buffer for rounding
          sMetric.isOver = sMetric.load > (sMetric.capacity + 0.01);
        } else {
          sMetric.isOver = false;
        }
      });
    });

    return metrics;
  }, [parts, partInfo, processInfo, department, weekDates, shiftSettings]);

  const calculatedTotals = useMemo(() => {
    const totals = {
      daily: DAYS_OF_WEEK.map(() => 0),
      grandTotal: 0
    };

    parts.forEach(part => {
      const batchSize = batchSizeMap.get(part.partNumber) || 1;
      const multiplier = displayUnit === 'pieces' ? batchSize : 1;
      
      part.dailyRecords.forEach((record) => {
        const idx = DAYS_OF_WEEK.indexOf(record.dayOfWeek);
        if (idx !== -1) {
          const val = (record.target || 0) * multiplier;
          totals.daily[idx] += val;
          totals.grandTotal += val;
        }
      });
    });

    return totals;
  }, [parts, displayUnit, batchSizeMap]);

  const handleLevelLoad = useCallback(async (childRows: PartScorecard[], totalDemand: number) => {
    setIsCalculatingDemand(true);
    try {
      const partNumber = childRows[0]?.partNumber;
      const processingTimeMin = partInfo?.find(p => p.partNumber === partNumber)?.processingTime || 0;

      const weekDateStrings = weekDates.map(d => d ? formatISODate(d) : null);
      
      const shiftCapacities = weekDates.map((_, idx) => {
        const day = DAYS_OF_WEEK[idx];
        const dayMetric = dailyCapacityMetrics[day];
        const capacities: Record<string, number> = {};
        if (dayMetric) {
          ['A', 'B', 'C', 'D'].forEach(shift => {
             capacities[shift] = dayMetric.shiftBreakdown[shift]?.capacity || 0;
          });
        }
        return capacities;
      });

      const { invoke } = await import('@tauri-apps/api/core');
      const req = {
        totalDemand,
        childRows: childRows.map(r => ({ id: r.id, shift: r.shift })),
        weekDates: weekDateStrings,
        anchorDates: shiftSettings,
        shiftCapacities,
        processingTimeMin
      };

      const distributions = await invoke<any[]>('calculate_demand_distribution', { req });

      if (onBatchUpdateRecords) {
        onBatchUpdateRecords(distributions.map(d => ({ ...d, field: 'target' })));
      }
    } catch (err) {
      console.error("Demand distribution failed:", err);
    } finally {
      setIsCalculatingDemand(false);
    }
  }, [weekDates, shiftSettings, onBatchUpdateRecords, partInfo, dailyCapacityMetrics]);
;

  return (
    <Box style={{ border: `1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))`, borderRadius: '8px', overflow: 'hidden' }}>
      <Box style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        <Table 
          verticalSpacing="xs" 
          highlightOnHover 
          withTableBorder
          styles={{ 
            thead: { 
              backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))',
              position: 'sticky',
              top: 0,
              zIndex: 10,
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
            },
            tfoot: {
              backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))',
              position: 'sticky',
              bottom: 0,
              zIndex: 10,
              boxShadow: '0 -2px 4px rgba(0,0,0,0.05)'
            },
            th: { borderBottom: `2px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))` }
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
                <Table.Th key={day} ta="center" style={{ width: 85, borderLeft: `1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))` }}>
                  <Stack gap={0} align="center">
                    <Text size="xs" fw={700} c="dimmed">{day.toUpperCase()}</Text>
                    {dateStr && <Text size="10px" c="light-dark(indigo.4, indigo.3)" fw={700}>{dateStr}</Text>}
                  </Stack>
                </Table.Th>
              );
            })}
            <Table.Th key="total" ta="center" bg={`light-dark(gray.1, ${rgba(theme.colors.gray[9], 0.15)})`} style={{ width: 90 }}>
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
                onRemovePartGroup={onRemovePartGroup}
                displayUnit={displayUnit}
                batchSize={batchSizeMap.get(childRows[0].partNumber) || 1}
                isCalculatingDemand={isCalculatingDemand}
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
                      onUpdatePartIdentity={onUpdatePartIdentity}
                      weekDates={weekDates}
                      shiftSettings={shiftSettings}
                      displayUnit={displayUnit}
                      batchSize={batchSizeMap.get(part.partNumber) || 1}
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
                  <Text c="dimmed" size="sm">No data available for {weekId ? generateWeekLabel(weekId) : 'this week'}.</Text>
                </Stack>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>

        <Table.Tfoot>
          <Table.Tr fw={700}>
            <Table.Td colSpan={3}>
              <Text size="sm" fw={800}>GRAND TOTAL ({displayUnit === 'batches' ? 'Batches' : 'Pieces'})</Text>
            </Table.Td>
            {calculatedTotals.daily.map((total, idx) => (
              <Table.Td key={idx} ta="center" style={{ borderLeft: `1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))` }}>
                <Text fw={800} size="xs" c="light-dark(indigo.9, indigo.2)">
                  {total.toLocaleString()}
                </Text>
              </Table.Td>
            ))}
            <Table.Td bg={`light-dark(indigo.1, ${rgba(theme.colors.indigo[8], 0.1)})`} style={{ borderLeft: `2px solid light-dark(var(--mantine-color-indigo-2), var(--mantine-color-dark-4))` }}>
              <Text fw={900} ta="center" size="sm" c="light-dark(indigo.9, indigo.2)">
                {calculatedTotals.grandTotal.toLocaleString()}
              </Text>
            </Table.Td>
            <Table.Td></Table.Td>
          </Table.Tr>
          <Table.Tr bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))" style={{ borderTop: `2px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))` }}>
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
                  {processInfo ? (
                    <HoverCard width={300} shadow="md" position="top" withArrow withinPortal>
                      <HoverCard.Target>
                        <Box style={{ cursor: 'pointer' }}>
                          <Stack gap={4} align="center">
                            <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: 4, justifyContent: 'center' }}>
                              {['A', 'C', 'B', 'D'].map(s => {
                                const sMetric = metric.shiftBreakdown[s];
                                let color = "gray.3";
                                let variant = "light";
                                
                                if (!sMetric.isWorking) {
                                  color = "light-dark(gray.3, dark.4)";
                                  variant = "outline";
                                } else if (sMetric.isOver) {
                                  color = "red.6";
                                  variant = "filled";
                                } else {
                                  color = "light-dark(teal.5, teal.8)";
                                  variant = "light";
                                }
                                
                                return (
                                  <Tooltip 
                                    key={s} 
                                    label={`Shift ${s}: ${sMetric.isWorking ? (sMetric.isOver ? 'Over Capacity' : 'Healthy') : 'OFF'}`} 
                                    position="top" 
                                    withinPortal
                                    styles={{
                                      tooltip: {
                                        backgroundColor: 'light-dark(white, var(--mantine-color-dark-6))',
                                        color: 'light-dark(var(--mantine-color-black), var(--mantine-color-white))',
                                        border: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
                                        fontWeight: 600
                                      }
                                    }}
                                  >
                                    <Badge 
                                      circle 
                                      size="xs" 
                                      color={color} 
                                      variant={variant}
                                      style={{ 
                                        border: variant === 'outline' ? '1px dashed currentColor' : undefined,
                                        fontSize: '9px' // Slightly smaller font to keep it tight
                                      }}
                                    >
                                      {s}
                                    </Badge>
                                  </Tooltip>
                                );
                              })}
                            </Box>
                            <Progress 
                              value={Math.min(utilization, 100)} 
                              color={color} 
                              size="sm" 
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
                          <Text size="sm" fw={700} style={{ borderBottom: `1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))`, paddingBottom: 4 }}>
                            Capacity Breakdown
                          </Text>
                          
                          {/* Shift-level Breakdown Section */}
                          {Object.entries(metric.shiftBreakdown).filter(([_, s]) => s.isWorking || s.load > 0).map(([s, sMetric]) => (
                            <Box key={s} mb={4}>
                              <Group justify="space-between" align="center">
                                <Text size="xs" fw={700} c={sMetric.isOver ? "red.6" : "light-dark(indigo, indigo.3)"}>
                                  Shift {s} {sMetric.isOver && "(OVER)"}
                                </Text>
                                <Text size="xs" fw={600} c={sMetric.isOver ? "red.6" : "dimmed"}>
                                  {sMetric.load.toFixed(1)}h / {sMetric.capacity.toFixed(1)}h
                                </Text>
                              </Group>
                              
                              {sMetric.breakdown.length > 0 ? (
                                <Stack gap={2} mt={2} pl="xs">
                                  {sMetric.breakdown.map((b, idx) => (
                                    <Group key={idx} justify="space-between" wrap="nowrap" align="center">
                                      <Text size="10px" fw={500} truncate w={100}>
                                        {b.partNumber}
                                      </Text>
                                      <Text size="10px" c="dimmed" ta="right">
                                        {b.scheduledQty}x → {b.calculatedHours.toFixed(1)}h
                                      </Text>
                                    </Group>
                                  ))}
                                </Stack>
                              ) : (
                                <Text size="10px" c="dimmed" fs="italic" pl="xs">No parts scheduled</Text>
                              )}
                              <Divider my={4} color="gray.1" />
                            </Box>
                          ))}

                          <Group justify="space-between" mt={4}>
                            <Text size="xs" c="dimmed">Daily Machinery Cap:</Text>
                            <Text size="xs" fw={600}>{metric.totalCapacity}h</Text>
                          </Group>
                          
                          <Group justify="space-between" style={{ borderTop: `1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))`, paddingTop: 8 }} mt={4}>
                            <Text size="xs" fw={700}>Total Daily Load:</Text>
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
