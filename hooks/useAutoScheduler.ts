import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { notifications } from '@mantine/notifications';
import { SchedulerState } from '@/lib/types';
import { produce } from 'immer';
import { DAYS_OF_WEEK } from '@/lib/dateUtils';

export function useAutoScheduler(
  currentWeekId: string,
  processName: string | null,
  setData: (updater: (prev: SchedulerState | null) => SchedulerState | null) => void,
  setDirty: (isDirty: boolean) => void,
  calculateTotalHours: (jobs: any[]) => number,
  consolidateJobsList: (jobs: any[]) => any[],
  weekDates: Date[]
) {
  const [isAutoScheduling, setIsAutoScheduling] = useState(false);

  const handleAutoSchedule = async () => {
    setIsAutoScheduling(true);
    try {
      const store = await load("store.json", { autoSave: false, defaults: {} });
      const connectionString = await store.get<string>("db_connection_string");
      if (!connectionString) throw new Error("No DB connection");

      const response: any = await invoke('run_auto_scheduler', {
        connectionString,
        weekId: currentWeekId,
        processName: processName || 'All Processes'
      });

      setData(prev => {
        if (!prev) return null;
        
        return produce(prev, draft => {
          // Replace backlog with the remaining backlog
          draft.Unassigned = response.remainingBacklog.map((j: any) => ({
            ...j,
            MaxQty: j.TargetQty,
            OriginalShift: j.OriginalShift || j.Shift,
            OriginalDate: j.OriginalDate || j.Id.split('|')[2]
          }));

          // Process newly scheduled tasks
          response.newlyScheduled.forEach((task: any) => {
            const originalJob = prev.Unassigned.find(j => j.Id === task.originalJobId);
            if (!originalJob) {
              console.error(`Original job not found for newly scheduled task: ${task.originalJobId}`);
              return;
            }

            const mIdNorm = task.machineId.trim().toUpperCase();
            const mInfo = draft.Machines[mIdNorm];
            if (!mInfo) {
              console.error(`Machine not found in state: ${task.machineId} (Normalized: ${mIdNorm})`);
              return;
            }

            const targetDayIdx = weekDates.findIndex(d => {
              const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              return ds === task.date;
            });

            if (targetDayIdx === -1) {
              console.error(`Day not found for date: ${task.date}`);
              return;
            }

            const dayStr = DAYS_OF_WEEK[targetDayIdx];

            // Ensure the day and shift slot exist in the UI state
            if (!mInfo.Schedule[dayStr]) {
              mInfo.Schedule[dayStr] = {};
            }
            if (!mInfo.Schedule[dayStr][task.shift]) {
              mInfo.Schedule[dayStr][task.shift] = {
                Jobs: [],
                CapacityHrs: 0,
                TotalAssignedHours: 0
              };
            }

            const shiftData = mInfo.Schedule[dayStr][task.shift];

            const jobToAdd = {
              ...originalJob,
              Id: `${originalJob.Id}|${task.machineId}|${dayStr}|${task.shift}|${Date.now()}`,
              TargetQty: task.quantity,
              Shift: task.shift
            };

            shiftData.Jobs.push(jobToAdd as any);
            shiftData.TotalAssignedHours = calculateTotalHours(shiftData.Jobs);
          });
          
          // Consolidate backlog to merge fragments while keeping shortfalls separate
          draft.Unassigned = consolidateJobsList(draft.Unassigned);

          // Consolidate shifts
          Object.values(draft.Machines).forEach(m => {
            Object.values(m.Schedule).forEach(day => {
              Object.values(day).forEach(shift => {
                 const consolidatedJobs: any[] = [];
                 shift.Jobs.forEach(job => {
                   const existing = consolidatedJobs.find(j => 
                     !j.IsBatchSplit && !job.IsBatchSplit &&
                     j.PartNumber === job.PartNumber &&
                     j.OriginalDate === job.OriginalDate &&
                     j.OriginalShift === job.OriginalShift
                   );
                   if (existing) {
                      existing.TargetQty += job.TargetQty;
                   } else {
                      consolidatedJobs.push(job);
                   }
                 });
                 shift.Jobs = consolidatedJobs;
                 shift.TotalAssignedHours = calculateTotalHours(shift.Jobs);
              });
            });
          });
        });
      });

      notifications.show({ 
        title: 'Auto-Scheduling Complete', 
        message: `Successfully scheduled ${response.newlyScheduled.length} operations. ${response.remainingBacklog.length} parts remain in the backlog.`, 
        color: 'green' 
      });

      setDirty(true);
    } catch (e: any) {
       notifications.show({ title: 'Auto-Scheduling Failed', message: e.toString(), color: 'red' });
    } finally {
      setIsAutoScheduling(false);
    }
  };

  return { isAutoScheduling, handleAutoSchedule };
}
