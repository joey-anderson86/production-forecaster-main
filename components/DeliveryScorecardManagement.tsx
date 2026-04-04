'use client';

import React, { useEffect, useState, useRef } from 'react';
import { 
  Tabs, Select, Button, TextInput, NumberInput, Card, Grid, Group, Text, 
  ActionIcon, Divider, Box, Badge, Tooltip as MantineTooltip, Stack, Modal 
} from '@mantine/core';
import { 
  IconFlask, IconBox, IconShip, IconPlus, IconTrash, 
  IconDownload, IconUpload, IconX, IconDatabase, 
  IconRefresh, IconDeviceFloppy, IconClipboardCheck 
} from '@tabler/icons-react';
import { useScorecardStore, DayOfWeek, PartScorecard, BulkImportGroup } from '@/lib/scorecardStore';
import WeeklyPlanTable from './WeeklyPlanTable';
import { notifications } from '@mantine/notifications';
import Papa from 'papaparse';
import { getISODateForDay, getCurrentWeekId } from '@/lib/dateUtils';
import { useProcessStore } from '@/lib/processStore';

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
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // Initialize active tab if null
  useEffect(() => {
    if (!activeTab && processes.length > 0) {
      setActiveTab(processes[0]);
    }
  }, [processes, activeTab]);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [connectionString, setConnectionString] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add Week Modal State
  const [addWeekModalOpened, setAddWeekModalOpened] = useState(false);
  const [newWeekId, setNewWeekId] = useState('');
  const [newWeekLabel, setNewWeekLabel] = useState('');

  // Add Part Modal State
  const [addPartModalOpened, setAddPartModalOpened] = useState(false);
  const [newPartNumber, setNewPartNumber] = useState<string | null>(null);
  const [newPartShift, setNewPartShift] = useState<string | null>('A');
  const [availableParts, setAvailableParts] = useState<string[]>([]);
  const [isLoadingParts, setIsLoadingParts] = useState(false);

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
    const weekId = getCurrentWeekId();
    setNewWeekId(weekId);
    setNewWeekLabel(`Week ${weekId.split('-w')[1]} (Month Day Range)`);
    setAddWeekModalOpened(true);
  };

  const handleConfirmAddWeek = () => {
    if (!newWeekId?.trim()) {
       notifications.show({ title: 'Invalid ID', message: 'Week ID is required', color: 'red' });
       return;
    }
    if (!newWeekLabel?.trim()) {
       notifications.show({ title: 'Invalid Label', message: 'Week Label is required', color: 'red' });
       return;
    }
    
    store.addWeek(activeTab!, newWeekId.trim(), newWeekLabel.trim());
    setSelectedWeekId(newWeekId.trim());
    setAddWeekModalOpened(false);
    notifications.show({ title: 'Success', message: 'New week added to store', color: 'green' });
  };

  const handleDeleteWeek = async () => {
    if (!activeTab || !selectedWeekId) return;
    if (confirm("Are you sure you want to delete this entire week's data?")) {
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
    setNewPartNumber(null);
    setNewPartShift('A');
    setAddPartModalOpened(true);
  };

  const handleConfirmAddPart = () => {
    if (!newPartNumber?.trim()) {
        notifications.show({ title: 'Invalid Part Number', message: 'Please select a part number', color: 'red' });
        return;
    }
    if (!newPartShift?.trim()) {
       notifications.show({ title: 'Invalid Shift', message: 'Shift is required', color: 'red' });
       return;
    }
    
    if (!newPartNumber || !newPartShift) return;
    
    store.addPartNumber(activeTab!, selectedWeekId!, newPartNumber.trim(), newPartShift.trim());
    setAddPartModalOpened(false);
    notifications.show({ title: 'Success', message: 'Part number added to current week', color: 'green' });
  };

  const handleSyncToDb = async () => {
    if (!connectionString) {
      notifications.show({ title: 'Config Missing', message: 'Database connection string not found', color: 'yellow' });
      return;
    }
    try {
      await store.syncToDb(connectionString);
      notifications.show({ title: 'Synced', message: 'All scorecard data saved to MSSQL', color: 'green', icon: <IconDeviceFloppy size={18} /> });
    } catch (err: any) {
      notifications.show({ title: 'Sync Failed', message: err.toString(), color: 'red' });
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
    <Box className="w-full">
      <Tabs value={activeTab} onChange={setActiveTab} variant="outline" mb="md">
        <Tabs.List>
          {processes.map(name => (
            <Tabs.Tab 
              key={name} 
              value={name} 
              leftSection={getProcessIcon(name)}
              color="indigo"
            >
              <Text fw={600} size="sm">{name}</Text>
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Card withBorder shadow="sm" radius="md" mb="xl" bg="gray.0">
        <Group justify="space-between" align="flex-end">
          <Select
            label={<Text size="xs" fw={700} c="dimmed">SELECT WORK WEEK TO EDIT</Text>}
            placeholder="Select a week"
            data={weekOptions}
            value={selectedWeekId}
            onChange={setSelectedWeekId}
            className="flex-1 max-w-md"
            size="md"
          />
          <Group gap="sm">
            <Button 
              leftSection={<IconRefresh size={16} />} 
              variant="outline" 
              color="blue"
              size="md"
              loading={store.isLoading}
              onClick={handleFetchFromDb}
            >
              Sync from DB
            </Button>
            <Button 
              leftSection={<IconDeviceFloppy size={16} />} 
              variant="filled" 
              color="indigo"
              size="md"
              onClick={handleSyncToDb}
            >
              Save to DB
            </Button>
            <Button 
              leftSection={<IconPlus size={16} />} 
              variant="light" 
              color="indigo"
              size="md"
              onClick={handleAddWeek}
            >
              Add New Week
            </Button>
          </Group>
        </Group>
      </Card>

      {activeWeek && (
        <>
          <Card withBorder shadow="sm" radius="md" mb="md">
            <Group justify="space-between" align="end">
               <TextInput
                 label={<Text size="xs" fw={700} c="dimmed">WEEK LABEL</Text>}
                 value={activeWeek.weekLabel}
                 readOnly
                 className="flex-1 max-w-md"
                 size="md"
               />
               <Button 
                 leftSection={<IconTrash size={16} />} 
                 variant="light" 
                 color="red"
                 onClick={handleDeleteWeek}
               >
                 Delete Entire Week
               </Button>
            </Group>
          </Card>

          <Card withBorder shadow="sm" radius="md" mb="xl" py="sm">
             <Group>
                <Text size="sm" fw={700} c="dimmed">WEEKLY PLAN TEMPLATE:</Text>
                <Button 
                  leftSection={<IconDownload size={16} />} 
                  variant="default" 
                  size="xs"
                  onClick={handleExportTemplate}
                >
                  Download Template
                </Button>
                <Button 
                  leftSection={<IconDownload size={16} />} 
                  variant="light" 
                  color="teal"
                  size="xs"
                  onClick={handleExportCSV}
                >
                  Export CSV
                </Button>
                <Button 
                  leftSection={<IconDownload size={16} />} 
                  variant="outline" 
                  color="teal"
                  size="xs"
                  onClick={handleGlobalExportCSV}
                >
                  Global Export
                </Button>
             </Group>
          </Card>

          <Box className="mb-md">
            <WeeklyPlanTable 
              department={activeTab!}
              weekId={selectedWeekId!}
              parts={activeWeek.parts}
              availableParts={availableParts}
              isLoadingParts={isLoadingParts}
              onUpdateRecord={(partNum: string, shift: string, day: DayOfWeek, field: 'target', val: number | null) => 
                store.updateDailyRecord(activeTab!, selectedWeekId!, partNum, shift, day, field, val)
              }
              onRemovePart={(partNum: string, shift: string) => 
                store.removePartNumber(activeTab!, selectedWeekId!, partNum, shift)
              }
              onAddPart={(partNum: string, shift: string) => 
                store.addPartNumber(activeTab!, selectedWeekId!, partNum, shift)
              }
            />
          </Box>

          <Button 
            fullWidth 
            variant="light" 
            color="indigo" 
            size="md" 
            leftSection={<IconPlus size={16} />}
            onClick={handleAddPart}
          >
            Add Part Number Row
          </Button>
        </>
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
             value={newWeekLabel}
             onChange={(e) => setNewWeekLabel(e.currentTarget.value)}
             required
           />
           <Group justify="flex-end" mt="md">
             <Button variant="default" onClick={() => setAddWeekModalOpened(false)}>Cancel</Button>
             <Button color="indigo" onClick={handleConfirmAddWeek}>Add Week</Button>
           </Group>
        </Stack>
      </Modal>

      {/* Add Part Modal */}
      <Modal 
        opened={addPartModalOpened} 
        onClose={() => setAddPartModalOpened(false)} 
        title={<Text fw={700}>Add New Part Row</Text>}
        size="sm"
        radius="md"
      >
        <Stack gap="md">
           <Select
             label="Part Number"
             placeholder={isLoadingParts ? "Loading parts..." : "Select a part..."}
             data={availableParts}
             value={newPartNumber}
             onChange={setNewPartNumber}
             searchable
             required
             disabled={isLoadingParts}
             nothingFoundMessage="No parts found for this process"
           />
           <Select
             label="Shift"
             placeholder="Select shift"
             data={['A', 'B', 'C', 'D']}
             value={newPartShift}
             onChange={setNewPartShift}
             required
           />
           <Group justify="flex-end" mt="md">
             <Button variant="default" onClick={() => setAddPartModalOpened(false)}>Cancel</Button>
             <Button color="indigo" onClick={handleConfirmAddPart}>Add Part</Button>
           </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
