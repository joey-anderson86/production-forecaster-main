'use client';

import React from 'react';
import { Tabs } from '@mantine/core';

interface AppNavigationProps {
  mainTab: string;
  setMainTab: (tab: string) => void;
  roleMode: 'supervisor' | 'planner';
}

export function AppNavigation({ mainTab, setMainTab, roleMode }: AppNavigationProps) {
  return (
    <div className="flex justify-center mb-6">
      <Tabs value={mainTab} onChange={(val) => setMainTab(val as string)} variant="pills" color="indigo" radius="md">
        <Tabs.List>
          <Tabs.Tab value="scorecard-dash">Delivery Dashboard</Tabs.Tab>
          {roleMode === 'planner' && (
            <>
              <Tabs.Tab value="equipment-mgmt">Equipment Management</Tabs.Tab>
              <Tabs.Tab value="scorecard-mgmt">Production Planner</Tabs.Tab>
              <Tabs.Tab value="equipment-scheduler">Equipment Scheduler</Tabs.Tab>
            </>
          )}
          <Tabs.Tab value="forecaster">Production Forecaster</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
      </Tabs>
    </div>
  );
}
