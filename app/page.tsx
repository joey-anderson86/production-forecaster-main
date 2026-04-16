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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 p-8">
      <div className="max-w-[1600px] mx-auto space-y-8">
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
            <ProductionForecaster />
          )}

          {mainTab === 'scorecard-mgmt' && roleMode === 'planner' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
              <DeliveryScorecardManagement />
            </div>
          )}

          {mainTab === 'equipment-mgmt' && roleMode === 'planner' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
              <EquipmentManagement />
            </div>
          )}

          {mainTab === 'scorecard-dash' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
              <DeliveryScorecardDisplay />
            </div>
          )}

          {mainTab === 'equipment-scheduler' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 min-h-[600px]">
              <EquipmentScheduler 
                initialProcessName={activeProcess || undefined} 
                initialWeekId={selectedWeekId || undefined} 
              />
            </div>
          )}

          {mainTab === 'settings' && (
            <div className="max-w-7xl mx-auto w-full mt-4 space-y-8">
              <DatabaseSettings roleMode={roleMode} />
              {roleMode === 'planner' && (
                <>
                  <PipelineDataPreview />
                  <PlanDataPreview />
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
