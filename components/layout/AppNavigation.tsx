'use client';

import React from 'react';
import { Tabs } from '@mantine/core';

/**
 * Properties for the AppNavigation component.
 */
interface AppNavigationProps {
  /** The currently active top-level tab. */
  mainTab: string;
  /** Callback function to update the active tab. */
  setMainTab: (tab: string) => void;
  /** The user's role, determining which tabs are visible (e.g., 'planner' has more options). */
  roleMode: 'supervisor' | 'planner';
}

/**
 * Main navigation component for the application, rendered as a set of pills.
 * 
 * Provides tab-based navigation with role-based access control. Planners can see 
 * management and scheduling tools, while supervisors are restricted to data viewing.
 * 
 * @param props - Component props including navigation state and role mode.
 */
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
              {/* <Tabs.Tab value="mrp-plan">MRP Shadow Plan</Tabs.Tab> */}
            </>
          )}
          {/*<Tabs.Tab value="forecaster">Production Manager</Tabs.Tab>*/}
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
      </Tabs>
    </div>
  );
}
