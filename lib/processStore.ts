import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

import { SQLProcess } from './types';

interface ProcessState {
  processes: string[];
  activeProcess: string | null;
  isLoading: boolean;
  error: string | null;
}

interface ProcessActions {
  fetchProcesses: (connectionString: string) => Promise<void>;
  addProcess: (connectionString: string, name: string) => Promise<void>;
  removeProcess: (connectionString: string, name: string, machineId?: string) => Promise<void>;
  setProcesses: (processes: string[]) => void;
  setActiveProcess: (name: string | null) => void;
}

export type ProcessStore = ProcessState & ProcessActions;

export const useProcessStore = create<ProcessStore>()(
  persist(
    (set, get) => ({
      processes: [],
      activeProcess: null,
      isLoading: false,
      error: null,

      setProcesses: (processes) => set({ processes }),
      setActiveProcess: (name) => set({ activeProcess: name }),

      fetchProcesses: async (connectionString) => {
        if (!connectionString) return;
        set({ isLoading: true, error: null });
        try {
          const data = await invoke<SQLProcess[]>('get_processes_preview', { connectionString });
          const distinctNames = Array.from(new Set(data.map(p => p.ProcessName))).sort();
          
          set((state) => ({ 
            processes: distinctNames, 
            isLoading: false,
            // If we have an active process that's no longer in the list, clear it
            activeProcess: state.activeProcess && !distinctNames.includes(state.activeProcess) 
              ? null 
              : state.activeProcess
          }));
        } catch (err: any) {
          console.error('Failed to fetch processes:', err);
          set({ error: err.toString(), isLoading: false });
        }
      },

      addProcess: async (connectionString, name) => {
        if (!connectionString || !name) return;
        try {
          await invoke('upsert_process', { 
            connectionString, 
            records: [{ ProcessName: name.trim() }] 
          });
          // Refresh local state
          const current = get().processes;
          if (!current.includes(name.trim())) {
            set({ processes: [...current, name.trim()].sort() });
          }
        } catch (err: any) {
          console.error('Failed to add process:', err);
          throw err;
        }
      },

      removeProcess: async (connectionString, name, machineId) => {
        if (!connectionString || !name) return;
        try {
          await invoke('delete_processes', { 
            connectionString, 
            records: [{ ProcessName: name, MachineID: machineId || "" }] 
          });
          // Refresh local state
          set({ processes: get().processes.filter(p => p !== name) });
        } catch (err: any) {
          console.error('Failed to delete process:', err);
          throw err;
        }
      },
    }),
    {
      name: 'process-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
