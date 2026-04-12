import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface Process {
  processName: string;
  machineId?: string;
}

interface ProcessState {
  processes: string[];
  isLoading: boolean;
  error: string | null;
}

interface ProcessActions {
  fetchProcesses: (connectionString: string) => Promise<void>;
  addProcess: (connectionString: string, name: string) => Promise<void>;
  removeProcess: (connectionString: string, name: string, machineId?: string) => Promise<void>;
  setProcesses: (processes: string[]) => void;
}

export type ProcessStore = ProcessState & ProcessActions;

export const useProcessStore = create<ProcessStore>((set, get) => ({
  processes: [],
  isLoading: false,
  error: null,

  setProcesses: (processes) => set({ processes }),

  fetchProcesses: async (connectionString) => {
    if (!connectionString) return;
    set({ isLoading: true, error: null });
    try {
      const data = await invoke<Process[]>('get_processes_preview', { connectionString });
      const distinctNames = Array.from(new Set(data.map(p => p.processName))).sort();
      set({ processes: distinctNames, isLoading: false });
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
        records: [{ processName: name.trim() }] 
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
        records: [{ processName: name, machineId: machineId || "" }] 
      });
      // Refresh local state
      set({ processes: get().processes.filter(p => p !== name) });
    } catch (err: any) {
      console.error('Failed to delete process:', err);
      throw err;
    }
  },
}));
