'use client';

import React, { useState, useEffect } from 'react';
import { 
  Table, Card, Title, Text, Group, Button, 
  Loader, Center, Alert, Stack, ScrollArea,
  Badge, FileButton, Select, Divider, Modal,
  Skeleton
} from '@mantine/core';
import { open } from '@tauri-apps/plugin-dialog';
import { 
  IconTable, IconRefresh, IconAlertCircle, 
  IconDatabase, IconDatabaseExport, IconUpload,
  IconDownload, IconTrash
} from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { notifications } from '@mantine/notifications';
import Papa from 'papaparse';

interface PipelineRow {
  date?: string;
  customer?: string;
  customerCity?: string;
  partNumber?: string;
  partName?: string;
  wipLocator?: string;
  qty?: number;
}

export function PipelineDataPreview() {
  const [data, setData] = useState<PipelineRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedDeleteDate, setSelectedDeleteDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionString, setConnectionString] = useState<string | null>(null);

  // New states for Transpose & Preview
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [transposedData, setTransposedData] = useState<PipelineRow[]>([]);
  const [isConfirmingUpload, setIsConfirmingUpload] = useState(false);

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
      const result = await invoke<PipelineRow[]>("get_pipeline_data_preview", { 
        connectionString: activeConnStr 
      });
      setData(result);
    } catch (err) {
      console.error("Failed to fetch pipeline data:", err);
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
    // Current "upload" pattern for the forecaster migration
    notifications.show({
      title: "Data Ready",
      message: `${data.length} records are now active as the forecaster's live pipeline source.`,
      color: "green"
    });
  };

  const handleTransposedFileUpload = async () => {
    if (!connectionString) {
      notifications.show({
        title: "Configuration Missing",
        message: "Please ensure your database connection string is set in Settings.",
        color: "yellow"
      });
      return;
    }

    try {
      // Use the Tauri open dialog to get the absolute file path
      const filePath = await open({
        multiple: false,
        filters: [{
          name: 'CSV Files',
          extensions: ['csv']
        }]
      });

      if (!filePath) return;

      setIsUploading(true);
      
      const result = await invoke<PipelineRow[]>("parse_and_transpose_pipeline_csv", { 
        filePath 
      });

      if (result.length === 0) {
        notifications.show({
          title: "No Data Found",
          message: "The CSV appears to be empty or in an unrecognized format.",
          color: "orange"
        });
        return;
      }

      setTransposedData(result);
      setIsPreviewModalOpen(true);

    } catch (err) {
      console.error(err);
      notifications.show({
        title: "Processing Failed",
        message: typeof err === "string" ? err : "An error occurred while parsing the CSV. Check that required headers ARE: Date, Customer, Customer City, Part Number.",
        color: "red",
        autoClose: 10000
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmUpload = async () => {
    if (!connectionString || transposedData.length === 0) return;

    setIsConfirmingUpload(true);
    try {
      await invoke("append_pipeline_data", { 
        connectionString, 
        records: transposedData 
      });

      notifications.show({
        title: "Data Uploaded",
        message: `Successfully uploaded ${transposedData.length} records to the database.`,
        color: "green",
      });

      setIsPreviewModalOpen(false);
      setTransposedData([]);
      fetchData();
    } catch (err) {
      console.error(err);
      notifications.show({
        title: "Database Error",
        message: typeof err === "string" ? err : "Failed to insert records into the database.",
        color: "red"
      });
    } finally {
      setIsConfirmingUpload(false);
    }
  };

  const handleDeleteDate = async () => {
    if (!selectedDeleteDate || !connectionString) return;

    if (!confirm(`Are you sure you want to delete all data for ${selectedDeleteDate}?`)) {
      return;
    }

    setIsDeleting(true);
    try {
      await invoke("delete_pipeline_data_by_date", { 
        connectionString, 
        date: selectedDeleteDate 
      });

      notifications.show({
        title: "Deletion Successful",
        message: `All pipeline data for ${selectedDeleteDate} has been removed.`,
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
    const headers = "Date,Customer,CustomerCity,PartNumber,PartName,WIPLocator,Qty";
    const blob = new Blob([headers], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "pipeline_data_template.csv");
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
            <IconDatabase size={24} color="var(--mantine-color-indigo-6)" />
            <Stack gap={0}>
              <Title order={4}>Live Pipeline Data (MSSQL)</Title>
              <Text size="xs" c="dimmed">Displaying dbo.PipelineData</Text>
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

            <Button 
              variant="light" 
              color="indigo" 
              size="xs" 
              leftSection={<IconUpload size={14} />}
              loading={isUploading}
              onClick={handleTransposedFileUpload}
            >
              Advanced Pipeline Upload
            </Button>

            <Button 
              variant="filled" 
              color="indigo" 
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
          Preview of live manufacturing pipeline data from the MSSQL server. This data will soon replace the CSV-based workflow.
        </Text>

        <Divider variant="dashed" />
        
        <Group align="flex-end">
          <Select 
            label="Delete Data by Snapshot Date"
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
            Delete Selected Date
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
              <Loader size="md" color="indigo" />
              <Text size="sm" c="dimmed">Querying MSSQL database...</Text>
            </Stack>
          </Center>
        ) : data.length === 0 ? (
          <Center h={200} className="bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
            <Stack align="center" gap="xs">
              <IconTable size={40} color="var(--mantine-color-gray-4)" />
              <Text c="dimmed">No data found or connection not established.</Text>
            </Stack>
          </Center>
        ) : (
          <ScrollArea h={400} offsetScrollbars>
            <Table stickyHeader striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Customer</Table.Th>
                  <Table.Th>Part Number</Table.Th>
                  <Table.Th>Part Name</Table.Th>
                  <Table.Th>WIP Locator</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((row, index) => (
                  <Table.Tr key={index}>
                    <Table.Td>
                      <Text size="xs" fw={500}>{row.date || '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={0}>
                        <Text size="xs" fw={600} truncate maw={150}>{row.customer || '-'}</Text>
                        {row.customerCity && <Text size="10px" c="dimmed">{row.customerCity}</Text>}
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color="indigo">{row.partNumber || '-'}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" truncate maw={200} title={row.partName}>{row.partName || '-'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" fw={700} color="indigo">{row.wipLocator || '-'}</Text>
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

      <Modal
        opened={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        title="Review Transposed Pipeline Data"
        size="90%"
        radius="md"
        styles={{ title: { width: '100%' } }}
      >
        <Stack gap="md">
          <Text size="sm">
            The CSV has been transposed from a wide format to the long database format. 
            Please review the first 500 rows below before confirming the upload.
          </Text>

          <ScrollArea h={500} offsetScrollbars>
            <Table stickyHeader striped highlightOnHover withTableBorder>
              <Table.Thead className="bg-slate-50">
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Customer</Table.Th>
                  <Table.Th>City</Table.Th>
                  <Table.Th>Part Number</Table.Th>
                  <Table.Th>Part Name</Table.Th>
                  <Table.Th>WIP Locator</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {transposedData.slice(0, 500).map((row, idx) => (
                  <Table.Tr key={idx}>
                    <Table.Td>{row.date}</Table.Td>
                    <Table.Td>{row.customer}</Table.Td>
                    <Table.Td>{row.customerCity}</Table.Td>
                    <Table.Td><Badge size="xs" variant="light">{row.partNumber}</Badge></Table.Td>
                    <Table.Td><Text size="xs" truncate maw={150} title={row.partName}>{row.partName}</Text></Table.Td>
                    <Table.Td fw={700} color="indigo">{row.wipLocator}</Table.Td>
                    <Table.Td ta="right">{row.qty?.toLocaleString()}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          
          {transposedData.length > 500 && (
            <Text size="xs" c="dimmed" ta="center">
              Only showing first 500 of {transposedData.length} total rows.
            </Text>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setIsPreviewModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              color="green" 
              leftSection={<IconDatabase size={16} />}
              loading={isConfirmingUpload}
              onClick={handleConfirmUpload}
            >
              Confirm & Upload {transposedData.length} Rows
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
