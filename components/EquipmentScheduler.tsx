'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult, DroppableProvided, DraggableProvided, DraggableStateSnapshot, DroppableStateSnapshot } from '@hello-pangea/dnd';
import { Box, Paper, Text, Group, Stack, ScrollArea, Tooltip, HoverCard, Title, Badge, Select, ActionIcon, Divider } from '@mantine/core';
import { IconAlertTriangle, IconClock, IconBox, IconBolt } from '@tabler/icons-react';
import { DAYS_OF_WEEK, DayOfWeek, isWorkingDay, getWeekDates, getCurrentWeekId } from '@/lib/dateUtils';
import { useScorecardStore } from '@/lib/scorecardStore';

// --- Interfaces ---

export interface JobBlock {
  id: string; // Unique ID representing the draggable card
  partNumber: string;
  shift: string;
  targetQty: number;
  processingTimeMins: number; // For scheduling capacity
  standardBatchSize?: number;
}

export interface DaySchedule {
  jobs: JobBlock[];
  totalAssignedHours: number;
}

export interface MachineSchedule {
  machineId: string;
  dailyCapacityHrs: number;
  schedule: Record<DayOfWeek, DaySchedule>;
}

export interface SchedulerState {
  unassigned: JobBlock[];
  machines: Record<string, MachineSchedule>;
}

interface EquipmentSchedulerProps {
  initialState?: SchedulerState;
  weekId?: string;
  processName?: string;
}

// --- Helper Functions ---

const SHIFT_COLORS: Record<string, string> = {
  'A': 'blue.5',
  'B': 'green.5',
  'C': 'orange.5',
  'D': 'violet.5'
};

const SHIFT_COLORS_BG: Record<string, string> = {
  'A': 'blue.0',
  'B': 'green.0',
  'C': 'orange.0',
  'D': 'violet.0'
};

function copyState(state: SchedulerState): SchedulerState {
  const newMachines: Record<string, MachineSchedule> = {};
  for (const [mId, mInfo] of Object.entries(state.machines)) {
    const newSchedule: Partial<Record<DayOfWeek, DaySchedule>> = {};
    for (const day of DAYS_OF_WEEK) {
      newSchedule[day] = {
        jobs: [...mInfo.schedule[day].jobs],
        totalAssignedHours: mInfo.schedule[day].totalAssignedHours
      };
    }
    newMachines[mId] = {
      ...mInfo,
      schedule: newSchedule as Record<DayOfWeek, DaySchedule>
    };
  }
  return {
    unassigned: [...state.unassigned],
    machines: newMachines
  };
}

function calculateTotalHours(jobs: JobBlock[]): number {
  return jobs.reduce((sum, job) => sum + ((job.targetQty * job.processingTimeMins) / 60), 0);
}

// --- Draggable Job Card Component ---
const JobCard = ({ 
  job, 
  index, 
  weekDates, 
  columnIndex,
  shiftSettings
}: { 
  job: JobBlock; 
  index: number;
  weekDates: Date[];
  columnIndex: number; // -1 for unassigned, 0-6 for Mon-Sun
  shiftSettings: Record<string, string>;
}) => {
  const shiftColor = SHIFT_COLORS[job.shift] || 'gray.5';
  const shiftBg = SHIFT_COLORS_BG[job.shift] || 'gray.0';
  
  // Panama schedule check
  let isWarning = false;
  let warningMessage = "";
  if (columnIndex >= 0) {
    const date = weekDates[columnIndex];
    const anchorDate = shiftSettings[job.shift];
    if (date && anchorDate && !isWorkingDay(date, anchorDate)) {
      isWarning = true;
      warningMessage = `Shift ${job.shift} is OFF on this day (Panama Schedule constraint)`;
    }
  }

  const processingHrs = ((job.targetQty * job.processingTimeMins) / 60).toFixed(1);

  return (
    <Draggable draggableId={job.id} index={index}>
      {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => (
        <HoverCard position="right" shadow="md" withinPortal openDelay={300}>
          <HoverCard.Target>
            <Paper
              ref={provided.innerRef}
              {...provided.draggableProps}
              {...provided.dragHandleProps}
              shadow={snapshot.isDragging ? "lg" : "xs"}
              p={6}
              mb={8}
              withBorder
              style={{
                ...provided.draggableProps.style,
                backgroundColor: snapshot.isDragging ? 'var(--mantine-color-gray-0)' : 'white',
                opacity: snapshot.isDragging ? 0.9 : 1,
                cursor: 'grab',
                position: 'relative',
                borderRadius: '6px',
                // Use separate longhand properties to avoid React style conflicts
                borderLeftWidth: '3px',
                borderLeftStyle: 'solid',
                borderLeftColor: isWarning 
                  ? 'var(--mantine-color-red-5)' 
                  : `var(--mantine-color-${shiftColor.replace('.', '-')})`,
                outline: isWarning ? '2px dashed var(--mantine-color-red-4)' : undefined,
                outlineOffset: isWarning ? '-2px' : undefined,
              }}
            >
              {isWarning && (
                <Tooltip label={warningMessage} withinPortal>
                  <Box style={{ position: 'absolute', top: -10, right: -10, zIndex: 10, background: 'white', borderRadius: '50%', boxShadow: 'var(--mantine-shadow-xs)' }}>
                    <IconAlertTriangle size={14} color="var(--mantine-color-red-6)" fill="white" />
                  </Box>
                </Tooltip>
              )}
              
              <Stack gap={2}>
                <Text fw={800} style={{ fontSize: '11px', lineHeight: 1.2 }} truncate="end">
                  {job.partNumber}
                </Text>
                
                <Group gap={4} wrap="nowrap" align="center">
                  <Badge 
                    size="xs" 
                    variant="filled" 
                    color={shiftColor.split('.')[0]} 
                    styles={{ root: { height: 14, padding: '0 4px', fontSize: '9px', fontWeight: 800 } }}
                  >
                    {job.shift}
                  </Badge>
                  <Text size="10px" fw={600} c="dimmed" truncate>
                    {job.targetQty.toLocaleString()}
                  </Text>
                </Group>

                <Group gap={3} wrap="nowrap">
                  <IconClock size={10} color="var(--mantine-color-gray-6)" />
                  <Text size="10px" fw={700} c="indigo.7" style={{ letterSpacing: '0.01em' }}>
                    {processingHrs}h
                  </Text>
                </Group>
              </Stack>
            </Paper>
          </HoverCard.Target>
          <HoverCard.Dropdown p="sm">
            <Stack gap="xs">
              <Text size="sm" fw={700} style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', paddingBottom: 4 }}>
                Job Details
              </Text>
              <Group justify="space-between" mt={4}>
                <Text size="xs" c="dimmed">Part Number:</Text>
                <Text size="xs" fw={600}>{job.partNumber}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Target Qty:</Text>
                <Text size="xs" fw={600}>{job.targetQty}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Processing Hrs:</Text>
                <Text size="xs" fw={600}>{processingHrs} hrs</Text>
              </Group>
              {job.standardBatchSize && (
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Batch Size:</Text>
                  <Text size="xs" fw={600}>{job.standardBatchSize}</Text>
                </Group>
              )}
              {isWarning && (
                <>
                  <Divider my={4} color="gray.2" />
                  <Group gap={4} wrap="nowrap">
                    <IconAlertTriangle size={14} color="var(--mantine-color-red-5)" />
                    <Text size="xs" c="red.6" fw={600}>{warningMessage}</Text>
                  </Group>
                </>
              )}
            </Stack>
          </HoverCard.Dropdown>
        </HoverCard>
      )}
    </Draggable>
  );
};


// --- Main Component ---
export default function EquipmentScheduler({ initialState, weekId, processName }: EquipmentSchedulerProps) {
  
  const shiftSettings = useScorecardStore(state => state.shiftSettings);
  
  const currentWeekId = weekId || getCurrentWeekId();
  const weekDates = useMemo(() => {
    try {
      return getWeekDates(currentWeekId);
    } catch {
      return [];
    }
  }, [currentWeekId]);

  // Provide some dummy data if no initial state is provided
  const [data, setData] = useState<SchedulerState>(initialState || {
    unassigned: [
      { id: 'job-1', partNumber: 'PART-A100', shift: 'A', targetQty: 500, processingTimeMins: 0.5 },
      { id: 'job-2', partNumber: 'PART-B200', shift: 'B', targetQty: 1000, processingTimeMins: 0.2 },
      { id: 'job-3', partNumber: 'PART-C300', shift: 'C', targetQty: 250, processingTimeMins: 1.5 },
    ],
    machines: {
      'E-001': {
        machineId: 'E-001',
        dailyCapacityHrs: 18,
        schedule: {
          'Mon': { jobs: [], totalAssignedHours: 0 },
          'Tue': { jobs: [], totalAssignedHours: 0 },
          'Wed': { jobs: [], totalAssignedHours: 0 },
          'Thu': { jobs: [], totalAssignedHours: 0 },
          'Fri': { jobs: [], totalAssignedHours: 0 },
          'Sat': { jobs: [], totalAssignedHours: 0 },
          'Sun': { jobs: [], totalAssignedHours: 0 },
        }
      },
      'E-002': {
        machineId: 'E-002',
        dailyCapacityHrs: 24,
        schedule: {
          'Mon': { jobs: [], totalAssignedHours: 0 },
          'Tue': { jobs: [], totalAssignedHours: 0 },
          'Wed': { jobs: [], totalAssignedHours: 0 },
          'Thu': { jobs: [], totalAssignedHours: 0 },
          'Fri': { jobs: [], totalAssignedHours: 0 },
          'Sat': { jobs: [], totalAssignedHours: 0 },
          'Sun': { jobs: [], totalAssignedHours: 0 },
        }
      }
    }
  });

  const onDragEnd = useCallback((result: DropResult) => {
    const { source, destination } = result;

    // Dropped outside a valid droppable
    if (!destination) return;

    // No movement
    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    setData(prev => {
      const newState = copyState(prev);

      // 1. Remove from source
      let movedJob: JobBlock;

      if (source.droppableId === 'unassigned') {
        movedJob = newState.unassigned[source.index];
        newState.unassigned.splice(source.index, 1);
      } else {
        const [sourceMachine, sourceDay] = source.droppableId.split('_');
        const sourceDayEnum = sourceDay as DayOfWeek;
        movedJob = newState.machines[sourceMachine].schedule[sourceDayEnum].jobs[source.index];
        newState.machines[sourceMachine].schedule[sourceDayEnum].jobs.splice(source.index, 1);
        
        // Recalculate source hours
        newState.machines[sourceMachine].schedule[sourceDayEnum].totalAssignedHours = calculateTotalHours(
          newState.machines[sourceMachine].schedule[sourceDayEnum].jobs
        );
      }

      // 2. Insert into destination
      if (destination.droppableId === 'unassigned') {
        newState.unassigned.splice(destination.index, 0, movedJob);
      } else {
        const [destMachine, destDay] = destination.droppableId.split('_');
        const destDayEnum = destDay as DayOfWeek;
        newState.machines[destMachine].schedule[destDayEnum].jobs.splice(destination.index, 0, movedJob);
        
        // Recalculate destination hours
        newState.machines[destMachine].schedule[destDayEnum].totalAssignedHours = calculateTotalHours(
          newState.machines[destMachine].schedule[destDayEnum].jobs
        );
      }

      return newState;
    });
  }, []);

  return (
    <Box p="md" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Group justify="space-between" mb="md">
        <Title order={3}>Equipment Scheduler - {processName || 'All Processes'}</Title>
        <Group>
          <Text fw={600} size="sm" c="dimmed">{currentWeekId}</Text>
          <Select 
            data={['All Processes', 'Molding', 'Assembly', 'Packaging']} 
            defaultValue={processName || 'All Processes'}
            size="sm"
          />
        </Group>
      </Group>

      <DragDropContext onDragEnd={onDragEnd}>
        <Box style={{ display: 'flex', flex: 1, gap: '16px', overflow: 'hidden' }}>
          
          {/* MATRIX GRID */}
          <Paper withBorder style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header Row */}
            <Box style={{ display: 'flex', borderBottom: '2px solid var(--mantine-color-gray-3)', backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Box p="md" style={{ width: '120px', flexShrink: 0, borderRight: '1px solid var(--mantine-color-gray-3)' }}>
                <Text fw={700} c="dimmed" size="xs">MACHINE</Text>
              </Box>
              {DAYS_OF_WEEK.map((day, idx) => {
                const dateStr = weekDates[idx] ? weekDates[idx].toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                return (
                  <Box key={day} p="sm" style={{ flex: 1, minWidth: '100px', borderRight: '1px solid var(--mantine-color-gray-2)', textAlign: 'center' }}>
                    <Text fw={700} size="sm">{day.toUpperCase()}</Text>
                    {dateStr && <Text size="xs" c="indigo.6" fw={600}>{dateStr}</Text>}
                  </Box>
                )
              })}
            </Box>

            {/* Matrix Body */}
            <ScrollArea style={{ flex: 1 }}>
              <Stack gap={0}>
                {Object.values(data.machines).map((machine) => (
                  <Box key={machine.machineId} style={{ display: 'flex', borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
                    
                    {/* Y-Axis Label */}
                    <Box p="md" style={{ width: '120px', flexShrink: 0, borderRight: '2px solid var(--mantine-color-gray-3)', backgroundColor: 'var(--mantine-color-gray-0)' }}>
                      <Stack gap={4}>
                        <Text fw={800} size="sm" c="indigo.8" truncate>{machine.machineId}</Text>
                        <Group gap={4} wrap="nowrap">
                          <IconBolt size={12} color="var(--mantine-color-green-6)" />
                          <Text size="10px" c="dimmed" fw={600}>{machine.dailyCapacityHrs}h</Text>
                        </Group>
                      </Stack>
                    </Box>

                    {/* Droppable Cells representing X-Axis Days */}
                    {DAYS_OF_WEEK.map((day, idx) => {
                      const cellId = `${machine.machineId}_${day}`;
                      const dayData = machine.schedule[day];
                      
                      const isOverAllocated = dayData.totalAssignedHours > machine.dailyCapacityHrs;
                      
                      return (
                        <Droppable key={cellId} droppableId={cellId}>
                          {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                            <Box 
                              style={{ 
                                flex: 1, 
                                minWidth: '100px', 
                                borderRight: '1px solid var(--mantine-color-gray-2)',
                                display: 'flex',
                                flexDirection: 'column',
                                transition: 'background-color 0.2s',
                                backgroundColor: snapshot.isDraggingOver 
                                  ? 'var(--mantine-color-indigo-0)' 
                                  : 'white'
                              }}
                            >
                              {/* Cell Header - Capacity */}
                              <Box p="xs" style={{ 
                                  borderBottom: '1px solid var(--mantine-color-gray-2)', 
                                  backgroundColor: isOverAllocated ? 'var(--mantine-color-red-0)' : 'transparent',
                                  transition: 'background-color 0.2s'
                                }}
                              >
                                <Group justify="center" gap={4}>
                                  <Text 
                                    size="xs" 
                                    fw={800} 
                                    c={isOverAllocated ? 'red.7' : (dayData.totalAssignedHours > 0 ? 'dark' : 'dimmed')}
                                  >
                                    {dayData.totalAssignedHours.toFixed(1)}h 
                                  </Text>
                                  <Text size="xs" c="dimmed">/ {machine.dailyCapacityHrs}h</Text>
                                  {isOverAllocated && (
                                    <Tooltip label="Machine is over capacity!" withinPortal position="top">
                                      <IconAlertTriangle size={14} color="var(--mantine-color-red-6)" />
                                    </Tooltip>
                                  )}
                                </Group>
                              </Box>

                              {/* Drop Zone */}
                              <Box
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                p="xs"
                                style={{ 
                                  flex: 1,
                                  minHeight: '120px',
                                  border: isOverAllocated ? '2px solid var(--mantine-color-red-4)' : '2px solid transparent',
                                  borderTop: 'none',
                                }}
                              >
                                {dayData.jobs.map((job, jobIdx) => (
                                  <JobCard 
                                    key={job.id} 
                                    job={job} 
                                    index={jobIdx} 
                                    weekDates={weekDates}
                                    columnIndex={idx}
                                    shiftSettings={shiftSettings}
                                  />
                                ))}
                                {provided.placeholder}
                              </Box>
                            </Box>
                          )}
                        </Droppable>
                      )
                    })}
                  </Box>
                ))}
              </Stack>
            </ScrollArea>
          </Paper>

          {/* UNASSIGNED BACKLOG */}
          <Paper withBorder style={{ width: '240px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box p="md" style={{ borderBottom: '2px solid var(--mantine-color-gray-3)', backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Group justify="space-between">
                <Group gap={8}>
                  <IconBox size={20} color="var(--mantine-color-indigo-6)" />
                  <Text fw={800} size="sm">Unassigned Backlog</Text>
                </Group>
                <Badge color="gray">{data.unassigned.length}</Badge>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                Drag jobs to the schedule matrix to assign capacity.
              </Text>
            </Box>

            <Droppable droppableId="unassigned">
              {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                <ScrollArea style={{ flex: 1 }}>
                  <Box
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    p="md"
                    style={{ 
                      minHeight: '100%',
                      backgroundColor: snapshot.isDraggingOver ? 'var(--mantine-color-indigo-0)' : 'white',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    {data.unassigned.map((job, index) => (
                      <JobCard 
                        key={job.id} 
                        job={job} 
                        index={index} 
                        weekDates={weekDates}
                        columnIndex={-1}
                        shiftSettings={shiftSettings}
                      />
                    ))}
                    {provided.placeholder}
                    {data.unassigned.length === 0 && (
                      <Text size="sm" c="dimmed" ta="center" mt="xl" fs="italic">
                        All jobs have been scheduled!
                      </Text>
                    )}
                  </Box>
                </ScrollArea>
              )}
            </Droppable>
          </Paper>

        </Box>
      </DragDropContext>
    </Box>
  );
}
