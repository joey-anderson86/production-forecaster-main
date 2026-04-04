'use client';

import { useEffect } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { useProcessStore } from '@/lib/processStore';

export function StoreInitializer() {
  const fetchProcesses = useProcessStore((state) => state.fetchProcesses);

  useEffect(() => {
    async function init() {
      try {
        const store = await load('store.json', { autoSave: false, defaults: {} });
        const connStr = await store.get<string>('db_connection_string');
        if (connStr) {
          await fetchProcesses(connStr);
        }
      } catch (err) {
        console.error('Failed to initialize process store:', err);
      }
    }

    init();
  }, [fetchProcesses]);

  return null;
}
