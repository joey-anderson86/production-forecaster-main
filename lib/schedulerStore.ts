import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SchedulerState, SchedulerMeta } from './types';

interface SchedulerStoreState {
  // The actual schedule data
  data: Record<string, Record<string, SchedulerState>>; // weekId -> processName -> state
  // Tracking metadata (hierarchy, etc)
  meta: SchedulerMeta | null;
  // Tracking unsaved changes per week/process
  dirty: Record<string, Record<string, boolean>>; // weekId -> processName -> dirty
  // Tracking submission status
  wasSubmitted: Record<string, Record<string, boolean>>; // weekId -> processName -> wasSubmitted
}

interface SchedulerActions {
  setSchedulerState: (weekId: string, processName: string, state: SchedulerState) => void;
  updateSchedulerState: (weekId: string, processName: string, updater: (prev: SchedulerState | null) => SchedulerState | null) => void;
  setMeta: (meta: SchedulerMeta) => void;
  setDirty: (weekId: string, processName: string, dirty: boolean) => void;
  setWasSubmitted: (weekId: string, processName: string, submitted: boolean) => void;
  clearState: (weekId: string, processName: string) => void;
  getSchedulerState: (weekId: string, processName: string) => SchedulerState | null;
  isDirty: (weekId: string, processName: string) => boolean;
}

export type SchedulerStore = SchedulerStoreState & SchedulerActions;

export const useSchedulerStore = create<SchedulerStore>()(
  persist(
    (set, get) => ({
      data: {},
      meta: null,
      dirty: {},
      wasSubmitted: {},

      setSchedulerState: (weekId, processName, state) => set((s) => {
        const newData = { ...s.data };
        if (!newData[weekId]) newData[weekId] = {};
        newData[weekId][processName] = state;
        return { data: newData };
      }),

      updateSchedulerState: (weekId, processName, updater) => set((s) => {
        const currentState = s.data[weekId]?.[processName] || null;
        const newState = updater(currentState);
        if (!newState) return s;
        
        const newData = { ...s.data };
        if (!newData[weekId]) newData[weekId] = {};
        newData[weekId][processName] = newState;
        return { data: newData };
      }),

      setMeta: (meta) => set({ meta }),

      setDirty: (weekId, processName, dirty) => set((s) => {
        const newDirty = { ...s.dirty };
        if (!newDirty[weekId]) newDirty[weekId] = {};
        newDirty[weekId][processName] = dirty;
        return { dirty: newDirty };
      }),

      setWasSubmitted: (weekId, processName, submitted) => set((s) => {
        const newSubmitted = { ...s.wasSubmitted };
        if (!newSubmitted[weekId]) newSubmitted[weekId] = {};
        newSubmitted[weekId][processName] = submitted;
        return { wasSubmitted: newSubmitted };
      }),

      clearState: (weekId, processName) => set((s) => {
        const newData = { ...s.data };
        if (newData[weekId]) {
          delete newData[weekId][processName];
        }
        const newDirty = { ...s.dirty };
        if (newDirty[weekId]) {
          delete newDirty[weekId][processName];
        }
        const newSubmitted = { ...s.wasSubmitted };
        if (newSubmitted[weekId]) {
          delete newSubmitted[weekId][processName];
        }
        return { data: newData, dirty: newDirty, wasSubmitted: newSubmitted };
      }),

      getSchedulerState: (weekId, processName) => {
        return get().data[weekId]?.[processName] || null;
      },

      isDirty: (weekId, processName) => {
        return get().dirty[weekId]?.[processName] || false;
      }
    }),
    {
      name: 'equipment-scheduler-storage',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
