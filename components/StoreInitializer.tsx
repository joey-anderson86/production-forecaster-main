'use client';

import { useEffect } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { useProcessStore } from '@/lib/processStore';
import { useScorecardStore } from '@/lib/scorecardStore'; // Import the scorecard store

export function StoreInitializer() {
  const fetchProcesses = useProcessStore((state) => state.fetchProcesses);
  const fetchScorecardData = useScorecardStore((state) => state.fetchFromDb); // Extract the fetch action

  useEffect(() => {
    async function init() {
      try {
        const store = await load('store.json', { autoSave: false, defaults: {} });
        const connStr = await store.get<string>('db_connection_string');
        
        if (connStr) {
          // Fetch processes and scorecard data concurrently on startup
          await Promise.all([
            fetchProcesses(connStr),
            fetchScorecardData(connStr)
          ]);
        }
      } catch (err) {
        console.error('Failed to initialize stores:', err);
      }
    }

    init();
  }, [fetchProcesses, fetchScorecardData]);

  return null;
}
