'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult, DroppableProvided, DraggableProvided, DraggableStateSnapshot, DroppableStateSnapshot } from '@hello-pangea/dnd';
import { Portal, Box, Paper, Text, Group, Stack, ScrollArea, Tooltip, HoverCard, Title, Badge, Select, ActionIcon, Divider, Loader, Center, Button, Popover, NumberInput, Flex, MultiSelect } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconClock, IconBox, IconBolt, IconFileExport } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { DAYS_OF_WEEK, DayOfWeek, isWorkingDay, getWeekDates, getCurrentWeekId } from '@/lib/dateUtils';
import { useScorecardStore } from '@/lib/scorecardStore';
import { useProcessStore } from '@/lib/processStore';
import { JobAssignment } from '@/lib/types';

// --- Interfaces ---

export interface JobBlock {
  Id: string; // Unique ID representing the draggable card
  PartNumber: string;
  Shift: string;
  TargetQty: number;
  ProcessingTimeMins: number; // For scheduling capacity
  StandardBatchSize?: number;
  BatchIndex: number;
  IsBatchSplit: boolean;
  MaxQty?: number; // Added to track original limit
  OriginalShift?: string;
  OriginalDate?: string;
}

export interface ShiftSchedule {
  Jobs: JobBlock[];
  CapacityHrs: number;
  TotalAssignedHours: number;
}

export interface MachineSchedule {
  MachineID: string;
  DailyCapacityHrs: number;
  Schedule: Record<string, Record<string, ShiftSchedule>>; // Day -> Map of Shifts
}

export interface SchedulerState {
  Unassigned: JobBlock[];
  Machines: Record<string, MachineSchedule>;
}

interface EquipmentSchedulerProps {
  initialState?: SchedulerState;
  initialWeekId?: string;
  initialProcessName?: string;
}

interface SchedulerMeta {
  ActiveWeeks: string[];
  ProcessHierarchy: Record<string, string[]>;
  PartMachineMap?: Record<string, string[]>;
}


// --- Helper Functions ---

function findJobPartNumber(jobId: string, state: SchedulerState): string | null {
  const uIdx = state.Unassigned.findIndex(j => j.Id === jobId);
  if (uIdx !== -1) return state.Unassigned[uIdx].PartNumber;

  for (const mInfo of Object.values(state.Machines)) {
    for (const dShifts of Object.values(mInfo.Schedule)) {
      for (const sData of Object.values(dShifts)) {
        const jIdx = sData.Jobs.findIndex(j => j.Id === jobId);
        if (jIdx !== -1) return sData.Jobs[jIdx].PartNumber;
      }
    }
  }
  return null;
}

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
  for (const [mId, mInfo] of Object.entries(state.Machines)) {
    const newSchedule: Record<string, Record<string, ShiftSchedule>> = {};
    for (const [day, dayShifts] of Object.entries(mInfo.Schedule)) {
      newSchedule[day] = {};
      for (const [shift, shiftData] of Object.entries(dayShifts)) {
        newSchedule[day][shift] = {
          Jobs: [...shiftData.Jobs],
          CapacityHrs: shiftData.CapacityHrs,
          TotalAssignedHours: shiftData.TotalAssignedHours
        };
      }
    }
    newMachines[mId] = {
      ...mInfo,
      Schedule: newSchedule
    };
  }
  return {
    Unassigned: [...state.Unassigned],
    Machines: newMachines
  };
}

function calculateTotalHours(jobs: JobBlock[]): number {
  return jobs.reduce((sum, job) => sum + ((job.TargetQty * job.ProcessingTimeMins) / 60), 0);
}

// --- Draggable Job Card Component ---
const JobCard = ({
  job,
  index,
  weekDates,
  columnIndex,
  shiftSettings,
  onUpdateQty,
  onPreviewChange
}: {
  job: JobBlock;
  index: number;
  weekDates: Date[];
  columnIndex: number; // -1 for unassigned, 0-6 for Mon-Sun
  shiftSettings: Record<string, string>;
  onUpdateQty?: (jobId: string, newQty: number) => void;
  onPreviewChange?: (jobId: string, newQty: number | null) => void;
}) => {
  const [editQty, setEditQty] = useState<number>(job.TargetQty);
  const [opened, setOpened] = useState(false);

  // Update local editQty if the job's TargetQty changes externally
  useEffect(() => {
    setEditQty(job.TargetQty);
  }, [job.TargetQty]);

  const shiftColor = SHIFT_COLORS[job.Shift] || 'gray.5';
  const processingHrs = ((editQty * (job.ProcessingTimeMins || 0)) / 60).toFixed(1);


  const jobDateStr = job.Id.split('|')[2];
  const hasMoved = (job.OriginalShift && job.Shift !== job.OriginalShift) || (job.OriginalDate && jobDateStr !== job.OriginalDate);
  const moveLabel = hasMoved ? `Prior: SH ${job.OriginalShift} on ${job.OriginalDate}` : '';

  return (
    <Draggable draggableId={job.Id} index={index}>
      {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => {
        const card = (
          <HoverCard position="right" shadow="md" withinPortal openDelay={200} disabled={snapshot.isDragging}>
            <HoverCard.Target>
              <Paper
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                shadow={snapshot.isDragging ? "xl" : "xs"}
                p={6}
                mb={8}
                withBorder
                style={{
                  backgroundColor: snapshot.isDragging ? 'var(--mantine-color-indigo-0)' : 'white',
                  opacity: snapshot.isDragging ? 0.9 : 1,
                  cursor: 'grab',
                  position: 'relative',
                  borderRadius: '6px',
                  borderLeftWidth: '3px',
                  borderLeftStyle: 'solid',
                  borderLeftColor: `var(--mantine-color-${shiftColor.replace('.', '-')})`,
                  ...provided.draggableProps.style,
                  zIndex: snapshot.isDragging ? 9999 : 1,
                  // Maintain width when dragging in Portal
                  width: snapshot.isDragging ? '240px' : 'auto',
                }}
              >

                <Stack gap={2}>
                  <Group gap={4} wrap="nowrap" align="center" style={{ width: '100%' }}>
                    <Text fw={800} style={{ fontSize: '11px', lineHeight: 1.2, flex: 1 }} truncate="end">
                      {job.PartNumber}
                    </Text>
                    {hasMoved && (
                      <Tooltip label={moveLabel} withinPortal position="top">
                        <Badge size="xs" color="gray" variant="outline" p={0} styles={{ root: { width: 14, height: 14, minWidth: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' } }}>
                          <IconAlertTriangle size={10} color="var(--mantine-color-orange-6)" />
                        </Badge>
                      </Tooltip>
                    )}
                  </Group>

                  <Group gap={4} wrap="nowrap" align="center">
                    <Badge
                      size="xs"
                      variant="filled"
                      color={shiftColor.split('.')[0]}
                      styles={{ root: { height: 14, padding: '0 4px', fontSize: '9px', fontWeight: 800 } }}
                    >
                      {job.Shift}
                    </Badge>

                    <Popover
                      opened={opened}
                      onChange={(o) => {
                        setOpened(o);
                        if (!o) {
                          onPreviewChange?.(job.Id, null);
                          setEditQty(job.TargetQty);
                        }
                      }}
                      position="bottom"
                      withArrow
                      shadow="md"
                      withinPortal
                      trapFocus={false}
                    >
                      <Popover.Target>
                        <Badge
                          size="xs"
                          variant="light"
                          color="gray"
                          onClick={(e) => { e.stopPropagation(); setOpened(o => !o); }}
                          style={{ cursor: 'pointer', height: 14, fontSize: '9px', fontWeight: 800 }}
                        >
                          {job.TargetQty.toLocaleString()}
                        </Badge>
                      </Popover.Target>
                      <Popover.Dropdown p={8} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                        <Stack gap={8}>
                          <Text size="10px" fw={700}>Adjust Quantity</Text>
                          <Group gap={4} wrap="nowrap">
                            <Box style={{ width: 80 }}>
                              <NumberInput
                                size="xs"
                                value={editQty}
                                onChange={(val) => {
                                  const num = Number(val);
                                  setEditQty(num);
                                  onPreviewChange?.(job.Id, num);
                                }}
                                min={1}
                                max={job.MaxQty || job.TargetQty}
                                step={1}
                                styles={{ input: { fontSize: '10px', height: 24, minHeight: 24 } }}
                              />
                            </Box>
                            <Button
                              size="compact-xs"
                              variant="filled"
                              color="indigo"
                              onClick={() => {
                                onUpdateQty?.(job.Id, editQty);
                                setOpened(false);
                              }}
                            >
                              Update
                            </Button>
                          </Group>
                          <Text size="8px" c="dimmed">Max permitted: {job.MaxQty || job.TargetQty}</Text>
                        </Stack>
                      </Popover.Dropdown>
                    </Popover>
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
                  <Text size="xs" fw={600}>{job.PartNumber}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Target Qty:</Text>
                  <Text size="xs" fw={600}>{job.TargetQty}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Processing Hrs:</Text>
                  <Text size="xs" fw={600}>{processingHrs} hrs</Text>
                </Group>
                {job.StandardBatchSize && (
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Batch Size:</Text>
                    <Text size="xs" fw={600}>{job.StandardBatchSize}</Text>
                  </Group>
                )}
              </Stack>
            </HoverCard.Dropdown>
          </HoverCard>
        );

        if (snapshot.isDragging) {
          return <Portal>{card}</Portal>;
        }
        return card;
      }}
    </Draggable>
  );
};


// --- Main Component ---
export default function EquipmentScheduler({ initialState, initialWeekId, initialProcessName }: EquipmentSchedulerProps) {

  const shiftSettings = useScorecardStore(state => state.shiftSettings);

  const [currentWeekId, setCurrentWeekId] = useState(initialWeekId || getCurrentWeekId());
  const { processes, activeProcess: processName, setActiveProcess: setProcessName } = useProcessStore();
  const [backlogDay, setBacklogDay] = useState<DayOfWeek | 'All'>('Mon');
  const [meta, setMeta] = useState<SchedulerMeta | null>(null);
  const [previewData, setPreviewData] = useState<{ jobId: string, qty: number } | null>(null);
  const [allowedDropMachines, setAllowedDropMachines] = useState<string[] | null>(null);

  const consolidateJobsList = useCallback((jobs: JobBlock[]) => {
    const consolidated: JobBlock[] = [];
    jobs.forEach(item => {
      const itemDate = item.Id.split('|')[2];
      const existingIdx = consolidated.findIndex(j =>
        j.PartNumber.trim().toLowerCase() === item.PartNumber.trim().toLowerCase() &&
        j.Shift === item.Shift &&
        j.Id.split('|')[2] === itemDate
      );

      if (existingIdx !== -1) {
        consolidated[existingIdx].TargetQty += item.TargetQty;
        if (consolidated[existingIdx].MaxQty !== undefined || item.MaxQty !== undefined) {
          consolidated[existingIdx].MaxQty = (consolidated[existingIdx].MaxQty || 0) + (item.MaxQty || item.TargetQty);
        }
      } else {
        consolidated.push({ ...item });
      }
    });
    return consolidated;
  }, []);
  const [dirty, setDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const weekDates = useMemo(() => {
    try {
      return getWeekDates(currentWeekId);
    } catch {
      return [];
    }
  }, [currentWeekId]);

  const [data, setData] = useState<SchedulerState | null>(initialState || null);
  const [loading, setLoading] = useState(true);

  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);

  const allMachines = useMemo(() => {
    if (!data || !meta || !meta.ProcessHierarchy) return [];
    let mList: string[] = [];
    Object.entries(meta.ProcessHierarchy).forEach(([pName, mIds]) => {
      if (processName !== 'All Processes' && processName !== pName) return;
      mIds.forEach(mId => {
        if (data.Machines[mId] && !mList.includes(mId)) {
          mList.push(mId);
        }
      });
    });
    return mList;
  }, [data, meta, processName]);

  const displayedMachines = useMemo(() => {
    if (selectedEquipment.length === 0) return allMachines;
    return allMachines.filter(mId => selectedEquipment.includes(mId));
  }, [allMachines, selectedEquipment]);

  const multiSelectData = useMemo(() => {
    return allMachines.map(m => ({ value: m, label: m }));
  }, [allMachines]);

  const aggregateStats = useMemo(() => {
    if (!data) return { totalLoad: 0, totalCapacity: 0, utilization: 0 };

    let totalLoad = 0;
    let totalCapacity = 0;

    Object.values(data.Machines).forEach(machine => {
      Object.values(machine.Schedule).forEach(dayShifts => {
        Object.values(dayShifts).forEach(shiftData => {
          totalCapacity += shiftData.CapacityHrs;

          let shiftLoad = shiftData.TotalAssignedHours;
          if (previewData) {
            const previewedJob = shiftData.Jobs.find(j => j.Id === previewData.jobId);
            if (previewedJob) {
              const oldHrs = (previewedJob.TargetQty * previewedJob.ProcessingTimeMins) / 60;
              const newHrs = (previewData.qty * previewedJob.ProcessingTimeMins) / 60;
              shiftLoad = shiftLoad - oldHrs + newHrs;
            }
          }
          totalLoad += shiftLoad;
        });
      });
    });

    return {
      totalLoad,
      totalCapacity,
      utilization: totalCapacity > 0 ? (totalLoad / totalCapacity) * 100 : 0
    };
  }, [data, previewData]);

  const fetchMeta = useCallback(async () => {
    try {
      const store = await load("store.json", { autoSave: false, defaults: {} });
      const connectionString = await store.get<string>("db_connection_string");
      if (!connectionString) return;

      const metadata: SchedulerMeta = await invoke('get_scheduler_meta', { connectionString });
      setMeta(metadata);
    } catch (e) {
      console.error("Failed to fetch metadata", e);
    }
  }, []);

  const fetchUtilization = useCallback(async () => {
    try {
      setLoading(true);
      const store = await load("store.json", { autoSave: false, defaults: {} });
      const connectionString = await store.get<string>("db_connection_string");

      if (!connectionString) {
        setLoading(false);
        return;
      }

      const state: SchedulerState = await invoke('get_machine_utilization', {
        connectionString,
        weekId: currentWeekId,
        processName: processName || 'All Processes'
      });

      // Initialize MaxQty for local tracking
      const initializedState: SchedulerState = {
        ...state,
        Unassigned: state.Unassigned.map(j => ({ 
          ...j, 
          MaxQty: j.TargetQty, 
          OriginalShift: j.OriginalShift || j.Shift, 
          OriginalDate: j.OriginalDate || j.Id.split('|')[2] 
        })),
        Machines: Object.fromEntries(
          Object.entries(state.Machines).map(([mId, mInfo]) => [
            mId,
            {
              ...mInfo,
              Schedule: Object.fromEntries(
                Object.entries(mInfo.Schedule).map(([day, shifts]) => [
                  day,
                  Object.fromEntries(
                    Object.entries(shifts).map(([sId, sData]) => [
                      sId,
                      { 
                        ...sData, 
                        Jobs: sData.Jobs.map(j => ({ 
                          ...j, 
                          MaxQty: j.TargetQty, 
                          OriginalShift: j.OriginalShift || j.Shift, 
                          OriginalDate: j.OriginalDate || (j.Id.includes('|') ? j.Id.split('|')[2] : undefined) 
                        })) 
                      }
                    ])
                  )
                ])
              )
            }
          ])
        )
      };

      initializedState.Unassigned = consolidateJobsList(initializedState.Unassigned);
      setData(initializedState);
      setDirty(false);
    } catch (e: any) {
      notifications.show({
        title: 'Error Loading Schedule',
        message: e.toString(),
        color: 'red'
      });
    } finally {
      setLoading(false);
    }
  }, [currentWeekId, processName]);

  const handleUpdateJobQty = useCallback((jobId: string, newQty: number) => {
    setData(prev => {
      if (!prev) return null;
      const newState = copyState(prev);

      let foundJob: JobBlock | null = null;
      let machineId: string | undefined;
      let day: string | undefined;
      let shift: string | undefined;

      // Find job in Unassigned
      const uIdx = newState.Unassigned.findIndex(j => j.Id === jobId);
      if (uIdx !== -1) {
        foundJob = newState.Unassigned[uIdx];
      } else {
        // Search Machines
        outer: for (const [mId, mInfo] of Object.entries(newState.Machines)) {
          for (const [dKey, dShifts] of Object.entries(mInfo.Schedule)) {
            for (const [sKey, sData] of Object.entries(dShifts)) {
              const jIdx = sData.Jobs.findIndex(j => j.Id === jobId);
              if (jIdx !== -1) {
                foundJob = sData.Jobs[jIdx];
                machineId = mId;
                day = dKey;
                shift = sKey;
                break outer;
              }
            }
          }
        }
      }

      if (!foundJob) return prev;

      const oldQty = foundJob.TargetQty;
      const diff = oldQty - newQty;

      // Create updated job object immutably
      const updatedJob = { ...foundJob, TargetQty: newQty };

      // Update its place in the state
      if (uIdx !== -1) {
        newState.Unassigned[uIdx] = updatedJob;
      } else if (machineId && day && shift) {
        const sData = newState.Machines[machineId].Schedule[day][shift];
        const jIdx = sData.Jobs.findIndex(j => j.Id === jobId);
        if (jIdx !== -1) sData.Jobs[jIdx] = updatedJob;
      }

      if (diff > 0) {
        // Decrease qty -> Create remainder card in backlog
        const remainderCard: JobBlock = {
          ...updatedJob,
          Id: `${updatedJob.Id}|split|${Date.now()}`,
          TargetQty: diff,
          MaxQty: diff, // The new card has its own max based on the split
          IsBatchSplit: true
        };
        newState.Unassigned.push(remainderCard);
        // Consolidate backlog after split
        newState.Unassigned = consolidateJobsList(newState.Unassigned);

        // If it was on a machine, update the machine's assigned hours
        if (machineId && day && shift) {
          const sData = newState.Machines[machineId].Schedule[day][shift];
          sData.TotalAssignedHours = calculateTotalHours(sData.Jobs);
        }
      } else if (diff < 0) {
        // Increase qty
        if (machineId && day && shift) {
          const sData = newState.Machines[machineId].Schedule[day][shift];
          sData.TotalAssignedHours = calculateTotalHours(sData.Jobs);
        }
      }

      setPreviewData(null); // Clear preview after update
      return newState;
    });
    setDirty(true);
  }, [data]);

  useEffect(() => {
    fetchMeta();
  }, [fetchMeta]);

  useEffect(() => {
    fetchUtilization();
  }, [fetchUtilization]);

  const onDragStart = useCallback((initial: any) => {
    if (!data) return;
    const partNumber = findJobPartNumber(initial.draggableId, data);
    if (partNumber && meta?.PartMachineMap && meta.PartMachineMap[partNumber]) {
      setAllowedDropMachines(meta.PartMachineMap[partNumber]);
    } else {
      setAllowedDropMachines(null);
    }
  }, [data, meta]);

  const onDragEnd = useCallback(async (result: DropResult) => {
    setAllowedDropMachines(null);
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    setData(prev => {
      if (!prev) return null;
      const newState = copyState(prev);

      let movedJob: JobBlock;
      // 1. Remove from source
      if (source.droppableId === 'unassigned') {
        movedJob = newState.Unassigned[source.index];
        newState.Unassigned.splice(source.index, 1);
      } else {
        const [sourceMachine, sourceDay, sourceShift] = source.droppableId.split('|');
        const shiftData = newState.Machines[sourceMachine].Schedule[sourceDay][sourceShift];
        movedJob = shiftData.Jobs[source.index];
        shiftData.Jobs.splice(source.index, 1);
        shiftData.TotalAssignedHours = calculateTotalHours(shiftData.Jobs);
      }

      // 2. Add to destination
      if (destination.droppableId === 'unassigned') {
        const filteredUnassigned = newState.Unassigned
          .map((job, idx) => ({ job, idx }))
          .filter(({ job }) => {
            if (backlogDay === 'All') return true;
            const jobDateStr = job.Id.split('|')[2];
            const dayIdx = weekDates.findIndex(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === jobDateStr);
            return DAYS_OF_WEEK[dayIdx] === backlogDay;
          });

        if (filteredUnassigned.length > 0 && destination.index < filteredUnassigned.length) {
          const targetIndex = filteredUnassigned[destination.index].idx;
          newState.Unassigned.splice(targetIndex, 0, movedJob);
        } else {
          // If list is empty or dropping at the end, just push or append
          newState.Unassigned.push(movedJob);
        }
        newState.Unassigned = consolidateJobsList(newState.Unassigned);
      } else {
        const [destMachine, destDay, destShift] = destination.droppableId.split('|');

        // UPDATE METADATA IMMUTABLY
        const dayIdx = DAYS_OF_WEEK.indexOf(destDay as DayOfWeek);
        const d = weekDates[dayIdx];
        const newDateStr = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

        const idParts = movedJob.Id.split('|');
        if (idParts.length >= 3) idParts[2] = newDateStr;
        const newId = idParts.join('|');

        movedJob = {
          ...movedJob,
          Shift: destShift,
          Id: newId
        };

        // Safety: ensure keys exist (should be populated by backend)
        if (!newState.Machines[destMachine].Schedule[destDay]) {
          newState.Machines[destMachine].Schedule[destDay] = {};
        }
        if (!newState.Machines[destMachine].Schedule[destDay][destShift]) {
          newState.Machines[destMachine].Schedule[destDay][destShift] = {
            Jobs: [],
            CapacityHrs: newState.Machines[destMachine].DailyCapacityHrs || 0,
            TotalAssignedHours: 0
          };
        }
        const shiftData = newState.Machines[destMachine].Schedule[destDay][destShift];

        // AUTO-SPLIT LOGIC
        const availableHours = shiftData.CapacityHrs - shiftData.TotalAssignedHours;
        const neededHours = (movedJob.TargetQty * movedJob.ProcessingTimeMins) / 60;

        if (neededHours > availableHours) {
          const qtyThatFits = Math.floor((availableHours * 60) / movedJob.ProcessingTimeMins);

          if (qtyThatFits > 0) {
            const originalQty = movedJob.TargetQty;
            const leftoverQty = originalQty - qtyThatFits;

            movedJob.TargetQty = qtyThatFits;
            movedJob.MaxQty = qtyThatFits;

            const remainderJob: JobBlock = {
              ...movedJob,
              Id: `${movedJob.Id}|split|${Date.now()}`,
              TargetQty: leftoverQty,
              MaxQty: leftoverQty,
              IsBatchSplit: true
            };

            newState.Unassigned.push(remainderJob);
            newState.Unassigned = consolidateJobsList(newState.Unassigned);
          } else {
            newState.Unassigned.push(movedJob);
            newState.Unassigned = consolidateJobsList(newState.Unassigned);
            notifications.show({ title: 'Shift Full: Card returned to backlog', message: 'Not enough capacity to place this job.', color: 'yellow' });
            return newState;
          }
        }

        // AUTO-CONSOLIDATION (MERGE)
        // Check if a card with the exact same part number already exists in this machine/shift
        const existingJobIdx = shiftData.Jobs.findIndex(j =>
          j.PartNumber.trim().toLowerCase() === movedJob.PartNumber.trim().toLowerCase()
        );

        if (existingJobIdx !== -1) {
          const existingJob = shiftData.Jobs[existingJobIdx];
          shiftData.Jobs[existingJobIdx] = {
            ...existingJob,
            TargetQty: existingJob.TargetQty + movedJob.TargetQty,
            MaxQty: (existingJob.MaxQty || 0) + (movedJob.MaxQty || movedJob.TargetQty)
          };
        } else {
          // Standard move: insert at the specified index
          shiftData.Jobs.splice(destination.index, 0, movedJob);
        }

        shiftData.TotalAssignedHours = calculateTotalHours(shiftData.Jobs);
      }

      return newState;
    });

    setDirty(true);
  }, [weekDates]);

  const handleSubmit = async () => {
    if (!data) return;
    try {
      setIsSubmitting(true);
      const store = await load("store.json", { autoSave: false, defaults: {} });
      const connectionString = await store.get<string>("db_connection_string");
      if (!connectionString) throw new Error("Connection string not found");

      const assignments: JobAssignment[] = [];
      
      Object.entries(data.Machines).forEach(([mId, mInfo]) => {
        Object.entries(mInfo.Schedule).forEach(([day, dayShifts]) => {
          const dayIdx = DAYS_OF_WEEK.indexOf(day as DayOfWeek);
          const d = weekDates[dayIdx];
          const dateStr = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

          Object.entries(dayShifts).forEach(([shift, shiftData]) => {
            shiftData.Jobs.forEach((job, index) => {
              assignments.push({
                WeekIdentifier: currentWeekId,
                PartNumber: job.PartNumber,
                MachineID: mId,
                Date: dateStr,
                Shift: shift,
                Qty: job.TargetQty,
                RunSequence: index
              });
            });
          });
        });
      });

      await invoke('save_scheduler_state', { connectionString, department: processName, weekId: currentWeekId, assignments });
      notifications.show({ title: 'Schedule Submitted', message: 'Successfully updated database.', color: 'green' });
      setDirty(false);
      fetchUtilization();
    } catch (e: any) {
      notifications.show({ title: 'Submission Failed', message: e.toString(), color: 'red' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateChangeover = async () => {
    if (!data) return;

    const rows: string[] = ["Machine,Start Day,Start Shift,Part Number,Total Run Qty,Next Changeover Part"];

    Object.values(data.Machines).forEach(machine => {
      let currentRun: any = null;
      let lastPartNumber = "";

      // daysWithShifts is chronological Mon -> Sun and contains only working/enabled shifts
      daysWithShifts.forEach(dayInfo => {
        dayInfo.shifts.forEach(shiftInfo => {
          const shiftData = machine.Schedule[dayInfo.day]?.[shiftInfo.id];
          if (!shiftData || shiftData.Jobs.length === 0) return;

          shiftData.Jobs.forEach(job => {
            // Consolidation logic: check if same part continues
            if (job.PartNumber.trim().toLowerCase() === lastPartNumber.trim().toLowerCase() && currentRun) {
              currentRun.TotalQty += job.TargetQty;
            } else {
              if (currentRun) {
                // Close out previous run by recording the transition
                currentRun.NextPart = job.PartNumber;
                rows.push(`"${currentRun.Machine}","${currentRun.StartDay}","${currentRun.StartShift}","${currentRun.PartNumber}",${currentRun.TotalQty},"${currentRun.NextPart}"`);
              }

              // Start new run
              currentRun = {
                Machine: machine.MachineID,
                StartDay: dayInfo.day,
                StartShift: shiftInfo.id,
                PartNumber: job.PartNumber,
                TotalQty: job.TargetQty,
                NextPart: "END"
              };
              lastPartNumber = job.PartNumber;
            }
          });
        });
      });

      // Handle the tail run for each machine
      if (currentRun) {
        rows.push(`"${currentRun.Machine}","${currentRun.StartDay}","${currentRun.StartShift}","${currentRun.PartNumber}",${currentRun.TotalQty},"${currentRun.NextPart}"`);
      }
    });

    const csvContent = rows.join("\n");
    const safeProcessName = (processName || 'Process').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Changeover_Schedule_${currentWeekId}_${safeProcessName}.csv`;

    try {
      await invoke("save_csv_file", { content: csvContent, defaultPath: filename });
      notifications.show({
        title: 'Export Successful',
        message: `Saved to local file system.`,
        color: 'green'
      });
    } catch (err: any) {
      if (err !== "Save cancelled") {
        notifications.show({
          title: 'Export Error',
          message: err.toString(),
          color: 'red'
        });
      }
    }
  };

  const daysWithShifts = useMemo(() => {
    if (!data) return [];
    const ALL_SHIFTS = ['A', 'B', 'C', 'D'];
    return DAYS_OF_WEEK.map((day, idx) => {
      const date = weekDates[idx];
      const shifts = ALL_SHIFTS.map(sId => {
        const anchor = shiftSettings[sId];
        // Panama Logic: Check if the shift is ON for this specific day
        const isWorking = date && anchor ? isWorkingDay(date, anchor) : true;
        return { id: sId, isWorking };
      }).filter(s => s.isWorking);

      return {
        day,
        dateStr: date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
        shifts,
        dateIdx: idx
      };
    }).filter(d => d.shifts.length > 0);
  }, [data, weekDates, shiftSettings]);

  return (
    <Box p={0} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
                <Text size="10px" fw={800} c="dimmed">LINE LOAD</Text>
                <Group gap={6}>
                  <Text size="lg" fw={900} c="indigo.9">{aggregateStats.totalLoad.toFixed(1)}h</Text>
                  <Text size="xs" c="dimmed" fw={700}>/ {aggregateStats.totalCapacity.toFixed(0)}h</Text>
                </Group>
              </Stack>
              <Stack gap={2} w={120}>
                <Group justify="space-between" gap={0}>
                  <Text size="10px" fw={800} c="indigo.7">UTILIZATION</Text>
                  <Text size="10px" fw={800} c={aggregateStats.utilization > 100 ? 'red.7' : 'indigo.7'}>
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
              <Button variant="light" color="gray" size="sm" disabled={!dirty || isSubmitting} onClick={() => fetchUtilization()}>Reset</Button>
              <Button variant="filled" color="indigo" size="sm" disabled={!dirty || isSubmitting} loading={isSubmitting} onClick={handleSubmit} leftSection={<IconBolt size={16} />}>Submit Schedule</Button>
            </Group>
          </Group>
        </Group>
      </Box>

      <DragDropContext onDragEnd={onDragEnd} onDragStart={onDragStart}>
        {loading || !data ? (
          <Center style={{ flex: 1 }}><Loader size="lg" /></Center>
        ) : (
          <Flex h="calc(100vh - 120px)" wrap="nowrap" gap="md" style={{ overflow: 'hidden' }}>
            
            {/* LEFT PANE: Backlog */}
            <Paper withBorder w={350} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '12px' }}>
              <Box p="md" style={{ borderBottom: '2px solid var(--mantine-color-gray-3)', backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Group gap={8}><IconBox size={20} color="var(--mantine-color-indigo-6)" /><Text fw={800} size="sm">Backlog</Text></Group>
                    <Badge color="indigo" variant="light">{data.Unassigned.length}</Badge>
                  </Group>
                  <Select size="xs" data={['All', ...DAYS_OF_WEEK]} value={backlogDay} onChange={(val) => setBacklogDay(val as any)} label="Filter by planned day:" styles={{ label: { fontSize: '10px', fontWeight: 700, color: 'var(--mantine-color-gray-6)' } }} />
                </Stack>
              </Box>
              <ScrollArea style={{ flex: 1 }}>
                <Droppable droppableId="unassigned">
                  {(provided, snapshot) => (
                    <Box
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      p="md"
                      style={{
                        minHeight: '100%',
                        backgroundColor: snapshot.isDraggingOver ? 'var(--mantine-color-indigo-0)' : 'white',
                        transition: 'background-color 0.2s ease'
                      }}
                    >
                      {data.Unassigned
                        .map((job, originalIndex) => ({ job, originalIndex }))
                        .filter(({ job }) => {
                          if (backlogDay === 'All') return true;
                          const jobDateStr = job.Id.split('|')[2];
                          const dayIdx = weekDates.findIndex(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === jobDateStr);
                          return DAYS_OF_WEEK[dayIdx] === backlogDay;
                        })
                        .map(({ job, originalIndex }, filteredIndex) => (
                          <JobCard
                            key={job.Id}
                            job={job}
                            index={originalIndex}
                            weekDates={weekDates}
                            columnIndex={-1}
                            shiftSettings={shiftSettings}
                            onUpdateQty={handleUpdateJobQty}
                            onPreviewChange={(id, qty) => {
                              if (qty === null) setPreviewData(null);
                              else setPreviewData({ jobId: id, qty });
                            }}
                          />
                        ))}
                      {provided.placeholder}
                    </Box>
                  )}
                </Droppable>
              </ScrollArea>
            </Paper>

            {/* RIGHT PANE: Equipment Grid */}
            <Paper withBorder style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '12px', backgroundColor: 'white' }}>
              <Box p="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)', backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <MultiSelect
                  placeholder="Filter equipment to focus scheduling..."
                  data={multiSelectData}
                  value={selectedEquipment}
                  onChange={setSelectedEquipment}
                  searchable
                  clearable
                  size="xs"
                />
              </Box>
              <ScrollArea style={{ flex: 1 }} type="always">
                <Box style={{ minWidth: 'max-content', width: '100%' }}>
                  {/* --- Header Row --- */}
                  <Box style={{
                    display: 'flex',
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    backgroundColor: 'var(--mantine-color-gray-0)',
                    borderBottom: '2px solid var(--mantine-color-gray-3)'
                  }}>
                    {/* Machine Column Header */}
                    <Box style={{
                      width: '140px',
                      flexShrink: 0,
                      padding: '12px',
                      borderRight: '1px solid var(--mantine-color-gray-3)',
                      position: 'sticky',
                      left: 0,
                      zIndex: 110,
                      backgroundColor: 'var(--mantine-color-gray-0)'
                    }}><Text fw={700} c="dimmed" size="xs">MACHINE</Text></Box>

                    {/* Day Headers */}
                    {daysWithShifts.map((d) => (
                      <Box key={d.day} style={{ flexGrow: 1, flexBasis: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--mantine-color-gray-3)' }}>
                        <Box p="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', textAlign: 'center', backgroundColor: 'var(--mantine-color-gray-1)' }}>
                          <Text fw={800} size="xs">{d.day.toUpperCase()} ({d.dateStr})</Text>
                        </Box>
                        <Box style={{ display: 'flex' }}>
                          {d.shifts.map(s => (
                            <Box key={s.id} p="6px" style={{ flexGrow: 1, flexBasis: 0, textAlign: 'center', borderRight: s.id !== d.shifts[d.shifts.length - 1].id ? '1px solid var(--mantine-color-gray-1)' : 'none' }}>
                              <Text fw={700} size="9px" c={s.isWorking ? "dimmed" : "red.5"}>SH {s.id} {s.isWorking ? "" : "OFF"}</Text>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                  <Stack gap={0}>
                    {Object.entries(meta?.ProcessHierarchy || {}).map(([pName, mIds]) => {
                      if (processName !== 'All Processes' && processName !== pName) return null;
                      
                      const processDisplayedMachines = mIds.filter(mId => displayedMachines.includes(mId));
                      if (processDisplayedMachines.length === 0) return null;

                      return (
                        <Box key={pName}>
                          <Box px="md" py="xs" style={{
                            backgroundColor: 'var(--mantine-color-indigo-0)',
                            borderBottom: '1px solid var(--mantine-color-indigo-2)',
                            position: 'sticky',
                            left: 0,
                            zIndex: 5
                          }}>
                            <Text fw={900} size="xs" c="indigo.9" style={{ letterSpacing: '0.05em' }}>{pName.toUpperCase()}</Text>
                          </Box>
                          {processDisplayedMachines.map((mId) => {
                            const machine = data.Machines[mId];
                            if (!machine) return null;
                            return (
                              <Box key={machine.MachineID} style={{ display: 'flex', borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
                                {/* Sticky Machine Info Column */}
                                <Box p="md" style={{
                                  width: '140px',
                                  flexShrink: 0,
                                  borderRight: '2px solid var(--mantine-color-gray-3)',
                                  backgroundColor: 'white',
                                  position: 'sticky',
                                  left: 0,
                                  zIndex: 10
                                }}>
                                  <Stack gap={4}>
                                    <Text fw={800} size="sm" c="indigo.8" truncate>{machine.MachineID}</Text>
                                    <Group gap={4} wrap="nowrap"><IconBolt size={12} color="var(--mantine-color-green-6)" /><Text size="10px" c="dimmed" fw={600}>CAP: {machine.DailyCapacityHrs}h</Text></Group>
                                  </Stack>
                                </Box>

                                {daysWithShifts.map((d) => (
                                  <Box key={d.day} style={{ flexGrow: 1, flexBasis: 0, display: 'flex' }}>
                                    {d.shifts.map(s => {
                                      const cellId = `${machine.MachineID}|${d.day}|${s.id}`;
                                      const shiftData = machine.Schedule[d.day]?.[s.id];

                                      let effectiveHours = shiftData?.TotalAssignedHours || 0;
                                      if (previewData && shiftData) {
                                        const previewedJob = shiftData.Jobs.find(j => j.Id === previewData.jobId);
                                        if (previewedJob) {
                                          const oldHrs = (previewedJob.TargetQty * previewedJob.ProcessingTimeMins) / 60;
                                          const newHrs = (previewData.qty * previewedJob.ProcessingTimeMins) / 60;
                                          effectiveHours = effectiveHours - oldHrs + newHrs;
                                        }
                                      }

                                      const isOver = shiftData && effectiveHours > (shiftData.CapacityHrs || 0);
                                      const util = shiftData && shiftData.CapacityHrs > 0 ? (effectiveHours / shiftData.CapacityHrs) * 100 : 0;
                                      const isMachineAllowed = allowedDropMachines === null || allowedDropMachines.includes(machine.MachineID);

                                      return (
                                        <Droppable key={cellId} droppableId={cellId} isDropDisabled={!s.isWorking || (shiftData && shiftData.CapacityHrs === 0) || !isMachineAllowed}>
                                          {(provided, snapshot) => (
                                            <Box
                                              ref={provided.innerRef}
                                              {...provided.droppableProps}
                                              style={{
                                                flexGrow: 1,
                                                flexBasis: 0,
                                                minWidth: '80px',
                                                borderRight: '1px solid var(--mantine-color-gray-2)',
                                                transition: 'background-color 0.2s',
                                                position: 'relative',
                                                backgroundColor: !s.isWorking || (shiftData && shiftData.CapacityHrs === 0)
                                                  ? 'var(--mantine-color-gray-1)'
                                                  : snapshot.isDraggingOver ? 'var(--mantine-color-indigo-0)' : 'white',
                                                backgroundImage: !s.isWorking || (shiftData && shiftData.CapacityHrs === 0)
                                                  ? 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.02) 10px, rgba(0,0,0,0.02) 20px)'
                                                  : undefined
                                              }}
                                            >
                                              {s.isWorking && (!shiftData || shiftData.CapacityHrs > 0) ? (
                                                <>
                                                  <Box p="6px" style={{ borderBottom: '1px solid var(--mantine-color-gray-1)', backgroundColor: isOver ? 'var(--mantine-color-red-0)' : 'transparent' }}>
                                                    <Group justify="space-between" gap={0} wrap="nowrap">
                                                      <Text size="9px" fw={800} c={isOver ? 'red.7' : (effectiveHours ? 'dark' : 'dimmed')}>
                                                        {effectiveHours.toFixed(1)}h
                                                      </Text>
                                                      <Text size="8px" fw={700} c="dimmed">/ {shiftData?.CapacityHrs || 0}h</Text>
                                                    </Group>
                                                    <Box mt={2} style={{ height: 3, borderRadius: 1.5, backgroundColor: 'var(--mantine-color-gray-1)', overflow: 'hidden' }}>
                                                      <Box style={{ height: '100%', width: `${Math.min(util, 100)}%`, backgroundColor: isOver ? 'var(--mantine-color-red-5)' : (util > 0 ? 'var(--mantine-color-green-5)' : 'transparent') }} />
                                                    </Box>
                                                  </Box>
                                                  <Box p="xs" style={{ flex: 1, minHeight: '120px' }}>
                                                    {shiftData?.Jobs.map((job, idx) => (
                                                      <JobCard
                                                        key={job.Id}
                                                        job={job}
                                                        index={idx}
                                                        weekDates={weekDates}
                                                        columnIndex={d.dateIdx}
                                                        shiftSettings={shiftSettings}
                                                        onUpdateQty={handleUpdateJobQty}
                                                        onPreviewChange={(id, qty) => {
                                                          if (qty === null) setPreviewData(null);
                                                          else setPreviewData({ jobId: id, qty });
                                                        }}
                                                      />
                                                    ))}
                                                    {provided.placeholder}
                                                  </Box>
                                                </>
                                              ) : (
                                                <Center style={{ height: '100%', padding: '20px' }}>
                                                  <Text size="10px" fw={800} c="gray.4" style={{ transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>
                                                    {shiftData && shiftData.CapacityHrs === 0 ? "CAPACITY 0h" : "SHIFT OFF"}
                                                  </Text>
                                                </Center>
                                              )}
                                            </Box>
                                          )}
                                        </Droppable>
                                      );
                                    })}
                                  </Box>
                                ))}
                              </Box>
                            )
                          })}
                        </Box>
                      )
                    })}
                  </Stack>
                </Box>
              </ScrollArea>
            </Paper>
          </Flex>
        )}
      </DragDropContext>
    </Box>
  );
}
