'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import { Box, Paper, Text, Group, Stack, ScrollArea, Badge, Select, Divider, Loader, Center, Button, Flex, MultiSelect, Modal, TextInput, NumberInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconBox, IconBolt, IconFilterOff, IconArrowsSplit } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { DAYS_OF_WEEK, DayOfWeek, isWorkingDay, getWeekDates, getCurrentWeekId } from '@/lib/dateUtils';
import { useScorecardStore } from '@/lib/scorecardStore';
import { useProcessStore } from '@/lib/processStore';
import { useSchedulerStore } from '@/lib/schedulerStore';
import { JobAssignment, BacklogItem, PartMachineCapability, MachineState, JobBlock, ShiftSchedule, MachineSchedule, SchedulerState, SchedulerMeta } from '@/lib/types';
import { produce } from 'immer';

import JobCard from './scheduler/JobCard';
import SchedulerHeader from './scheduler/SchedulerHeader';
import { useAutoScheduler } from '@/hooks/useAutoScheduler';

// --- Interfaces ---



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



function calculateTotalHours(jobs: JobBlock[]): number {
  return jobs.reduce((sum, job) => sum + ((job.TargetQty * job.ProcessingTimeMins) / 60), 0);
}

function revertToOriginalPlan(job: JobBlock): JobBlock {
  const origDate = job.OriginalDate || job.Id.split('|')[2];
  const origShift = job.OriginalShift || job.Shift;
  
  const idParts = job.Id.split('|');
  // If it's a standard ID (Part|Shift|Date|Unique), update it to original
  if (idParts.length >= 3) {
    idParts[1] = origShift;
    idParts[2] = origDate;
  }

  return {
    ...job,
    Shift: origShift,
    Id: idParts.join('|')
  };
}

interface EquipmentSchedulerProps {
  initialState?: SchedulerState;
  initialWeekId?: string;
  initialProcessName?: string;
}

// --- Main Component ---
export default function EquipmentScheduler({ initialState, initialWeekId, initialProcessName }: EquipmentSchedulerProps) {

  const shiftSettings = useScorecardStore(state => state.shiftSettings);

  const { 
    setSchedulerState, 
    updateSchedulerState,
    setMeta, 
    setDirty: setStoreDirty, 
    setWasSubmitted: setStoreWasSubmitted,
    data: storeData,
    meta: storeMeta,
    dirty: storeDirtyMap,
    wasSubmitted: storeWasSubmittedMap
  } = useSchedulerStore();

  const [currentWeekId, setCurrentWeekId] = useState(initialWeekId || getCurrentWeekId());
  const { processes, activeProcess: processName, setActiveProcess: setProcessName } = useProcessStore();
  
  const effectiveProcessName = processName || 'All Processes';
  
  // Get state from store
  const data = storeData[currentWeekId]?.[effectiveProcessName] || null;
  const meta = storeMeta;
  const dirty = storeDirtyMap[currentWeekId]?.[effectiveProcessName] || false;
  const wasSubmitted = storeWasSubmittedMap[currentWeekId]?.[effectiveProcessName] || false;

  const setData = useCallback((updater: SchedulerState | null | ((prev: SchedulerState | null) => SchedulerState | null)) => {
    if (typeof updater === 'function') {
      updateSchedulerState(currentWeekId, effectiveProcessName, updater);
    } else if (updater) {
      setSchedulerState(currentWeekId, effectiveProcessName, updater);
    }
  }, [currentWeekId, effectiveProcessName, setSchedulerState, updateSchedulerState]);

  const setDirty = useCallback((isDirty: boolean) => {
    setStoreDirty(currentWeekId, effectiveProcessName, isDirty);
  }, [currentWeekId, effectiveProcessName, setStoreDirty]);

  const setWasSubmitted = useCallback((isSubmitted: boolean) => {
    setStoreWasSubmitted(currentWeekId, effectiveProcessName, isSubmitted);
  }, [currentWeekId, effectiveProcessName, setStoreWasSubmitted]);

  const [backlogDay, setBacklogDay] = useState<DayOfWeek | 'All'>('Mon');
  const [backlogPartFilter, setBacklogPartFilter] = useState("");
  const [backlogShiftFilter, setBacklogShiftFilter] = useState<string | null>(null);
  const [visibleDays, setVisibleDays] = useState<string[]>(DAYS_OF_WEEK);
  const [previewData, setPreviewData] = useState<{ jobId: string, qty: number } | null>(null);
  const [allowedDropMachines, setAllowedDropMachines] = useState<string[] | null>(null);

  const consolidateJobsList = useCallback((jobs: JobBlock[]) => {
    const consolidated: JobBlock[] = [];
    jobs.forEach(item => {
      const itemDate = item.Id.split('|')[2];
      const existingIdx = consolidated.findIndex(j =>
        !j.IsBatchSplit && !item.IsBatchSplit && // Don't consolidate if either is a batch split
        j.PartNumber.trim().toLowerCase() === item.PartNumber.trim().toLowerCase() &&
        j.Shift === item.Shift &&
        j.Id.split('|')[2] === itemDate &&
        j.OriginalDate === item.OriginalDate &&
        j.OriginalShift === item.OriginalShift &&
        !!j.IsOverflow === !!item.IsOverflow // Differentiate shortfalls from regular backlog
      );

      if (existingIdx !== -1) {
        consolidated[existingIdx].TargetQty += item.TargetQty;
        if (consolidated[existingIdx].MaxQty !== undefined || item.MaxQty !== undefined) {
          consolidated[existingIdx].MaxQty = (consolidated[existingIdx].MaxQty || 0) + (item.MaxQty || item.TargetQty);
        }
        // Preserve original metadata if available
        if (!consolidated[existingIdx].OriginalDate) consolidated[existingIdx].OriginalDate = item.OriginalDate;
        if (!consolidated[existingIdx].OriginalShift) consolidated[existingIdx].OriginalShift = item.OriginalShift;
      } else {
        consolidated.push({ ...item });
      }
    });
    return consolidated;
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearModalOpened, setClearModalOpened] = useState(false);

  const [loading, setLoading] = useState(true);
  const [comparisonModalOpened, setComparisonModalOpened] = useState(false);
  const [comparisonData, setComparisonData] = useState<any[]>([]);
  const [isUpdatingTargets, setIsUpdatingTargets] = useState(false);

  // Split Logic State
  const [splitModalOpened, setSplitModalOpened] = useState(false);
  const [jobToSplitId, setJobToSplitId] = useState<string | null>(null);
  const [splitNumBatches, setSplitNumBatches] = useState<number>(2);

  const weekDates = useMemo(() => {
    try {
      return getWeekDates(currentWeekId);
    } catch {
      return [];
    }
  }, [currentWeekId]);

  const hasScheduledJobs = useMemo(() => {
    if (!data) return false;
    return Object.values(data.Machines).some(m =>
      Object.values(m.Schedule).some(d =>
        Object.values(d).some(s => s.Jobs.length > 0)
      )
    );
  }, [data]);

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
    let mList = allMachines;

    // Apply auto-filter based on backlog search
    if (backlogPartFilter && meta?.PartMachineMap && data) {
      const lowerFilter = backlogPartFilter.trim().toLowerCase();
      
      // Find parts in the backlog that match the filter
      const matchingParts = data.Unassigned
        .map(j => j.PartNumber.trim())
        .filter(p => p.toLowerCase().includes(lowerFilter));

      if (matchingParts.length > 0) {
        const allowedForFiltered = new Set<string>();
        let showAll = false;

        matchingParts.forEach(part => {
          const normalizedPart = part.toUpperCase();
          // Find the exact key in the map (handling potential casing/whitespace mismatches)
          const machinesKey = Object.keys(meta.PartMachineMap || {}).find(k => k.trim().toUpperCase() === normalizedPart);
          const constraints = machinesKey && meta.PartMachineMap ? meta.PartMachineMap[machinesKey] : null;

          // If any matching part has no defined constraints, it can run on all equipment
          if (!constraints || constraints.length === 0) {
            showAll = true;
          } else {
            constraints.forEach(mId => allowedForFiltered.add(mId.trim().toUpperCase()));
          }
        });

        if (!showAll) {
          // Normalize mId for comparison
          mList = mList.filter(mId => allowedForFiltered.has(mId.trim().toUpperCase()));
        }
      }
    }

    if (selectedEquipment.length === 0) return mList;
    return mList.filter(mId => selectedEquipment.includes(mId));
  }, [allMachines, selectedEquipment, backlogPartFilter, meta, data]);

  const multiSelectData = useMemo(() => {
    return allMachines.map(m => ({ value: m, label: m }));
  }, [allMachines]);

  const daysWithShifts = useMemo(() => {
    if (!data) return [];
    const ALL_SHIFTS = ['A', 'B', 'C', 'D'];
    return DAYS_OF_WEEK.map((day, idx) => {
      const date = weekDates[idx];
      const shifts = ALL_SHIFTS.map(sId => {
        // Check if ANY machine has capacity for this shift on this day
        const hasCapacity = Object.values(data.Machines).some(m => 
          m.Schedule[day]?.[sId]?.CapacityHrs > 0
        );
        return { id: sId, isWorking: hasCapacity };
      }).filter(s => s.isWorking);

      return {
        day,
        dateStr: date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
        shifts,
        dateIdx: idx
      };
    }).filter(d => d.shifts.length > 0 && visibleDays.includes(d.day));
  }, [data, weekDates, visibleDays]);

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
  }, [setMeta]);

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
                    Object.entries(shifts).map(([sId, sData]) => {
                      const dayIdx = DAYS_OF_WEEK.indexOf(day as DayOfWeek);
                      const dateObj = weekDates[dayIdx];
                      const dateStr = dateObj ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}` : '';

                      return [
                        sId,
                        { 
                          ...sData, 
                          Jobs: sData.Jobs.map(j => {
                            // Standardize ID to include date so moves can be tracked correctly
                            const formattedId = j.Id.includes('|') ? j.Id : `${j.PartNumber}|${j.Shift}|${dateStr}|${j.Id}`;
                            return { 
                              ...j, 
                              Id: formattedId,
                              MaxQty: j.TargetQty, 
                              OriginalShift: j.OriginalShift || j.Shift, 
                              OriginalDate: j.OriginalDate || (formattedId.split('|')[2]) 
                            };
                          }) 
                        }
                      ];
                    })
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
  }, [currentWeekId, processName, setData, setDirty, consolidateJobsList, weekDates]);

  const handleUpdateJobQty = useCallback((jobId: string, newQty: number) => {
    setData(prev => {
      if (!prev) return null;
      return produce(prev, draft => {
        let foundJob: JobBlock | null = null;
        let machineId: string | undefined;
        let day: string | undefined;
        let shift: string | undefined;

        const uIdx = draft.Unassigned.findIndex(j => j.Id === jobId);
        if (uIdx !== -1) {
          foundJob = draft.Unassigned[uIdx];
        } else {
          outer: for (const [mId, mInfo] of Object.entries(draft.Machines)) {
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

        if (!foundJob) return;

        const oldQty = foundJob.TargetQty;

        const createBatchCards = (job: JobBlock, totalQtyToSplit: number): JobBlock[] => {
          const batchSize = job.StandardBatchSize || totalQtyToSplit;
          const numFullBatches = Math.floor(totalQtyToSplit / batchSize);
          const remainder = totalQtyToSplit % batchSize;
          const batchCards: JobBlock[] = [];
          
          for (let i = 0; i < numFullBatches; i++) {
            let batchCard: JobBlock = {
              ...job,
              Id: `${job.Id}|split|${i}|${Date.now()}`,
              TargetQty: batchSize,
              MaxQty: batchSize,
              IsBatchSplit: true
            };
            if (machineId) batchCard = revertToOriginalPlan(batchCard);
            batchCards.push(batchCard);
          }
          
          if (remainder > 0) {
            let remCard: JobBlock = {
              ...job,
              Id: `${job.Id}|split|rem|${Date.now()}`,
              TargetQty: remainder,
              MaxQty: remainder,
              IsBatchSplit: true
            };
            if (machineId) remCard = revertToOriginalPlan(remCard);
            batchCards.push(remCard);
          }
          
          return batchCards;
        };

        if (newQty < oldQty) {
          foundJob.TargetQty = newQty;
          foundJob.IsBatchSplit = true;

          if (machineId && day && shift) {
            const sData = draft.Machines[machineId].Schedule[day][shift];
            sData.TotalAssignedHours = calculateTotalHours(sData.Jobs);
          }

          const remainderQty = oldQty - newQty;
          const newBatchCards = createBatchCards(foundJob, remainderQty);
          draft.Unassigned.push(...newBatchCards);
          draft.Unassigned = consolidateJobsList(draft.Unassigned);

        } else if (newQty > oldQty) {
          const additionalQty = newQty - oldQty;
          const newBatchCards = createBatchCards(foundJob, additionalQty);
          draft.Unassigned.push(...newBatchCards);
          draft.Unassigned = consolidateJobsList(draft.Unassigned);
          
          if (machineId && day && shift) {
             const sData = draft.Machines[machineId].Schedule[day][shift];
             sData.TotalAssignedHours = calculateTotalHours(sData.Jobs);
          }
        }
      });
    });
    setPreviewData(null);
    setDirty(true);
  }, [setData, setDirty, consolidateJobsList]);

  const handleSplitJob = useCallback((jobId: string, numBatches: number) => {
    setData(prev => {
      if (!prev) return null;
      return produce(prev, draft => {
        let targetJob: JobBlock | null = null;
        let sourceList: JobBlock[] | null = null;
        let jobIdx = -1;
        let machineId: string | undefined;
        let day: string | undefined;
        let shift: string | undefined;

        jobIdx = draft.Unassigned.findIndex(j => j.Id === jobId);
        if (jobIdx !== -1) {
          targetJob = draft.Unassigned[jobIdx];
          sourceList = draft.Unassigned;
        } else {
          outer: for (const [mId, mInfo] of Object.entries(draft.Machines)) {
            for (const [dKey, dShifts] of Object.entries(mInfo.Schedule)) {
              for (const [sKey, sData] of Object.entries(dShifts)) {
                const jIdx = sData.Jobs.findIndex(j => j.Id === jobId);
                if (jIdx !== -1) {
                  targetJob = sData.Jobs[jIdx];
                  sourceList = sData.Jobs;
                  jobIdx = jIdx;
                  machineId = mId;
                  day = dKey;
                  shift = sKey;
                  break outer;
                }
              }
            }
          }
        }

        if (!targetJob || !sourceList || jobIdx === -1) return;

        const totalQty = targetJob.TargetQty;
        const baseQty = Math.floor(totalQty / numBatches);
        const remainder = totalQty % numBatches;

        if (baseQty <= 0 && totalQty > 0 && numBatches > totalQty) {
          notifications.show({
            title: 'Cannot Split',
            message: `Cannot split ${totalQty} into ${numBatches} batches.`,
            color: 'red'
          });
          return;
        }

        const newJobs: JobBlock[] = [];
        for (let i = 0; i < numBatches; i++) {
          let qty = baseQty;
          if (i < remainder) qty += 1;
          
          if (qty <= 0) continue;

          newJobs.push({
            ...targetJob,
            Id: `${targetJob.Id}|split|${i}|${Date.now()}`,
            TargetQty: qty,
            MaxQty: qty,
            IsBatchSplit: true
          });
        }

        sourceList.splice(jobIdx, 1, ...newJobs);

        if (machineId && day && shift) {
          const sData = draft.Machines[machineId].Schedule[day][shift];
          sData.TotalAssignedHours = calculateTotalHours(sData.Jobs);
        }
      });
    });
    setDirty(true);
    setSplitModalOpened(false);
  }, [setData, setDirty]);

  useEffect(() => {
    if (!meta) {
      fetchMeta();
    }
  }, [fetchMeta, meta]);

  useEffect(() => {
    if (!data) {
      fetchUtilization();
    } else {
      setLoading(false);
    }
  }, [fetchUtilization, data]);

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
      return produce(prev, draft => {
        let movedJob: JobBlock;
        if (source.droppableId === 'unassigned') {
          movedJob = draft.Unassigned[source.index];
          draft.Unassigned.splice(source.index, 1);
        } else {
          const [sourceMachine, sourceDay, sourceShift] = source.droppableId.split('|');
          const shiftData = draft.Machines[sourceMachine].Schedule[sourceDay][sourceShift];
          movedJob = shiftData.Jobs[source.index];
          shiftData.Jobs.splice(source.index, 1);
          shiftData.TotalAssignedHours = calculateTotalHours(shiftData.Jobs);
        }

        if (destination.droppableId === 'unassigned') {
          movedJob = revertToOriginalPlan(movedJob);

          const filteredUnassigned = draft.Unassigned
            .map((job, idx) => ({ job, idx }))
            .filter(({ job }) => {
              if (backlogDay === 'All') return true;
              const jobDateStr = job.Id.split('|')[2];
              const dayIdx = weekDates.findIndex(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === jobDateStr);
              return DAYS_OF_WEEK[dayIdx] === backlogDay;
            });

          if (filteredUnassigned.length > 0 && destination.index < filteredUnassigned.length) {
            const targetIndex = filteredUnassigned[destination.index].idx;
            draft.Unassigned.splice(targetIndex, 0, movedJob);
          } else {
            draft.Unassigned.push(movedJob);
          }
          draft.Unassigned = consolidateJobsList(draft.Unassigned);
        } else {
          const [destMachine, destDay, destShift] = destination.droppableId.split('|');

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

          if (!draft.Machines[destMachine].Schedule[destDay]) {
            draft.Machines[destMachine].Schedule[destDay] = {};
          }
          if (!draft.Machines[destMachine].Schedule[destDay][destShift]) {
            draft.Machines[destMachine].Schedule[destDay][destShift] = {
              Jobs: [],
              CapacityHrs: draft.Machines[destMachine].DailyCapacityHrs || 0,
              TotalAssignedHours: 0
            };
          }
          const shiftData = draft.Machines[destMachine].Schedule[destDay][destShift];

          const availableHours = shiftData.CapacityHrs - shiftData.TotalAssignedHours;
          const neededHours = (movedJob.TargetQty * movedJob.ProcessingTimeMins) / 60;

          if (neededHours > availableHours) {
            const qtyThatFits = Math.floor((availableHours * 60) / movedJob.ProcessingTimeMins);

            if (qtyThatFits > 0) {
              const originalQty = movedJob.TargetQty;
              const leftoverQty = originalQty - qtyThatFits;

              movedJob.TargetQty = qtyThatFits;
              movedJob.MaxQty = qtyThatFits;

              const remainderJob: JobBlock = revertToOriginalPlan({
                ...movedJob,
                Id: `${movedJob.Id}|split|${Date.now()}`,
                TargetQty: leftoverQty,
                MaxQty: leftoverQty,
                IsBatchSplit: true,
                IsOverflow: true,
                OriginalDate: movedJob.OriginalDate,
                OriginalShift: movedJob.OriginalShift
              });

              draft.Unassigned.push(remainderJob);
              draft.Unassigned = consolidateJobsList(draft.Unassigned);
            } else {
              draft.Unassigned.push(revertToOriginalPlan(movedJob));
              draft.Unassigned = consolidateJobsList(draft.Unassigned);
              setTimeout(() => {
                notifications.show({ title: 'Shift Full: Card returned to backlog', message: 'Not enough capacity to place this job.', color: 'yellow' });
              }, 0);
              return;
            }
          }

          const existingJobIdx = shiftData.Jobs.findIndex(j =>
            j.PartNumber.trim().toLowerCase() === movedJob.PartNumber.trim().toLowerCase() &&
            j.OriginalDate === movedJob.OriginalDate &&
            j.OriginalShift === movedJob.OriginalShift
          );

          if (existingJobIdx !== -1) {
            const existingJob = shiftData.Jobs[existingJobIdx];
            shiftData.Jobs[existingJobIdx] = {
              ...existingJob,
              TargetQty: existingJob.TargetQty + movedJob.TargetQty,
              MaxQty: (existingJob.MaxQty || 0) + (movedJob.MaxQty || movedJob.TargetQty)
            };
          } else {
            shiftData.Jobs.splice(destination.index, 0, movedJob);
          }

          shiftData.TotalAssignedHours = calculateTotalHours(shiftData.Jobs);
        }
      });
    });

    setDirty(true);
  }, [weekDates, backlogDay, consolidateJobsList, setData, setDirty]);

  const handleSubmit = useCallback(async () => {
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
      setWasSubmitted(true);
      fetchUtilization();
    } catch (e: any) {
      notifications.show({ title: 'Submission Failed', message: e.toString(), color: 'red' });
    } finally {
      setIsSubmitting(false);
    }
  }, [data, currentWeekId, processName, weekDates, fetchUtilization, setDirty, setWasSubmitted]);

  const handleClearSchedule = useCallback(async () => {
    try {
      setIsClearing(true);
      const store = await load("store.json", { autoSave: false, defaults: {} });
      const connectionString = await store.get<string>("db_connection_string");
      if (!connectionString) throw new Error("Connection string not found");

      // Passing an empty array to save_scheduler_state effectively clears the DB for this week/department
      await invoke('save_scheduler_state', { 
        connectionString, 
        department: processName, 
        weekId: currentWeekId, 
        assignments: [] 
      });

      notifications.show({ 
        title: 'Schedule Cleared', 
        message: 'All assignments have been removed and parts returned to backlog.', 
        color: 'green' 
      });
      
      setClearModalOpened(false);
      await fetchUtilization();
    } catch (e: any) {
      notifications.show({ 
        title: 'Clear Failed', 
        message: e.toString(), 
        color: 'red' 
      });
    } finally {
      setIsClearing(false);
    }
  }, [processName, currentWeekId, fetchUtilization]);

  const handleGenerateChangeover = useCallback(async () => {
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
  }, [data, daysWithShifts, processName, currentWeekId]);

  const { isAutoScheduling, handleAutoSchedule } = useAutoScheduler(
    currentWeekId,
    processName,
    setData,
    setDirty,
    calculateTotalHours,
    consolidateJobsList,
    weekDates
  );

  const handlePreviewChange = useCallback((id: string, qty: number | null) => {
    if (qty === null) setPreviewData(null);
    else setPreviewData({ jobId: id, qty });
  }, []);

  const handleSplitJobInit = useCallback((id: string) => {
    setJobToSplitId(id);
    setSplitModalOpened(true);
  }, []);

  return (
    <Box p={0} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <SchedulerHeader 
        currentWeekId={currentWeekId}
        setCurrentWeekId={setCurrentWeekId}
        processName={processName}
        setProcessName={setProcessName}
        processes={processes}
        meta={meta}
        aggregateStats={aggregateStats}
        dataUnassignedLength={data?.Unassigned.length || 0}
        isSubmitting={isSubmitting}
        isAutoScheduling={isAutoScheduling}
        isClearing={isClearing}
        hasScheduledJobs={hasScheduledJobs}
        dirty={dirty}
        wasSubmitted={wasSubmitted}
        handleGenerateChangeover={handleGenerateChangeover}
        handleAutoSchedule={handleAutoSchedule}
        handleSubmit={handleSubmit}
        setClearModalOpened={setClearModalOpened}
        setComparisonModalOpened={setComparisonModalOpened}
        setComparisonData={setComparisonData}
      />

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
                  <Select size="xs" data={['All', ...DAYS_OF_WEEK]} value={backlogDay} onChange={(val) => setBacklogDay(val as any)} label="Filter by planned day:" styles={{ label: { fontSize: '12px', fontWeight: 700, color: 'var(--mantine-color-gray-6)' } }} />
                  <Group grow gap="xs">
                    <Select 
                      size="xs" 
                      data={['All', 'A', 'B', 'C', 'D']} 
                      value={backlogShiftFilter || 'All'} 
                      onChange={(val) => setBacklogShiftFilter(val === 'All' ? null : val)} 
                      label="Shift:" 
                      styles={{ label: { fontSize: '12px', fontWeight: 700, color: 'var(--mantine-color-gray-6)' } }} 
                    />
                    <Box style={{ flexGrow: 2 }}>
                       <TextInput 
                        size="xs" 
                        placeholder="Search Part..." 
                        value={backlogPartFilter} 
                        onChange={(e) => setBacklogPartFilter(e.target.value)} 
                        label="Part Number:" 
                        styles={{ label: { fontSize: '12px', fontWeight: 700, color: 'var(--mantine-color-gray-6)' } }} 
                      />
                    </Box>
                  </Group>
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
                          // Day filter
                          let matchDay = true;
                          if (backlogDay !== 'All') {
                            const jobDateStr = job.Id.split('|')[2];
                            const dayIdx = weekDates.findIndex(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === jobDateStr);
                            matchDay = DAYS_OF_WEEK[dayIdx] === backlogDay;
                          }
                          
                          // Part filter
                          const matchPart = !backlogPartFilter || job.PartNumber.toLowerCase().includes(backlogPartFilter.toLowerCase());
                          
                          // Shift filter
                          const matchShift = !backlogShiftFilter || job.Shift === backlogShiftFilter;
                          
                          return matchDay && matchPart && matchShift;
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
                            onPreviewChange={handlePreviewChange}
                            onSplitJob={handleSplitJobInit}
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
                  <Stack gap="xs">
                    <Group grow gap="md">
                      <MultiSelect
                        placeholder="Filter equipment to focus scheduling..."
                        data={multiSelectData}
                        value={selectedEquipment}
                        onChange={setSelectedEquipment}
                        searchable
                        clearable
                        size="xs"
                        label={<Text size="12px" fw={700} c="dimmed">LINE FILTER</Text>}
                      />
                      <MultiSelect
                        placeholder="Visible days..."
                        data={DAYS_OF_WEEK.map(d => ({ value: d, label: d }))}
                        value={visibleDays}
                        onChange={setVisibleDays}
                        size="xs"
                        label={<Text size="12px" fw={700} c="dimmed">VISIBLE DAYS</Text>}
                      />
                    </Group>
                    {backlogPartFilter && (
                      <Group gap={6} align="center">
                        <IconFilterOff size={14} color="var(--mantine-color-indigo-6)" />
                        <Text size="11px" fw={700} c="indigo.7">
                          Grid auto-filtered by backlog search: "{backlogPartFilter}"
                        </Text>
                        <Badge size="xs" color="indigo" variant="light" style={{ cursor: 'pointer' }} onClick={() => setBacklogPartFilter("")}>
                          Clear
                        </Badge>
                      </Group>
                    )}
                  </Stack>
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
                      <Box key={d.day} style={{ flex: '1 1 0px', minWidth: '0px', width: '0px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--mantine-color-gray-3)' }}>
                        <Box p="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', textAlign: 'center', backgroundColor: 'var(--mantine-color-gray-1)' }}>
                          <Text fw={800} size="xs">{d.day.toUpperCase()} ({d.dateStr})</Text>
                        </Box>
                        <Box style={{ display: 'flex' }}>
                          {d.shifts.map(s => (
                            <Box key={s.id} p="6px" style={{ flex: '1 1 0px', minWidth: '100px', width: '0px', maxWidth: '300px', overflow: 'hidden', textAlign: 'center', borderRight: s.id !== d.shifts[d.shifts.length - 1].id ? '1px solid var(--mantine-color-gray-1)' : 'none' }}>
                              <Text fw={700} size="11px" c={s.isWorking ? "dimmed" : "red.5"}>SH {s.id} {s.isWorking ? "" : "OFF"}</Text>
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
                                    <Group gap={4} wrap="nowrap"><IconBolt size={14} color="var(--mantine-color-green-6)" /><Text size="12px" c="dimmed" fw={600}>CAP: {machine.DailyCapacityHrs}h</Text></Group>
                                  </Stack>
                                </Box>

                                {daysWithShifts.map((d) => (
                                  <Box key={d.day} style={{ flex: '1 1 0px', minWidth: '0px', width: '0px', display: 'flex' }}>
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
                                                minWidth: '100px', maxWidth: '300px', overflow: 'hidden', width: '0px', flex: '1 1 0px',
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
                                                      <Text size="11px" fw={800} c={isOver ? 'red.7' : (effectiveHours ? 'dark' : 'dimmed')}>
                                                        {effectiveHours.toFixed(1)}h
                                                      </Text>
                                                      <Text size="10px" fw={700} c="dimmed">/ {shiftData?.CapacityHrs || 0}h</Text>
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
                                                        onPreviewChange={handlePreviewChange}
                            onSplitJob={handleSplitJobInit}
                                                      />
                                                    ))}
                                                    {provided.placeholder}
                                                  </Box>
                                                </>
                                              ) : (
                                                <Center style={{ height: '100%', padding: '20px' }}>
                                                  <Text size="12px" fw={800} c="gray.4" style={{ transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>
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
      <Modal
        opened={clearModalOpened}
        onClose={() => !isClearing && setClearModalOpened(false)}
        title={<Group gap="xs"><IconAlertTriangle color="var(--mantine-color-red-6)" size={20} /><Text fw={700}>Clear Schedule Confirmation</Text></Group>}
        centered
        size="md"
        padding="xl"
        overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
        styles={{ title: { width: '100%' } }}
      >
        <Stack gap="lg">
          <Text size="sm" style={{ lineHeight: 1.6 }}>
            Are you sure you want to reset this week's schedule? This will <strong>delete the current schedule from the database</strong> and move all part cards back into the backlog.
          </Text>
          <Text size="sm" c="dimmed" fw={500}>
            This action cannot be undone.
          </Text>
          <Group justify="end" mt="md">
            <Button 
              variant="default" 
              onClick={() => setClearModalOpened(false)} 
              disabled={isClearing}
            >
              Cancel
            </Button>
            <Button 
              color="red" 
              onClick={handleClearSchedule} 
              loading={isClearing}
              leftSection={<IconAlertTriangle size={16} />}
            >
              Confirm Reset
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={comparisonModalOpened}
        onClose={() => setComparisonModalOpened(false)}
        title={<Group gap="xs"><IconBox color="var(--mantine-color-teal-6)" size={20} /><Text fw={700}>Compare Schedule to Original Plan</Text></Group>}
        size="80%"
        styles={{ header: { borderBottom: '1px solid var(--mantine-color-gray-2)', marginBottom: 'sm' } }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            The following table shows the variance between the <strong>Original Planned Targets</strong> and your <strong>Current Equipment Schedule</strong>. 
            A positive variance means the schedule is short of the target; a negative variance means you've scheduled more than planned.
          </Text>

          <ScrollArea h={400}>
            <Box style={{ minWidth: 'max-content' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid var(--mantine-color-gray-3)', position: 'sticky', left: 0, zIndex: 2, backgroundColor: 'var(--mantine-color-gray-0)' }}>Part Number</th>
                    {Array.from(new Set(comparisonData.map(d => d.Date))).sort().map(date => (
                      <th key={date} style={{ padding: '10px', textAlign: 'center', border: '1px solid var(--mantine-color-gray-3)' }}>
                        {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </th>
                    ))}
                    <th style={{ padding: '10px', textAlign: 'center', border: '1px solid var(--mantine-color-gray-3)', fontWeight: 800 }}>Total Var</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(new Set(comparisonData.map(d => d.PartNumber))).sort().map(part => {
                    const partData = comparisonData.filter(d => d.PartNumber === part);
                    const dates = Array.from(new Set(comparisonData.map(d => d.Date))).sort();
                    let rowTotalVar = 0;
                    
                    return (
                      <tr key={part}>
                        <td style={{ padding: '8px', border: '1px solid var(--mantine-color-gray-3)', fontWeight: 700, position: 'sticky', left: 0, zIndex: 1, backgroundColor: 'white' }}>{part}</td>
                        {dates.map(date => {
                          const entry = partData.find(d => d.Date === date);
                          const variance = entry ? entry.Variance : 0;
                          rowTotalVar += variance;
                          return (
                            <td key={date} style={{ padding: '8px', border: '1px solid var(--mantine-color-gray-3)', textAlign: 'center', color: variance > 0 ? 'var(--mantine-color-red-7)' : variance < 0 ? 'var(--mantine-color-green-7)' : 'inherit', fontWeight: variance !== 0 ? 700 : 400 }}>
                              {variance === 0 ? '-' : variance.toLocaleString()}
                            </td>
                          );
                        })}
                        <td style={{ padding: '8px', border: '1px solid var(--mantine-color-gray-3)', textAlign: 'center', fontWeight: 800, backgroundColor: 'var(--mantine-color-gray-0)' }}>
                          {rowTotalVar === 0 ? '-' : rowTotalVar.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Box>
          </ScrollArea>

          <Group justify="end" mt="xl" p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
            <Button variant="default" onClick={() => setComparisonModalOpened(false)}>Close</Button>
            <Button 
              color="teal" 
              loading={isUpdatingTargets}
              onClick={async () => {
                try {
                  setIsUpdatingTargets(true);
                  const store = await load("store.json", { autoSave: false, defaults: {} });
                  const connectionString = await store.get<string>("db_connection_string");
                  if (!connectionString) return;

                  await invoke('update_targets_from_schedule', { connectionString, weekId: currentWeekId, department: processName });
                  notifications.show({ title: 'Targets Updated', message: 'Master production plan targets have been synchronized.', color: 'green' });
                  setComparisonModalOpened(false);
                } catch (e: any) {
                  notifications.show({ title: 'Update Failed', message: e.toString(), color: 'red' });
                } finally {
                  setIsUpdatingTargets(false);
                }
              }}
            >
              Update Targets in Plan
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={splitModalOpened}
        onClose={() => setSplitModalOpened(false)}
        title={<Group gap="xs"><IconArrowsSplit color="var(--mantine-color-indigo-6)" size={20} /><Text fw={700}>Split Job into Batches</Text></Group>}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Enter the number of batches to split this card into. The total quantity will be distributed as evenly as possible.
          </Text>
          <NumberInput
            label="Number of Batches"
            value={splitNumBatches}
            onChange={(val) => setSplitNumBatches(Number(val))}
            min={2}
            max={100}
            step={1}
          />
          <Group justify="end">
            <Button variant="default" onClick={() => setSplitModalOpened(false)}>Cancel</Button>
            <Button color="indigo" onClick={() => jobToSplitId && handleSplitJob(jobToSplitId, splitNumBatches)}>Split Card</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
