'use client';

import { useEffect, useRef } from 'react';
import { useScorecardStore } from '@/lib/scorecardStore';
import { syncStoreToFile } from '@/lib/syncService';
import { notifications } from '@mantine/notifications';

/**
 * SyncManager is a headless component that listens for store changes 
 * and automatically synchronizes the data to a file if a sync path is set.
 */
export default function SyncManager() {
  const departments = useScorecardStore((state) => state.departments);
  const syncFilePath = useScorecardStore((state) => state.syncFilePath);
  const lastSyncStatus = useScorecardStore((state) => state.lastSyncStatus);
  const setSyncStatus = useScorecardStore((state) => state.setSyncStatus);
  
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // If no sync path is set, do nothing
    if (!syncFilePath) {
      if (lastSyncStatus !== null) setSyncStatus(null);
      return;
    }

    // Debounce the sync to avoid excessive writes
    if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      try {
        setSyncStatus('syncing');
        await syncStoreToFile(syncFilePath, departments);
        setSyncStatus('synced');
        // Optional: show a small notification or just rely on the badge
      } catch (error: any) {
        console.error('Auto-sync failed:', error);
        setSyncStatus('error');
        notifications.show({
          title: 'Auto-sync Failed',
          message: `Could not save to file: ${error?.message || 'Unknown error'}`,
          color: 'red'
        });
      }
    }, 2000); // 2 second debounce

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [departments, syncFilePath, setSyncStatus]);

  return null; // Headless component
}
