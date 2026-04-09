'use client';

import React, { useState, useEffect } from 'react';
import { 
  Table, Card, Title, Text, Group, Button, 
  Loader, Center, Alert, Stack, ScrollArea,
  Badge, FileButton, Select, Divider
} from '@mantine/core';
import { 
  IconTable, IconRefresh, IconAlertCircle, 
  IconDatabase, IconDatabaseExport, IconUpload,
  IconDownload, IconTrash, IconCalendarStats, IconDatabaseSearch
} from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { ask } from '@tauri-apps/plugin-dialog';
import { notifications } from '@mantine/notifications';
import Papa from 'papaparse';
import { getWeekIdentifier, getDayOfWeekLabel, parseISOLocal } from '@/lib/dateUtils';

interface PlanRow {
  date?: string;
  partNumber?: string;
  partName?: string;
  process?: string;
  qty?: number;
  actual?: number | null;
  shift?: string;
  weekIdentifier?: string;
  dayOfWeek?: string;
  reasonCode?: string | null;
}

export function PlanDataPreview() {
  const [data, setData] = useState<PlanRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedDeleteDate, setSelectedDeleteDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionString, setConnectionString] = useState<string | null>(null);

  const fetchConnectionString = async () => {
    try {
      const store = await load("store.json", { autoSave: false, defaults: {} });
      const val = await store.get<string>("db_connection_string");
      setConnectionString(val || null);
      if (val) {
        fetchData(val);
      }
    } catch (err) {
      console.error("Failed to load connection string:", err);
      setError("Failed to load database configuration. Please check your settings.");
    }
  };

  const fetchData = async (connStr?: string) => {
    const activeConnStr = connStr || connectionString;
    if (!activeConnStr) {
      setError("Database connection string is not configured. Please go to Settings to set it up.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await invoke<PlanRow[]>("get_plan_data_preview", { 
        connectionString: activeConnStr 
      });
      setData(result);
    } catch (err) {
      console.error("Failed to fetch plan data:", err);
      setError(typeof err === "string" ? err : "An error occurred while fetching data from the database.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConnectionString();
  }, []);

  const handleRefresh = () => {
    fetchData();
  };

  const handleApplyToForecaster = () => {
    notifications.show({
      title: "Data Ready",
      message: `${data.length} plan records are now active as the forecaster's live demand source.`,
      color: "green"
    });
  };

  const handleFileUpload = (file: File | null) => {
    if (!file || !connectionString) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        setIsUploading(true);
        try {
          const rawData = results.data as any[];
          const mapped: PlanRow[] = rawData.map(r => {
            const dateStr = r.Date || r.date || "";
            const dateObj = parseISOLocal(dateStr); // Ensure local date parsing
            return {
              date: dateStr,
              partNumber: r.PartNumber || r.partNumber || "",
              partName: "",
              process: r.Process || r.process || "",
              qty: parseInt(r.Qty || r.qty || "0"),
              actual: null,
              shift: r.Shift || r.shift || "",
              weekIdentifier: isNaN(dateObj.getTime()) ? "" : getWeekIdentifier(dateObj),
              dayOfWeek: isNaN(dateObj.getTime()) ? "" : getDayOfWeekLabel(dateObj),
              reasonCode: ""
            };
          });

          await invoke("append_plan_data", { 
            connectionString, 
            records: mapped 
          });

          notifications.show({
            title: "Data Appended",
            message: `Successfully added ${mapped.length} new demand records to the plan.`,
            color: "green",
          });
          fetchData();
        } catch (err) {
          console.error(err);
          notifications.show({
            title: "Upload Failed",
            message: typeof err === "string" ? err : "An error occurred while uploading. Ensure headers match the schema.",
            color: "red",
          });
        } finally {
          setIsUploading(false);
        }
      }
    });
  };

  const handleDeleteDate = async () => {
    if (!selectedDeleteDate || !connectionString) return;

    const confirmed = await ask(`Are you sure you want to delete all plan data for ${selectedDeleteDate}?`, {
      title: 'Confirm Deletion',
      kind: 'warning'
    });

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await invoke("delete_plan_data_by_date", { 
        connectionString, 
        date: selectedDeleteDate 
      });

      notifications.show({
        title: "Deletion Successful",
        message: `All plan data for ${selectedDeleteDate} has been removed.`,
        color: "green",
      });
      setSelectedDeleteDate(null);
      fetchData();
    } catch (err) {
      console.error(err);
      notifications.show({
        title: "Deletion Failed",
        message: typeof err === "string" ? err : "An error occurred while deleting.",
        color: "red",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const uniqueDates = Array.from(new Set(data.map(r => r.date).filter(Boolean))).sort().reverse();
  const dateOptions = uniqueDates.map(d => ({ value: d!, label: d! }));

  const downloadTemplate = () => {
    const headers = "Date,PartNumber,PartName,Process,Qty,Shift";
    const blob = new Blob([headers], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "plan_data_template.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Card shadow="sm" p="lg" radius="md" withBorder className="bg-white dark:bg-slate-900 shadow-md">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <IconCalendarStats size={24} color="var(--mantine-color-teal-6)" />
            <Stack gap={0}>
              <Title order={4}>Production Plan Targets</Title>
              <Text size="xs" c="dimmed">Displaying dbo.DeliveryData (Targets)</Text>
            </Stack>
          </Group>
          <Group gap="xs">
            <Button 
              variant="default" 
              color="gray" 
              size="xs" 
              onClick={handleRefresh} 
              loading={isLoading}
              leftSection={<IconRefresh size={14} />}
            >
              Sync Live
            </Button>
            
            <Button 
              variant="subtle" 
              color="gray" 
              size="xs" 
              leftSection={<IconDownload size={14} />}
              onClick={downloadTemplate}
            >
              Template
            </Button>

            <FileButton onChange={handleFileUpload} accept=".csv">
              {(props) => (
                <Button 
                  {...props} 
                  variant="light" 
                  color="gray" 
                  size="xs" 
                  leftSection={<IconUpload size={14} />}
                  loading={isUploading}
                >
                  Append New Plan Day
                </Button>
              )}
            </FileButton>

            <Button 
              variant="filled" 
              color="teal" 
              size="xs" 
              onClick={handleApplyToForecaster}
              disabled={data.length === 0}
              leftSection={<IconDatabaseExport size={14} />}
            >
              Active for Forecast
            </Button>
          </Group>
        </Group>

        <Text size="sm" c="dimmed">
          Preview of live demand and production plan from the MSSQL server. This central production plan pulls from the Targets in DeliveryData.
        </Text>

        <Divider variant="dashed" />
        
        <Group align="flex-end">
          <Select 
            label="Delete Plan by Date"
            placeholder="Select date to remove"
            data={dateOptions}
            value={selectedDeleteDate}
            onChange={setSelectedDeleteDate}
            size="xs"
            className="flex-1 max-w-xs"
            disabled={dateOptions.length === 0}
          />
          <Button 
            color="red" 
            variant="light" 
            size="xs" 
            leftSection={<IconTrash size={14} />} 
            onClick={handleDeleteDate}
            disabled={!selectedDeleteDate}
            loading={isDeleting}
          >
            Delete Plan Date
          </Button>
        </Group>

        <Divider variant="dashed" />

        {error ? (
          <Alert variant="light" color="red" title="Database Error" icon={<IconAlertCircle size={18} />}>
            {error}
            <Button 
              variant="outline" 
              color="red" 
              size="xs" 
              mt="md" 
              onClick={handleRefresh} 
              leftSection={<IconRefresh size={14} />}
            >
              Retry
            </Button>
          </Alert>
        ) : isLoading ? (
          <Center h={300}>
            <Stack align="center" gap="xs">
              <Loader size="md" color="teal" />
              <Text size="sm" c="dimmed">Retrieving demand plan...</Text>
            </Stack>
          </Center>
        ) : data.length === 0 ? (
          <Center h={200} className="bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
            <Stack align="center" gap="xs">
              <IconTable size={40} color="var(--mantine-color-gray-4)" />
              <Text c="dimmed">No plan records found for retrieved snapshots.</Text>
            </Stack>
          </Center>
        ) : (
          <ScrollArea h={400} offsetScrollbars>
            <Table stickyHeader striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Part Number</Table.Th>
                  <Table.Th>Part Name</Table.Th>
                  <Table.Th>Process</Table.Th>
                  <Table.Th ta="center">Shift</Table.Th>
                  <Table.Th ta="right">Plan Qty</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((row, index) => (
                  <Table.Tr key={index}>
                    <Table.Td>
                      <Text size="xs" fw={500}>{row.date || '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color="teal">{row.partNumber || '-'}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" truncate maw={200} title={row.partName}>{row.partName || '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" fw={700} color="teal">{row.process || '-'}</Text>
                    </Table.Td>
                    <Table.Td ta="center">
                      <Badge size="xs" variant="outline" color="gray">{row.shift || '-'}</Badge>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" fw={700}>{(row.qty ?? 0).toLocaleString()}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </Card>
  );
}
