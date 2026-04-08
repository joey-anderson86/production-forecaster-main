'use client';

import React, { useEffect, useState, useRef } from 'react';
import { 
  Tabs, Select, Button, TextInput, NumberInput, Card, Grid, Group, Text, 
  ActionIcon, Divider, Box, Badge, Tooltip as MantineTooltip, Stack, Modal, Switch, Paper, Title
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { 
  IconFlask, IconBox, IconShip, IconPlus, IconTrash, 
  IconDownload, IconUpload, IconX, IconDatabase, 
  IconRefresh, IconDeviceFloppy, IconClipboardCheck,
  IconCloudCheck, IconCloudDownload, IconAlertTriangle
} from '@tabler/icons-react';
import { useScorecardStore, DayOfWeek, PartScorecard, BulkImportGroup } from '@/lib/scorecardStore';
import WeeklyPlanTable from './WeeklyPlanTable';
import { notifications } from '@mantine/notifications';
import Papa from 'papaparse';
import { getISODateForDay, getCurrentWeekId, generateWeekLabel } from '@/lib/dateUtils';
import { useProcessStore } from '@/lib/processStore';
import { ask } from '@tauri-apps/plugin-dialog';
import { generateSmartCopy } from '@/lib/copyUtils';

const PROCESS_ICONS: Record<string, React.ReactNode> = {
  'Plating': <IconFlask size={16} />,
  'VPA': <IconClipboardCheck size={16} />,
  'EBPVD': <IconBox size={16} />,
  'Shipping': <IconShip size={16} />
};

const getProcessIcon = (name: string) => PROCESS_ICONS[name] || <IconBox size={16} />;

const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function DeliveryScorecardManagement() {
  const processes = useProcessStore(state => state.processes);
  const store = useScorecardStore();
  const [activeTab, setActiveTab] = useLocalStorage<string | null>({
    key: 'production-planner-active-tab',
    defaultValue: null
  });

  // Initialize active tab if null
  useEffect(() => {
    if (!activeTab && processes.length > 0) {
      setActiveTab(processes[0]);
    }
  }, [processes, activeTab]);
  const [selectedWeekId, setSelectedWeekId] = useLocalStorage<string | null>({
    key: 'production-planner-selected-week',
    defaultValue: null
  });
  const [connectionString, setConnectionString] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add Week Modal State
  const [addWeekModalOpened, setAddWeekModalOpened] = useState(false);
  const [newWeekId, setNewWeekId] = useState('');
  const [copySourceWeekId, setCopySourceWeekId] = useState<string | null>('none');
  const [isSubmittingWeek, setIsSubmittingWeek] = useState(false);

  const derivedWeekLabel = React.useMemo(() => generateWeekLabel(newWeekId), [newWeekId]);

  const [availableParts, setAvailableParts] = useState<string[]>([]);
  const [isLoadingParts, setIsLoadingParts] = useState(false);
  const [processInfo, setProcessInfo] = useState<any[]>([]);
  const [partInfo, setPartInfo] = useState<any[]>([]);
  const [scheduleAllShifts, setScheduleAllShifts] = useLocalStorage<boolean>({
    key: 'production-planner-all-shifts-toggle',
    defaultValue: false
  });

  // Initialize connection string and fetch data
  useEffect(() => {
    async function init() {
      const { load } = await import('@tauri-apps/plugin-store');
      try {
        const storeRes = await load("store.json", { autoSave: false, defaults: {} });
        const val = await storeRes.get<string>("db_connection_string");
        setConnectionString(val || null);
        if (val) {
          store.fetchFromDb(val);
        }
      } catch (err) {
        console.error("Failed to load connection string:", err);
      }
    }
    init();
  }, []);

  // Fetch available parts for the active tab whenever it changes
  useEffect(() => {
    async function fetchParts() {
      if (!activeTab || !connectionString) return;
      setIsLoadingParts(true);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const parts = await invoke<string[]>("get_part_numbers_by_process", { 
          connectionString, 
          process: activeTab 
        });
        setAvailableParts(parts);
      } catch (err) {
        console.error("Failed to fetch parts:", err);
      } finally {
        setIsLoadingParts(false);
      }
    }
    fetchParts();
  }, [activeTab, connectionString]);

  // Fetch processInfo and partInfo globally
  useEffect(() => {
    async function fetchGlobalInfo() {
      if (!connectionString) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const processes = await invoke<any[]>("get_process_info_preview", { connectionString });
        const parts = await invoke<any[]>("get_part_info_preview", { connectionString });
        setProcessInfo(processes);
        setPartInfo(parts);
      } catch (err) {
        console.error("Failed to fetch global capacity info:", err);
      }
    }
    fetchGlobalInfo();
  }, [connectionString]);

  // Ensure all current processes are in the scorecard store
  useEffect(() => {
    processes.forEach(name => {
      store.addDepartment(name);
    });
  }, [processes, store]);

  const activeDepartment = activeTab ? store.departments[activeTab] : null;

  // Handle auto-selecting the first week if a new department is selected
  useEffect(() => {
    if (activeDepartment) {
      const weekIds = Object.keys(activeDepartment.weeks);
      if (weekIds.length > 0 && !weekIds.includes(selectedWeekId || '')) {
        setSelectedWeekId(weekIds[0]);
      } else if (weekIds.length === 0) {
        setSelectedWeekId(null);
      }
    } else {
      setSelectedWeekId(null);
    }
  }, [activeDepartment, selectedWeekId]);

  const handleAddWeek = () => {
    if (!activeTab) return;
    setNewWeekId(getCurrentWeekId());
    setAddWeekModalOpened(true);
  };

  const handleConfirmAddWeek = async () => {
    if (!newWeekId?.trim() || derivedWeekLabel.startsWith('Enter a valid')) {
       notifications.show({ title: 'Invalid ID', message: 'Week ID is required', color: 'red' });
       return;
    }
    if (!activeTab) return;
    
    if (copySourceWeekId && copySourceWeekId !== 'none') {
      setIsSubmittingWeek(true);
      try {
        const sourceWeek = store.departments[activeTab].weeks[copySourceWeekId];
        if (!sourceWeek) throw new Error("Source week not found");

        const { dbRecordsToUpsert } = generateSmartCopy(
          sourceWeek,
          newWeekId.trim(),
          store.shiftSettings,
          activeTab
        );

        // Add the week skeleton to store first (prevents missing week errors)
        store.addWeek(activeTab, newWeekId.trim(), derivedWeekLabel.trim());

        if (dbRecordsToUpsert.length > 0 && connectionString) {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('upsert_scorecard_data', { connectionString, records: dbRecordsToUpsert });
          await store.fetchFromDb(connectionString);
        }

        setSelectedWeekId(newWeekId.trim());
        setAddWeekModalOpened(false);
        notifications.show({ title: 'Success', message: 'Successfully generated schedule from previous week', color: 'green' });
      } catch (err: any) {
        notifications.show({ title: 'Error', message: 'Failed to copy schedule: ' + err.message, color: 'red' });
      } finally {
        setIsSubmittingWeek(false);
      }
    } else {
      store.addWeek(activeTab, newWeekId.trim(), derivedWeekLabel.trim());
      setSelectedWeekId(newWeekId.trim());
      setAddWeekModalOpened(false);
      notifications.show({ title: 'Success', message: 'New week added to store', color: 'green' });
    }
  };

  const handleDeleteWeek = async () => {
    if (!activeTab || !selectedWeekId) return;
    
    const confirmed = await ask("Are you sure you want to delete this entire week's data?", {
      title: 'Confirm Deletion',
      kind: 'warning'
    });

    if (confirmed) {
      const weekId = selectedWeekId;
      store.deleteWeek(activeTab, weekId);
      setSelectedWeekId(null);
      
      if (connectionString) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('delete_scorecard_week', { 
            connectionString, 
            department: activeTab, 
            weekIdentifier: weekId 
          });
          notifications.show({ title: 'Success', message: 'Week deleted from database', color: 'green' });
        } catch (err: any) {
          notifications.show({ title: 'Database Error', message: err.toString(), color: 'red' });
        }
      }
    }
  };

  const handleAddPart = () => {
    if (!activeTab || !selectedWeekId) return;
    
    if (scheduleAllShifts) {
      const groupId = crypto.randomUUID();
      // Inject all 4 shifts at once
      ['A', 'B', 'C', 'D'].forEach(shift => {
        store.addPartNumber(activeTab, selectedWeekId, '', shift, groupId);
      });
      notifications.show({ 
        title: 'Success', 
        message: 'Multiple shifts added for new part', 
        color: 'green' 
      });
    } else {
      // Still generate a groupId so it can be assigned via parent row selection
      const groupId = crypto.randomUUID();
      store.addPartNumber(activeTab, selectedWeekId, '', '', groupId);
      notifications.show({ title: 'Success', message: 'New row added to table', color: 'green' });
    }
  };


  const autoSaveTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Cleanup effect for pending saves
  useEffect(() => {
    const currentTimeouts = autoSaveTimeoutsRef.current;
    return () => {
      Object.values(currentTimeouts).forEach(clearTimeout);
    };
  }, []);

  const coreHandleUpdateRecord = (rowId: string, day: DayOfWeek, field: 'target' | 'actual', val: number | null) => {
    if (!activeTab || !selectedWeekId) return;
    
    // 1. Optimistic Update in Store (UI Updates immediately)
    store.updateDailyRecord(activeTab, selectedWeekId, rowId, day, field, val);

    // 2. IDENTITY GATE: Do not attempt to save to DB if Part Number or Shift is missing.
    // The database requires these to establish a unique identity for the record.
    const part = activeWeek?.parts.find(p => p.id === rowId);
    if (!part?.partNumber || !part?.shift) {
      console.log("Postponing DB save: Identity incomplete (no Part Number or Shift)");
      return;
    }

    // 3. Debounced Save to DB (Per-cell basis to prevent race conditions during rapid entry)
    const cellKey = `${rowId}-${day}`;
    autoSaveTimeoutsRef.current[cellKey] = setTimeout(async () => {
      if (!connectionString) return;
      try {
        await store.saveRecordToDb(connectionString, activeTab, selectedWeekId, rowId, day);
        delete autoSaveTimeoutsRef.current[cellKey];
      } catch (err: any) {
        notifications.show({
          title: 'Auto-save Failed',
          message: `Could not save change for ${day}: ${err.toString()}`,
          color: 'red',
          autoClose: 5000
        });
      }
    }, 750);
  };

  const handleBatchUpdateRecords = (updates: { rowId: string, day: DayOfWeek, field: 'target' | 'actual', value: number | null }[]) => {
    if (!activeTab || !selectedWeekId) return;

    const recordsToSave: any[] = [];
    
    // 1. Optimistic Update
    updates.forEach(({ rowId, day, field, value }) => {
      store.updateDailyRecord(activeTab, selectedWeekId, rowId, day, field, value);

      // 2. Prepare DB Record (Identity Gate)
      const part = activeWeek?.parts.find(p => p.id === rowId);
      if (part?.partNumber && part?.shift) {
        const record = part.dailyRecords.find(r => r.dayOfWeek === day);
        recordsToSave.push({
            department: activeTab,
            weekIdentifier: selectedWeekId,
            partNumber: part.partNumber,
            dayOfWeek: day,
            target: field === 'target' ? value : record?.target,
            actual: field === 'actual' ? value : record?.actual,
            date: record?.date,
            shift: part.shift,
            reasonCode: record?.reasonCode
        });
      }
    });

    // 3. Batch DB Save
    if (recordsToSave.length > 0 && connectionString) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
         invoke('upsert_scorecard_data', { connectionString, records: recordsToSave })
           .catch(e => notifications.show({ title: 'Batch Save Failed', message: e.toString(), color: 'red' }));
      });
    }
  };

  const SyncStatusIndicator = () => {
    switch (store.syncStatus) {
      case 'saving':
        return (
          <Group gap="xs">
            <IconCloudDownload size={16} className="animate-pulse" color="var(--mantine-color-blue-5)" />
            <Text size="xs" fw={600} c="blue.6">Saving...</Text>
          </Group>
        );
      case 'error':
        return (
          <MantineTooltip label={store.error || "Unknown error during sync"}>
            <Group gap="xs" style={{ cursor: 'help' }}>
              <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" />
              <Text size="xs" fw={700} c="red.6">Unsaved Changes</Text>
            </Group>
          </MantineTooltip>
        );
      case 'saved':
      default:
        return (
          <Group gap="xs">
            <IconCloudCheck size={16} color="var(--mantine-color-teal-6)" />
            <Text size="xs" fw={600} c="teal.7">Saved</Text>
          </Group>
        );
    }
  };

  const handleFetchFromDb = async () => {
    if (!connectionString) return;
    await store.fetchFromDb(connectionString);
    notifications.show({ title: 'Refreshed', message: 'Data loaded from MSSQL', color: 'blue', icon: <IconRefresh size={18} /> });
  };

  const handleExportTemplate = () => {
    const csvData = [
      ["Department", "WeekIdentifier", "PartNumber", "Shift", "DayOfWeek", "Target", "Actual", "Date"]
    ];
    csvData.push(["Plating", "2026-w41", "EX-001", "1", "Mon", "100", "0", "2026-10-05"]);
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Delivery_Data_Template.csv`;
    link.click();
  };

  const handleExportCSV = () => {
    if (!activeDepartment || !selectedWeekId) return;
    const weekData = activeDepartment.weeks[selectedWeekId];
    if (!weekData) return;

    const csvData = [
      ["Department", "WeekIdentifier", "PartNumber", "Shift", "DayOfWeek", "Target", "Actual", "Date"]
    ];

    weekData.parts.forEach(part => {
      part.dailyRecords.forEach(record => {
        csvData.push([
          activeDepartment.departmentName,
          weekData.weekId,
          part.partNumber,
          part.shift,
          record.dayOfWeek,
          record.target !== null ? record.target.toString() : "",
          record.actual !== null ? record.actual.toString() : "",
          record.date || ""
        ]);
      });
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${activeTab}_${weekData.weekId}_Export.csv`;
    link.click();
  };

  const handleGlobalExportCSV = () => {
    const csvData = [
      ["Department", "WeekIdentifier", "PartNumber", "Shift", "DayOfWeek", "Target", "Actual", "Date"]
    ];

    Object.values(store.departments).forEach(dept => {
      Object.values(dept.weeks).forEach(week => {
        week.parts.forEach(part => {
          part.dailyRecords.forEach(record => {
            csvData.push([
              dept.departmentName,
              week.weekId,
              part.partNumber,
              part.shift,
              record.dayOfWeek,
              record.target !== null ? record.target.toString() : "",
              record.actual !== null ? record.actual.toString() : "",
              record.date || ""
            ]);
          });
        });
      });
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Delivery_Global_Export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const weekOptions = activeDepartment 
    ? Object.values(activeDepartment.weeks).map(w => ({ value: w.weekId, label: w.weekLabel })) 
    : [];

  const activeWeek = activeDepartment && selectedWeekId ? activeDepartment.weeks[selectedWeekId] : null;

  return (
    <Stack gap="md" className="w-full">
      <Group justify="space-between" align="center">
        <Title order={2}>Production Planner</Title>
        <Group>
          <SyncStatusIndicator />
        </Group>
      </Group>

      <Paper withBorder p="md" radius="md">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Tabs value={activeTab} onChange={setActiveTab} variant="pills">
              <Tabs.List>
                {processes.map(name => (
                  <Tabs.Tab 
                    key={name} 
                    value={name} 
                    leftSection={getProcessIcon(name)}
                    color="indigo"
                  >
                    {name}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>

            <Group gap="sm">
              <Select
                placeholder="Select Week"
                data={weekOptions}
                value={selectedWeekId}
                onChange={setSelectedWeekId}
                size="sm"
                w={220}
              />
              <Button 
                leftSection={<IconRefresh size={16} />} 
                variant="outline" 
                color="blue"
                size="sm"
                loading={store.isLoading}
                onClick={handleFetchFromDb}
              >
                Sync
              </Button>
              <Button 
                leftSection={<IconPlus size={16} />} 
                variant="light" 
                color="indigo"
                size="sm"
                onClick={handleAddWeek}
              >
                Add Week
              </Button>
            </Group>
          </Group>


          {activeWeek && (
            <Box>
              <Group justify="space-between" mb="md" className="bg-gray-50/50 p-2 rounded-md border border-gray-100">
                <Group gap="lg">
                  <TextInput
                    label={<Text size="xs" fw={700} c="dimmed">WEEK LABEL</Text>}
                    value={activeWeek.weekLabel}
                    readOnly
                    size="sm"
                    w={280}
                    styles={{ label: { marginBottom: 2 } }}
                  />
                  <Divider orientation="vertical" />
                  <Group gap={8}>
                    <Text size="xs" fw={700} c="dimmed" mr={4}>EXPORT AS:</Text>
                    <Button 
                      leftSection={<IconDownload size={14} />} 
                      variant="subtle" 
                      size="xs"
                      onClick={handleExportTemplate}
                    >
                      Template
                    </Button>
                    <Button 
                      leftSection={<IconDownload size={14} />} 
                      variant="subtle" 
                      color="teal"
                      size="xs"
                      onClick={handleExportCSV}
                    >
                      CSV
                    </Button>
                    <Button 
                      leftSection={<IconDownload size={14} />} 
                      variant="subtle" 
                      color="indigo"
                      size="xs"
                      onClick={handleGlobalExportCSV}
                    >
                      Global
                    </Button>
                  </Group>
                </Group>
                
                <Button 
                  leftSection={<IconTrash size={14} />} 
                  variant="subtle" 
                  color="red"
                  size="xs"
                  onClick={handleDeleteWeek}
                >
                  Delete Entire Week
                </Button>
              </Group>

              <Box className="border border-gray-200 rounded-md overflow-hidden mb-md">

            <WeeklyPlanTable 
              department={activeTab!}
              weekId={selectedWeekId!}
              parts={activeWeek.parts}
              availableParts={availableParts}
              isLoadingParts={isLoadingParts}
              processInfo={processInfo}
              partInfo={partInfo}
              onUpdateRecord={coreHandleUpdateRecord}
              onBatchUpdateRecords={handleBatchUpdateRecords}
              onRemovePart={async (rowId: string) => {
                const confirmed = await ask("Are you sure you want to remove this row? This will also delete it from the database.", {
                  title: 'Confirm Deletion',
                  kind: 'warning'
                });

                if (confirmed) {
                  const partRow = activeWeek?.parts.find(p => p.id === rowId);
                  // Relaxing the guard to allow deleting rows even if partNumber is missing (anonymous records)
                  if (partRow && connectionString) {
                    store.deletePartFromDb(connectionString, activeTab!, selectedWeekId!, partRow.partNumber || "", partRow.shift || "")
                      .catch(err => console.error("Sync delete failed:", err));
                  }
                  store.removePartNumber(activeTab!, selectedWeekId!, rowId);
                }
              }}
              onUpdatePartIdentity={(rowId: string, updates) => {
                store.updatePartIdentity(activeTab!, selectedWeekId!, rowId, updates);
                // Trigger a full row sync once identity is established/updated
                if (connectionString) {
                  store.saveRowToDb(connectionString, activeTab!, selectedWeekId!, rowId)
                    .catch(e => console.error("Identity sync failed:", e));
                }
              }}
              onUpdatePartGroupIdentity={(groupId: string, partNum: string) => {
                store.updatePartGroupIdentity(activeTab!, selectedWeekId!, groupId, partNum);
                // Trigger sync for all group members if connection is available
                if (connectionString) {
                   const rowsToSync = activeWeek?.parts.filter(p => p.groupId === groupId);
                   rowsToSync?.forEach(row => {
                      store.saveRowToDb(connectionString, activeTab!, selectedWeekId!, row.id)
                        .catch(e => console.error("Group identity sync failed:", e));
                   });
                }
              }}
              onAddPart={(partNum: string, shift: string) => 
                store.addPartNumber(activeTab!, selectedWeekId!, partNum, shift)
              }
            />
          </Box>

          <Group mb="sm" justify="flex-end">
            <Stack gap={0} align="flex-end">
              <Group gap="xs">
                <Text size="sm" fw={600}>Schedule All Shifts</Text>
                <Switch 
                  checked={scheduleAllShifts} 
                  onChange={(event) => setScheduleAllShifts(event.currentTarget.checked)}
                  color="indigo"
                  size="md"
                />
              </Group>
              <Text size="xs" c="dimmed">Automatically add Shifts A, B, C, and D</Text>
            </Stack>
          </Group>

          <Button 
            fullWidth 
            variant="light" 
            color="indigo" 
            size="xl" 
            leftSection={<IconPlus size={20} />}
            onClick={handleAddPart}
            style={{ borderStyle: 'dashed', borderWidth: '2px' }}
          >
            Add Part Number Row
          </Button>
            </Box>
          )}

          {!activeWeek && weekOptions.length === 0 && (
             <Text c="dimmed" ta="center" mt="xl">No work weeks defined for this department. Click "Add New Week" to start.</Text>
          )}

      {/* Add Week Modal */}
      <Modal 
        opened={addWeekModalOpened} 
        onClose={() => setAddWeekModalOpened(false)} 
        title={<Text fw={700}>Add New Work Week</Text>}
        size="sm"
        radius="md"
      >
        <Stack gap="md">
           <TextInput
             label="Week Identifier"
             description="ISO-8601 format recommended"
             placeholder="e.g. 2026-w41"
             value={newWeekId}
             onChange={(e) => setNewWeekId(e.currentTarget.value)}
             required
           />
           <TextInput
             label="Display Label"
             description="Used for selection dropdowns"
             placeholder="e.g. Week 41 (Oct 05 - Oct 11)"
             value={derivedWeekLabel}
             readOnly
             variant="filled"
             tabIndex={-1}
           />
           <Select
             label="Copy schedule from... (Optional)"
             placeholder="Start Blank"
             clearable
             data={[{ value: 'none', label: 'Start Blank' }, ...weekOptions]}
             value={copySourceWeekId}
             onChange={(val) => setCopySourceWeekId(val || 'none')}
             disabled={isSubmittingWeek}
           />
           <Group justify="flex-end" mt="md">
             <Button variant="default" onClick={() => setAddWeekModalOpened(false)} disabled={isSubmittingWeek}>Cancel</Button>
             <Button color="indigo" onClick={handleConfirmAddWeek} loading={isSubmittingWeek}>Generate Plan</Button>
           </Group>
        </Stack>
      </Modal>
        </Stack>
      </Paper>
    </Stack>

  );
}
