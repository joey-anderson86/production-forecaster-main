'use client';

import React, { useState } from 'react';
import { useLocalStorage, useDisclosure } from '@mantine/hooks';
import { useGlobalWeek } from '@/components/WeekContext';
import { useProcessStore } from '@/lib/processStore';

// Layout & UI Components
import { AppHeader } from '@/components/layout/AppHeader';
import { AppNavigation } from '@/components/layout/AppNavigation';
import { PlannerAuthModal } from '@/components/PlannerAuthModal';

// Tab Components
import DeliveryScorecardDisplay from '@/components/DeliveryScorecardDisplay';
import DeliveryScorecardManagement from '@/components/DeliveryScorecardManagement';
import { EquipmentManagement } from '@/components/EquipmentManagement';
import EquipmentScheduler from '@/components/EquipmentScheduler';
import { DatabaseSettings } from '@/components/DatabaseSettings';
import { ProductionForecaster } from '@/components/forecaster/ProductionForecaster';
import { PipelineDataPreview } from '@/components/PipelineDataPreview';
import { PlanDataPreview } from '@/components/PlanDataPreview';
import { Shield } from 'lucide-react';

export default function Home() {
  const [mainTab, setMainTab] = useState('scorecard-dash');
  const [roleMode, setRoleMode] = useLocalStorage<'supervisor' | 'planner'>({
    key: 'role-mode',
    defaultValue: 'supervisor',
  });

  const [authModalOpened, { open: openAuthModal, close: closeAuthModal }] = useDisclosure(false);
  const activeProcess = useProcessStore((state) => state.activeProcess);
  const { selectedWeekId } = useGlobalWeek();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 p-4 md:p-8">
      <div className="w-full mx-auto space-y-8">
        <AppHeader 
          roleMode={roleMode} 
          setRoleMode={setRoleMode} 
          openAuthModal={openAuthModal} 
        />

        <AppNavigation 
          mainTab={mainTab} 
          setMainTab={setMainTab} 
          roleMode={roleMode} 
        />

        {/* Tab Content Rendering */}
        <main className="transition-all duration-300">
          {mainTab === 'forecaster' && (
            <DashboardCard title="Production Forecaster">
              <ProductionForecaster />
            </DashboardCard>
          )}

          {mainTab === 'scorecard-mgmt' && roleMode === 'planner' && (
            <DashboardCard title="Production Planner">
              <DeliveryScorecardManagement />
            </DashboardCard>
          )}

          {mainTab === 'equipment-mgmt' && roleMode === 'planner' && (
            <DashboardCard title="Equipment Management">
              <EquipmentManagement />
            </DashboardCard>
          )}

          {mainTab === 'scorecard-dash' && (
            <DashboardCard title="Delivery Dashboard">
              <DeliveryScorecardDisplay />
            </DashboardCard>
          )}

          {mainTab === 'equipment-scheduler' && (
            <DashboardCard title="Equipment Scheduler">
              <div className="min-h-[600px]">
                <EquipmentScheduler 
                  initialProcessName={activeProcess || undefined} 
                  initialWeekId={selectedWeekId || undefined} 
                />
              </div>
            </DashboardCard>
          )}

          {mainTab === 'settings' && (
            <div className="max-w-7xl mx-auto w-full mt-4 space-y-8">
              <DashboardCard title="Database Settings">
                <DatabaseSettings roleMode={roleMode} />
              </DashboardCard>
              
              {roleMode === 'planner' && (
                <>
                  <DashboardCard title="Pipeline Data Preview">
                    <PipelineDataPreview />
                  </DashboardCard>
                  <DashboardCard title="Plan Data Preview">
                    <PlanDataPreview />
                  </DashboardCard>
                </>
              )}
              {roleMode === 'supervisor' && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 text-center">
                  <Shield size={32} className="text-slate-300 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold">Advanced Data Previews Restricted</h3>
                  <p className="text-sm text-slate-500 mt-1">Pipeline and Plan data previews require Planner Mode. Switch in the header to unlock.</p>
                  <button className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-md text-sm font-medium hover:bg-indigo-100 transition-colors" onClick={openAuthModal}>Unlock All Previews</button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <PlannerAuthModal
        opened={authModalOpened}
        onClose={closeAuthModal}
        onSuccess={() => {
          setRoleMode('planner');
          closeAuthModal();
        }}
      />
    </div>
  );
}

/**
 * Standardized card wrapper for all dashboard tabs to ensure UI consistency.
 */
function DashboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">{title}</h2>
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}
