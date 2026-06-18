import { useEffect, useRef } from 'react';

/**
 * Custom hook to automatically trigger a refetch function at a specified interval.
 * 
 * @param fetchData The function to call periodically
 * @param intervalMs The interval in milliseconds, or null to disable (defaults to 5 minutes)
 */
export function useAutoRefresh(fetchData: () => void, intervalMs: number | null = 300000) {
  const savedCallback = useRef(fetchData);

  useEffect(() => {
    savedCallback.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    if (intervalMs === null) return;
    
    const interval = setInterval(() => {
      savedCallback.current();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [intervalMs]);
}
