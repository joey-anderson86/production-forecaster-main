'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Tabs, Select, Button, TextInput, NumberInput, Card, Grid, Group, Text, ActionIcon, Divider, Box } from '@mantine/core';
import { IconFlask, IconBox, IconShip, IconPlus, IconTrash, IconDownload, IconUpload, IconX } from '@tabler/icons-react';
import { useScorecardStore, DayOfWeek, PartScorecard } from '@/lib/scorecardStore';
import { notifications } from '@mantine/notifications';
import Papa from 'papaparse';

const DEFAULT_DEPARTMENTS = [
  { name: 'Plating', icon: <IconFlask size={16} /> },
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
    const weekLabel = prompt("Enter Week Label (e.g., 'Week 41 (Oct 5 - Oct 11)'):");
    if (weekLabel) {
      const weekId = `week-${Date.now()}`;
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
      ["Part Number", "Day", "Actual", "Target", "Reason Code"]
    ];
    // Add one dummy row as example
    csvData.push(["EX-001", "Mon", "", "", ""]);
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Scorecard_Template.csv`;
    link.click();
  };

  const handleExportCSV = () => {
    if (!activeDepartment || !selectedWeekId) return;
    const weekData = activeDepartment.weeks[selectedWeekId];
    if (!weekData) return;

    const csvData = [
      ["Part Number", "Day", "Actual", "Target", "Reason Code"]
    ];

    weekData.parts.forEach(part => {
      part.dailyRecords.forEach(record => {
        csvData.push([
          part.partNumber,
          record.dayOfWeek,
          record.actual !== null ? record.actual.toString() : "",
          record.target !== null ? record.target.toString() : "",
          record.reasonCode || ""
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

  const handleUploadCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTab || !selectedWeekId) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const importedData = results.data as any[];
        
        // Group by part number
        const partsMap: Record<string, PartScorecard> = {};

        importedData.forEach(row => {
          const pNum = row["Part Number"];
          const day = row["Day"] as DayOfWeek;
          const actualStr = row["Actual"];
          const targetStr = row["Target"];
          const reason = row["Reason Code"] || "";

          if (!pNum || !DAYS_OF_WEEK.includes(day)) return;

          if (!partsMap[pNum]) {
             partsMap[pNum] = {
               partNumber: pNum,
               dailyRecords: DAYS_OF_WEEK.map(d => ({
                 dayOfWeek: d,
                 actual: null,
                 target: null,
                 reasonCode: ''
               }))
             };
          }

          const dailyRec = partsMap[pNum].dailyRecords.find(d => d.dayOfWeek === day);
          if (dailyRec) {
            dailyRec.actual = actualStr ? parseFloat(actualStr) : null;
            dailyRec.target = targetStr ? parseFloat(targetStr) : null;
            dailyRec.reasonCode = reason;
          }
        });

        const newParts = Object.values(partsMap);
        store.importWeeklyCsv(activeTab, selectedWeekId, newParts);
        
        notifications.show({
          title: 'Success',
          message: `Imported data for ${newParts.length} parts.`,
          color: 'green'
        });

        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
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
                <Button 
                  leftSection={<IconUpload size={16} />} 
                  variant="light" 
                  color="indigo"
                  size="xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload CSV
                </Button>
                <input 
                  type="file" 
                  accept=".csv" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleUploadCSV} 
                />
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
                          <Text ta="center" size="sm" fw={600} mb="xs" c="dimmed">{day}</Text>
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
