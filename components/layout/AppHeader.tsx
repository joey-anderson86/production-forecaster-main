'use client';

import React from 'react';
import { Group, Title, Text, SegmentedControl, Center, Select } from '@mantine/core';
import { User, Shield, LayoutList, BarChart3 } from 'lucide-react';
import { ColorSchemeToggle } from '@/components/ColorSchemeToggle';
import { useGlobalWeek } from '@/components/WeekContext';
import { getCurrentWeekId, generateWeekLabel } from '@/lib/dateUtils';

interface AppHeaderProps {
  roleMode: 'supervisor' | 'planner';
  setRoleMode: (role: 'supervisor' | 'planner') => void;
  openAuthModal: () => void;
}

export function AppHeader({ roleMode, setRoleMode, openAuthModal }: AppHeaderProps) {
  const { selectedWeekId, setSelectedWeekId } = useGlobalWeek();

  return (
    <header className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">Production Manager</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Production Management and Planning Tool</p>
      </div>
      <Group align="center" gap="xl">
        <SegmentedControl
          value={roleMode}
          onChange={(value) => {
            if (value === 'planner') {
              openAuthModal();
            } else {
              setRoleMode('supervisor');
            }
          }}
          data={[
            {
              value: 'supervisor',
              label: (
                <Center style={{ gap: 10 }}>
                  <User size={16} />
                  <span>Supervisor</span>
                </Center>
              ),
            },
            {
              value: 'planner',
              label: (
                <Center style={{ gap: 10 }}>
                  <Shield size={16} />
                  <span>Planner</span>
                </Center>
              ),
            },
          ]}
          color="indigo"
          radius="md"
        />
        <ColorSchemeToggle />
        <Select
          className="w-48"
          placeholder="Select week"
          value={selectedWeekId}
          onChange={setSelectedWeekId}
          data={[
            { value: getCurrentWeekId(), label: `Current Week (${generateWeekLabel(getCurrentWeekId())})` },
            ...(selectedWeekId && selectedWeekId !== getCurrentWeekId() 
              ? [{ value: selectedWeekId, label: generateWeekLabel(selectedWeekId) }] 
              : [])
          ]}
          leftSection={<LayoutList size={16} />}
          styles={{ input: { fontWeight: 600 } }}
        />
        <BarChart3 className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
      </Group>
    </header>
  );
}
