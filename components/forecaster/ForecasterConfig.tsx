'use client';

import React, { useState } from 'react';
import { Stack, Accordion, Group, Text, Button, Alert, FileButton, Card } from '@mantine/core';
import { Database, Upload, FileJson, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { notifications } from '@mantine/notifications';
import Papa from 'papaparse';
import { PipelineData, DailyRateData } from './ForecasterTypes';

interface ForecasterConfigProps {
  onDataLoaded: (pipeline: PipelineData, dailyRates: DailyRateData, locatorMapping: Record<string, number>) => void;
  isConfigOpen: boolean;
  setIsConfigOpen: (open: boolean) => void;
  forecastGenerated: boolean;
}

export function ForecasterConfig({ onDataLoaded, isConfigOpen, setIsConfigOpen, forecastGenerated }: ForecasterConfigProps) {
  const [isFetchingFromDb, setIsFetchingFromDb] = useState(false);

  const fetchFromDatabase = async () => {
    setIsFetchingFromDb(true);
    try {
      const { load } = await import('@tauri-apps/plugin-store');
      const store = await load('store.json', { autoSave: false, defaults: {} });
      const connectionString = await store.get<string>('db_connection_string');

      if (!connectionString) {
        throw new Error("No database connection string found in settings.");
      }

      const results = await invoke<{
        pipeline: PipelineData;
        daily_rates: DailyRateData;
        locators: { WIPLocator: string; DaysFromShipment: number }[];
      }>('get_forecaster_data', { connectionString });

      const mapping: Record<string, number> = {};
      results.locators.forEach(l => {
        mapping[l.WIPLocator] = l.DaysFromShipment;
      });

      onDataLoaded(results.pipeline, results.daily_rates, mapping);
      
      notifications.show({
        title: "Success",
        message: `Loaded ${results.pipeline.length} pipeline records and ${results.daily_rates.length} rates from DB.`,
        color: "green",
        icon: <CheckCircle2 size={18} />
      });
      setIsConfigOpen(false);
    } catch (err) {
      console.error(err);
      notifications.show({
        title: "Database Error",
        message: typeof err === "string" ? err : "Failed to fetch data from MSSQL.",
        color: "red",
        icon: <AlertCircle size={18} />
      });
    } finally {
      setIsFetchingFromDb(false);
    }
  };

  const handleImportMapping = (file: File | null) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const mapping: Record<string, number> = {};
        const data = results.data as any[];
        data.forEach(row => {
          const loc = row.WIPLocator || row.wipLocator || row.Locator;
          const days = parseInt(row.DaysFromShipment || row.daysFromShipment || row.Days || "0");
          if (loc) mapping[loc] = days;
        });
        
        onDataLoaded([], [], mapping);
        notifications.show({
          title: "Mapping Imported",
          message: `Loaded ${Object.keys(mapping).length} locator definitions.`,
          color: "indigo"
        });
      }
    });
  };

  return (
    <Card withBorder radius="xl" className="mb-8 overflow-hidden shadow-sm" p={0}>
      <Accordion 
        variant="filled" 
        value={isConfigOpen ? "config" : null} 
        onChange={(val) => setIsConfigOpen(val === "config")}
        styles={{
          item: { border: 'none' },
          control: { padding: '20px 24px' }
        }}
      >
        <Accordion.Item value="config">
          <Accordion.Control icon={<Upload size={20} className="text-indigo-600" />}>
            <Group justify="space-between" className="w-full pr-4">
              <Stack gap={2}>
                <Text fw={700} size="lg">Forecast Configuration & Data Source</Text>
                <Text size="sm" c="dimmed">
                  {forecastGenerated 
                    ? "Currently using active data set. You can refresh from database to pull latest records." 
                    : "No forecast generated. Please provide data sources below."}
                </Text>
              </Stack>
              {forecastGenerated && <div className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-100 uppercase tracking-wider">Active</div>}
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <div className="pt-2 pb-6 px-4 space-y-6">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
                <Text fw={700} size="sm" mb="md" className="flex items-center gap-2">
                  <RefreshCw size={16} className="text-indigo-600" />
                  Automated Database Synchronization
                </Text>
                <Group align="flex-start" gap="md">
                  <Button 
                    size="md"
                    color="indigo" 
                    leftSection={<Database size={18} />}
                    onClick={fetchFromDatabase}
                    loading={isFetchingFromDb}
                    className="flex-1 max-w-xs shadow-sm hover:shadow-md transition-shadow"
                    radius="lg"
                  >
                    Generate from Database
                  </Button>
                  <Alert variant="light" color="indigo" radius="lg" className="flex-1" icon={<AlertCircle size={18} />}>
                    <Text size="xs" fw={500}>
                      Pulls WIP Locators, Part Information, Daily Rates, and Pipeline data from MSSQL. Matches are performanced automatically based on the PartNumber and WIPLocator mapping table.
                    </Text>
                  </Alert>
                </Group>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <Card withBorder radius="lg" p="md">
                    <Stack gap="xs">
                      <Group gap="xs">
                        <FileJson size={18} className="text-slate-400" />
                        <Text fw={700} size="sm">Locator Mapping Override</Text>
                      </Group>
                      <Text size="xs" c="dimmed">Upload a CSV with 'WIPLocator' and 'DaysFromShipment' to override database logic.</Text>
                      <FileButton onChange={handleImportMapping} accept=".csv">
                        {(props) => <Button {...props} variant="light" color="slate" size="xs" className="mt-2">Import CSV Mapping</Button>}
                      </FileButton>
                    </Stack>
                 </Card>
              </div>
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}
