'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Tabs, Select, Button, TextInput, NumberInput, Card, Grid, Group, Text, ActionIcon, Divider, Box } from '@mantine/core';
import { 
  IconFlask, IconBox, IconShip, IconPlus, IconTrash, 
  IconDownload, IconUpload, IconX, IconCloudCheck, 
  IconCloudUpload, IconCircleX, IconLink, IconLinkOff,
  IconClipboardCheck 
} from '@tabler/icons-react';
import { useScorecardStore, DayOfWeek, PartScorecard, BulkImportGroup } from '@/lib/scorecardStore';
import { notifications } from '@mantine/notifications';
import { Badge, Tooltip as MantineTooltip, Stack } from '@mantine/core';
import Papa from 'papaparse';
import { getWeekDates, formatISODate, getISODateForDay, getNumericDateForDay } from '@/lib/dateUtils';

const DEFAULT_DEPARTMENTS = [
  { name: 'Plating', icon: <IconFlask size={16} /> },
  { name: 'VPA', icon: <IconClipboardCheck size={16} /> },
  { name: 'EBPVD', icon: <IconBox size={16} /> },
  { name: 'Shipping', icon: <IconShip size={16} /> }
];

const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function DeliveryScorecardManagement() {
  const store = useScorecardStore();
  const [activeTab, setActiveTab] = useState<string | null>('Plating');
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize standard departments if they don't exist
  useEffect(() => {
    DEFAULT_DEPARTMENTS.forEach(dept => {
      // The store has an addDepartment action which checks for existence
      store.addDepartment(dept.name);
    });
  }, []);

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
    const exampleId = `${new Date().getFullYear()}-w${Math.ceil((new Date().getDate() - new Date(new Date().getFullYear(), 0, 1).getDate()) / 7)}`;
    const weekId = prompt(`Enter Week ID (e.g., '${exampleId}'):`, exampleId);
    if (!weekId) return;

    const weekLabel = prompt("Enter Week Label (e.g., 'Week 12 (Mar 16 - Mar 22)'):");
    if (weekLabel) {
      store.addWeek(activeTab, weekId, weekLabel);
      setSelectedWeekId(weekId);
    }
  };

  const handleDeleteWeek = () => {
    if (!activeTab || !selectedWeekId) return;
    if (confirm("Are you sure you want to delete this entire week's data?")) {
      store.deleteWeek(activeTab, selectedWeekId);
      setSelectedWeekId(null);
    }
  };

  const handleAddPart = () => {
    if (!activeTab || !selectedWeekId) return;
    const partNumber = prompt("Enter Part Number (e.g., 'PLT-001'):");
    if (partNumber?.trim()) {
      store.addPartNumber(activeTab, selectedWeekId, partNumber.trim());
    }
  };

  // CSV Export/Import
  const handleExportTemplate = () => {
    const csvData = [
      ["Department", "WeekIdentifier", "PartNumber", "DayOfWeek", "Target", "Actual", "ReasonCode", "Date", "NumericDate"]
    ];
    // Add one dummy row as example
    csvData.push(["Plating", "Week 41 (Oct 5 - Oct 11)", "EX-001", "Mon", "100", "0", "", "2026-10-05", "20261005"]);
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Scorecard_Global_Template.csv`;
    link.click();
  };

  const handleExportCSV = () => {
    if (!activeDepartment || !selectedWeekId) return;
    const weekData = activeDepartment.weeks[selectedWeekId];
    if (!weekData) return;

    const csvData = [
      ["Department", "WeekIdentifier", "PartNumber", "DayOfWeek", "Target", "Actual", "ReasonCode", "Date", "NumericDate"]
    ];

    weekData.parts.forEach(part => {
      part.dailyRecords.forEach(record => {
        csvData.push([
          activeDepartment.departmentName,
          weekData.weekLabel,
          part.partNumber,
          record.dayOfWeek,
          record.target !== null ? record.target.toString() : "",
          record.actual !== null ? record.actual.toString() : "",
          record.reasonCode || "",
          record.date || "",
          record.numericDate?.toString() || ""
        ]);
      });
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${activeTab}_${weekData.weekLabel.replace(/\W+/g, '_')}_Export.csv`;
    link.click();
  };

  const handleGlobalUploadCSV = async (e?: React.ChangeEvent<HTMLInputElement>) => {
    // If we have an event, it means the hidden input was triggered and a file was selected
    if (e?.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processCsvData(results.data);
          if (fileInputRef.current) fileInputRef.current.value = '';
        },
        error: () => {
          notifications.show({
            title: 'Error',
            message: 'Failed to parse CSV.',
            color: 'red'
          });
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      });
      return;
    }

    // Otherwise, we are being called from the button click
    // Try Tauri native dialog first to get the path for syncing
    // @ts-ignore
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: false,
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        });
        
        if (selected && typeof selected === 'string') {
          const { readTextFile } = await import('@tauri-apps/plugin-fs');
          const content = await readTextFile(selected);
          processCsv(content, selected);
          return;
        }
      } catch (err) {
        console.error('Tauri open failed:', err);
      }
    }

    // Fallback to standard file input trigger
    fileInputRef.current?.click();
  };

  const processCsv = (content: string, path?: string) => {
    Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        processCsvData(results.data, path);
      },
      error: () => {
        notifications.show({
          title: 'Error',
          message: 'Failed to parse CSV.',
          color: 'red'
        });
      }
    });
  };

  const processCsvData = (importedData: any[], path?: string) => {
    const groupMap: Record<string, {
       departmentName: string, 
       weekLabel: string, 
       partsMap: Record<string, PartScorecard>
    }> = {};

    let validRows = 0;
    let invalidRows = 0;

    importedData.forEach(row => {
      const dept = row["Department"];
      const weekId = row["WeekIdentifier"];
      const pNum = row["PartNumber"] || row["Part Number"];
      const day = row["DayOfWeek"] || row["Day"] as DayOfWeek;
      const actualStr = row["Actual"];
      const targetStr = row["Target"];
      const reason = row["ReasonCode"] || row["Reason Code"] || "";

      const validDepts = DEFAULT_DEPARTMENTS.map(d => d.name);
      
      if (!validDepts.includes(dept) || !weekId || !pNum || !DAYS_OF_WEEK.includes(day)) {
        invalidRows++;
        return;
      }
      
      validRows++;
      const groupKey = `${dept}|${weekId}`;

      if (!groupMap[groupKey]) {
         groupMap[groupKey] = {
           departmentName: dept,
           weekLabel: weekId,
           partsMap: {}
         };
      }

      const group = groupMap[groupKey];

      if (!group.partsMap[pNum]) {
         group.partsMap[pNum] = {
           partNumber: pNum,
           dailyRecords: DAYS_OF_WEEK.map(d => ({
             dayOfWeek: d as DayOfWeek,
             actual: null,
             target: null,
             reasonCode: '',
             date: getISODateForDay(weekId, d as DayOfWeek),
             numericDate: getNumericDateForDay(weekId, d as DayOfWeek)
           }))
         };
      }

      const dailyRec = group.partsMap[pNum].dailyRecords.find(d => d.dayOfWeek === day);
      if (dailyRec) {
        dailyRec.actual = actualStr !== undefined && actualStr !== "" ? parseFloat(actualStr) : null;
        dailyRec.target = targetStr !== undefined && targetStr !== "" ? parseFloat(targetStr) : null;
        if (reason) dailyRec.reasonCode = reason;
      }
    });

    const bulkGroups: BulkImportGroup[] = Object.values(groupMap).map(g => ({
      departmentName: g.departmentName,
      weekLabel: g.weekLabel,
      parts: Object.values(g.partsMap)
    }));

    store.bulkImportCsv(bulkGroups);
    if (path) {
      store.setSyncFilePath(path);
    } else {
      // If no path was provided, it means we used the browser fallback
      // @ts-ignore
      const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
      if (!isTauri) {
        notifications.show({
          title: 'Auto-Sync Unavailable',
          message: 'Direct file synchronization is only available in the Tauri desktop application. Changes made here will not update your local file.',
          color: 'blue',
          autoClose: 10000
        });
      }
    }
    
    if (validRows > 0) {
      notifications.show({
        title: 'Import Successful',
        message: `Imported ${validRows} records across ${bulkGroups.length} weeks. ${invalidRows > 0 ? `Ignored ${invalidRows} invalid rows.` : ''}`,
        color: 'green'
      });
    } else {
      notifications.show({
        title: 'Import Error',
        message: `No valid records found to import. Ignored ${invalidRows} rows. Check Department/Headers.`,
        color: 'red'
      });
    }
  };

  const handleGlobalExportCSV = () => {
    const csvData = [
      ["Department", "WeekIdentifier", "PartNumber", "DayOfWeek", "Target", "Actual", "ReasonCode", "Date", "NumericDate"]
    ];

    Object.values(store.departments).forEach(dept => {
      Object.values(dept.weeks).forEach(week => {
        week.parts.forEach(part => {
          part.dailyRecords.forEach(record => {
            csvData.push([
              dept.departmentName,
              week.weekLabel,
              part.partNumber,
              record.dayOfWeek,
              record.target !== null ? record.target.toString() : "",
              record.actual !== null ? record.actual.toString() : "",
              record.reasonCode || "",
              record.date || "",
              record.numericDate?.toString() || ""
            ]);
          });
        });
      });
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Scorecard_Global_Export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // Render variables
  const weekOptions = activeDepartment 
    ? Object.values(activeDepartment.weeks).map(w => ({ value: w.weekId, label: w.weekLabel })) 
    : [];

  const activeWeek = activeDepartment && selectedWeekId ? activeDepartment.weeks[selectedWeekId] : null;

  return (
    <Box className="w-full">
      <Tabs value={activeTab} onChange={setActiveTab} variant="outline" mb="md">
        <Tabs.List>
          {DEFAULT_DEPARTMENTS.map(dept => (
            <Tabs.Tab 
              key={dept.name} 
              value={dept.name} 
              leftSection={dept.icon}
              color="indigo"
            >
              <Text fw={600} size="sm">{dept.name}</Text>
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {/* Week Selection & Actions */}
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
              leftSection={<IconDownload size={16} />} 
              variant="outline" 
              color="teal"
              size="md"
              onClick={handleGlobalExportCSV}
            >
              Download Global CSV
            </Button>
            <Button 
               leftSection={<IconUpload size={16} />} 
               variant="outline" 
               color="indigo"
               size="md"
               onClick={() => handleGlobalUploadCSV()}
            >
              Upload Global CSV
            </Button>
            <input 
              type="file" 
              accept=".csv" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleGlobalUploadCSV} 
            />
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
        
        {/* Sync Status Banner */}
        {store.syncFilePath && (
          <Box 
            mt="md" 
            p="sm" 
            style={{ 
              borderRadius: '8px', 
              background: 'white',
              border: '1px solid var(--mantine-color-gray-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <Group gap="xs">
              <IconLink size={18} style={{ color: 'var(--mantine-color-indigo-6)' }} />
              <Box>
                <Text size="xs" fw={700} c="dimmed" style={{ lineHeight: 1 }}>AUTO-SYNCING TO FILE</Text>
                <Text size="sm" fw={500} truncate maw={400}>{store.syncFilePath}</Text>
              </Box>
              <Badge 
                size="sm" 
                variant="light" 
                color={
                  store.lastSyncStatus === 'synced' ? 'green' : 
                  store.lastSyncStatus === 'syncing' ? 'blue' : 
                  store.lastSyncStatus === 'error' ? 'red' : 'gray'
                }
                leftSection={
                  store.lastSyncStatus === 'synced' ? <IconCloudCheck size={14} /> : 
                  store.lastSyncStatus === 'syncing' ? <IconCloudUpload size={14} /> : 
                  store.lastSyncStatus === 'error' ? <IconCircleX size={14} /> :
                  <IconLink size={14} />
                }
              >
                {
                  store.lastSyncStatus === 'synced' ? 'Synced' : 
                  store.lastSyncStatus === 'syncing' ? 'Syncing...' : 
                  store.lastSyncStatus === 'error' ? 'Sync Error' : 'File Linked'
                }
              </Badge>
              {store.lastSyncTime && (
                <Text size="xs" c="dimmed">Last update: {store.lastSyncTime}</Text>
              )}
            </Group>
            
            <MantineTooltip label="Stop auto-syncing to this file">
              <Button 
                variant="subtle" 
                color="red" 
                size="xs" 
                leftSection={<IconLinkOff size={16} />}
                onClick={() => store.setSyncFilePath(null)}
              >
                Stop Sync
              </Button>
            </MantineTooltip>
          </Box>
        )}
      </Card>

      {/* Week Content */}
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
             </Group>
          </Card>

          {/* Part Cards */}
          <Box className="space-y-4 mb-xl">
            {activeWeek.parts.map(part => (
              <Card key={part.partNumber} withBorder shadow="sm" radius="md">
                <Group justify="space-between" mb="sm">
                  <TextInput
                    label={<Text size="xs" fw={700} c="dimmed">PART NUMBER</Text>}
                    value={part.partNumber}
                    readOnly
                    variant="unstyled"
                    styles={{ input: { color: 'var(--mantine-color-indigo-7)', fontWeight: 600, fontSize: 16 } }}
                  />
                  <ActionIcon 
                    variant="subtle" 
                    color="red" 
                    onClick={() => store.removePartNumber(activeTab!, selectedWeekId!, part.partNumber)}
                  >
                    <IconX size={20} />
                  </ActionIcon>
                </Group>
                <Divider mb="md" />

                <Grid columns={7} gutter="xs">
                  {DAYS_OF_WEEK.map((day) => {
                    const record = part.dailyRecords.find(r => r.dayOfWeek === day);
                    if (!record) return null;

                    // Compute error state for Reason input if missing reason for a miss
                    const needsReason = record.actual !== null && record.target !== null && record.actual < record.target;
                    const hasReasonError = needsReason && !record.reasonCode?.trim();

                    return (
                      <Grid.Col span={1} key={day}>
                        <Card withBorder padding="xs" radius="sm">
                          <Stack gap={0} align="center" mb="xs">
                            <Text size="sm" fw={600} c="dimmed" lh={1}>{day}</Text>
                            {record.date && <Text size="10px" c="indigo.4" fw={700}>{new Date(record.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>}
                          </Stack>
                          <Group gap="xs" mb={4} wrap="nowrap">
                             <Text size="xs" fw={500} c="dimmed" w={20}>Act</Text>
                             <NumberInput
                               size="xs"
                               hideControls
                               value={record.actual !== null ? record.actual : ''}
                               onChange={(val) => store.updateDailyRecord(activeTab!, selectedWeekId!, part.partNumber, day, 'actual', typeof val === 'number' ? val : null)}
                             />
                          </Group>
                          <Group gap="xs" mb="xs" wrap="nowrap">
                             <Text size="xs" fw={500} c="dimmed" w={20}>Tgt</Text>
                             <NumberInput
                               size="xs"
                               hideControls
                               value={record.target !== null ? record.target : ''}
                               onChange={(val) => store.updateDailyRecord(activeTab!, selectedWeekId!, part.partNumber, day, 'target', typeof val === 'number' ? val : null)}
                             />
                          </Group>
                          <TextInput
                            size="xs"
                            placeholder="Reason"
                            value={record.reasonCode}
                            error={hasReasonError}
                            disabled={!needsReason}
                            onChange={(e) => store.updateDailyRecord(activeTab!, selectedWeekId!, part.partNumber, day, 'reasonCode', e.currentTarget.value)}
                          />
                        </Card>
                      </Grid.Col>
                    );
                  })}
                </Grid>
              </Card>
            ))}
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

      {/* Empty State when no week is selected/exists */}
      {!activeWeek && weekOptions.length === 0 && (
         <Text c="dimmed" ta="center" mt="xl">No work weeks defined for this department. Click "Add New Week" to start.</Text>
      )}
    </Box>
  );
}
