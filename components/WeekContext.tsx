'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useLocalStorage } from '@mantine/hooks';
import { getCurrentWeekId } from '@/lib/dateUtils';

interface WeekContextType {
  selectedWeekId: string | null;
  setSelectedWeekId: (val: string | null) => void;
}

const WeekContext = createContext<WeekContextType | undefined>(undefined);

export function WeekProvider({ children }: { children: ReactNode }) {
  const [selectedWeekId, setSelectedWeekId] = useLocalStorage<string | null>({
    key: 'production-planner-selected-week',
    defaultValue: getCurrentWeekId(),
  });

  return (
    <WeekContext.Provider value={{ selectedWeekId, setSelectedWeekId }}>
      {children}
    </WeekContext.Provider>
  );
}

export function useGlobalWeek() {
  const context = useContext(WeekContext);
  if (context === undefined) {
    throw new Error('useGlobalWeek must be used within a WeekProvider');
  }
  return context;
}
