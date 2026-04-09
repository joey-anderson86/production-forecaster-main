import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';

/**
 * Custom hook to fetch available MachineIDs for a given process from the database.
 * @param activeProcess The currently active production process.
 * @returns { machines: string[], isLoading: boolean, isError: string | null }
 */
export function useAvailableMachines(activeProcess: string | null) {
  const [machines, setMachines] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMachines() {
      // If no process is selected, clear machines and stop
      if (!activeProcess) {
        setMachines([]);
        setIsLoading(false);
        setIsError(null);
        return;
      }

      setIsLoading(true);
      setIsError(null);

      try {
        const store = await load('store.json', { autoSave: false, defaults: {} });
        const connectionString = await store.get<string>('db_connection_string');
        
        if (!connectionString) {
          throw new Error('Database connection string not configured');
        }

        const data = await invoke<string[]>('get_machines_by_process', { 
          connectionString, 
          process: activeProcess 
        });
        
        setMachines(data);
      } catch (err: any) {
        process.env.NODE_ENV === 'development' && console.error('Failed to fetch machines:', err);
        setIsError(err.toString());
      } finally {
        setIsLoading(false);
      }
    }

    fetchMachines();
  }, [activeProcess]);

  return { machines, isLoading, isError };
}
