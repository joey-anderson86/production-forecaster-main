import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';

export function useReasonCodes(selectedProcess: string | null) {
  const [data, setData] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchReasonCodes() {
      if (!selectedProcess) {
        if (isMounted) {
          setData([]);
          setIsLoading(false);
          setIsError(false);
        }
        return;
      }

      if (isMounted) {
        setIsLoading(true);
        setIsError(false);
      }

      try {
        const store = await load('store.json', { autoSave: false, defaults: {} });
        const connectionString = await store.get<string>('db_connection_string');

        if (!connectionString) {
          throw new Error("No connection string found");
        }

        const codes = await invoke<string[]>('get_reason_codes_by_process', {
          connectionString,
          process: selectedProcess,
        });

        if (isMounted) {
          setData(codes);
        }
      } catch (err) {
        console.error('Failed to fetch reason codes:', err);
        if (isMounted) {
          setIsError(true);
          setData([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchReasonCodes();

    return () => {
      isMounted = false;
    };
  }, [selectedProcess]);

  return { data, isLoading, isError };
}
