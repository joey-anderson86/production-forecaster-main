"use client";

import { useState, useEffect, useMemo } from "react";
import {
  TextInput,
  Button,
  Group,
  Stack,
  Card,
  Title,
  Text,
  Tabs,
  Table,
  Loader,
  Alert,
  Center,
  ScrollArea,
  ActionIcon,
  NumberInput,
  FileButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import Papa from "papaparse";
import {
  IconDatabase,
  IconTable,
  IconSearch,
  IconAlertCircle,
  IconRefresh,
  IconPlus,
  IconDeviceFloppy,
  IconTrash,
  IconUpload,
  IconDownload
} from "@tabler/icons-react";



interface LocatorMapping {
  wipLocator?: string;
  process?: string;
  daysFromShipment?: number;
}

interface PartInfo {
  partNumber?: string;
  process?: string;
  batchSize?: number;
  processingTime?: number;
}

interface ProcessInfo {
  process?: string;
  date?: string;
  hoursAvailable?: number;
  machineId?: string;
}

export function DatabaseSettings() {
  const [connectionString, setConnectionString] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Preview States
  const [activeTab, setActiveTab] = useState<string | null>("locatorMapping");
  const [locatorMappings, setLocatorMappings] = useState<LocatorMapping[]>([]);
  const [partInfos, setPartInfos] = useState<PartInfo[]>([]);
  const [processInfos, setProcessInfos] = useState<ProcessInfo[]>([]);
  
  // Initial states for comparison
  const [initialLocatorMappings, setInitialLocatorMappings] = useState<string>("");
  const [initialPartInfos, setInitialPartInfos] = useState<string>("");
  const [initialProcessInfos, setInitialProcessInfos] = useState<string>("");

  // Deletion tracking
  const [deletedLocators, setDeletedLocators] = useState<string[]>([]);
  const [deletedPartInfos, setDeletedPartInfos] = useState<{partNumber: string, process: string}[]>([]);
  const [deletedProcessInfos, setDeletedProcessInfos] = useState<{process: string, date: string, machineId: string}[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSavingData, setIsSavingData] = useState(false);
  const [isSyncingLocators, setIsSyncingLocators] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Detection of changes
  const hasChanges = useMemo(() => {
    const tableDirty = activeTab === "locatorMapping" 
      ? JSON.stringify(locatorMappings) !== initialLocatorMappings 
      : activeTab === "partInfo" 
      ? JSON.stringify(partInfos) !== initialPartInfos 
      : JSON.stringify(processInfos) !== initialProcessInfos;

    const deletionDirty = activeTab === "locatorMapping" 
      ? deletedLocators.length > 0 
      : activeTab === "partInfo" 
      ? deletedPartInfos.length > 0
      : deletedProcessInfos.length > 0;

    return tableDirty || deletionDirty;
  }, [activeTab, locatorMappings, partInfos, processInfos, initialLocatorMappings, initialPartInfos, initialProcessInfos, deletedLocators, deletedPartInfos, deletedProcessInfos]);

  useEffect(() => {
    async function init() {
      try {
        const store = await load("store.json", { autoSave: false, defaults: {} });
        const val = await store.get<string>("db_connection_string");
        if (val) {
          setConnectionString(val);
          // Fetch immediately on mount once string is found
          fetchData(activeTab, val); 
        }
      } catch (err) {
        console.error("Failed to load store:", err);
      }
    }
    init();
  }, []);

  const fetchData = async (tab: string | null, connStr?: string) => {
    const activeConnStr = connStr || connectionString;
    if (!activeConnStr) return;
    
    setIsLoadingData(true);
    setFetchError(null);
    
    try {
      if (tab === "locatorMapping") {
        const data = await invoke<LocatorMapping[]>("get_locator_mapping_preview", { connectionString: activeConnStr });
        setLocatorMappings(data);
        setInitialLocatorMappings(JSON.stringify(data));
        setDeletedLocators([]);
      } else if (tab === "partInfo") {
        const data = await invoke<PartInfo[]>("get_part_info_preview", { connectionString: activeConnStr });
        setPartInfos(data);
        setInitialPartInfos(JSON.stringify(data));
        setDeletedPartInfos([]);
      } else if (tab === "processInfo") {
        const data = await invoke<ProcessInfo[]>("get_process_info_preview", { connectionString: activeConnStr });
        setProcessInfos(data);
        setInitialProcessInfos(JSON.stringify(data));
        setDeletedProcessInfos([]);
      }
    } catch (err) {
      console.error(`Failed to fetch ${tab} data:`, err);
      setFetchError(typeof err === "string" ? err : "Failed to fetch data from database.");
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    // This handles tab changes. 
    // We avoid adding connectionString here to prevent fetching on every keystroke.
    fetchData(activeTab);
  }, [activeTab]);


  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const store = await load("store.json", { autoSave: false, defaults: {} });
      await store.set("db_connection_string", connectionString);
      await store.save();
      notifications.show({
        title: "Success",
        message: "Settings saved successfully",
        color: "green",
      });
      fetchData(activeTab);
    } catch (err) {
      console.error(err);
      notifications.show({
        title: "Error",
        message: "Failed to save settings",
        color: "red",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!connectionString) {
      notifications.show({
        title: "Validation Error",
        message: "Please enter a connection string first.",
        color: "red",
      });
      return;
    }

    setIsTesting(true);
    try {
      const result = await invoke<string>("test_mssql_connection", {
        connectionString,
      });

      notifications.show({
        title: "Connection Successful",
        message: result,
        color: "green",
        icon: <IconDatabase size={18} />,
      });
      fetchData(activeTab);
    } catch (err) {
      const errorMessage = typeof err === "string" ? err : "Unknown error occurred";
      notifications.show({
        title: "Connection Failed",
        message: errorMessage,
        color: "red",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveChanges = async () => {
    setIsSavingData(true);
    try {
      if (activeTab === "locatorMapping") {
        // Handle deletions first
        if (deletedLocators.length > 0) {
          await invoke("delete_locator_mappings", { connectionString, wipLocators: deletedLocators });
        }
        // Handle upserts
        await invoke("upsert_locator_mapping", { connectionString, records: locatorMappings });
      } else if (activeTab === "partInfo") {
        // Handle deletions
        if (deletedPartInfos.length > 0) {
          const identifiers = deletedPartInfos.map(p => ({ part_number: p.partNumber, process: p.process }));
          await invoke("delete_part_infos", { connectionString, identifiers });
        }
        // Handle upserts
        await invoke("upsert_part_info", { connectionString, records: partInfos });
      } else if (activeTab === "processInfo") {
        // Handle deletions
        if (deletedProcessInfos.length > 0) {
          const identifiers = deletedProcessInfos.map(p => ({ process: p.process, date: p.date, machine_id: p.machineId }));
          await invoke("delete_process_infos", { connectionString, identifiers });
        }
        // Handle upserts
        await invoke("upsert_process_info", { connectionString, records: processInfos });
      }
      
      notifications.show({
        title: "Database Updated",
        message: "Successfully synchronized records with MSSQL",
        color: "green",
        icon: <IconDeviceFloppy size={18} />,
      });
      
      fetchData(activeTab);
    } catch (err) {
      notifications.show({
        title: "Save Error",
        message: typeof err === "string" ? err : "Failed to update database records",
        color: "red",
      });
    } finally {
      setIsSavingData(false);
    }
  };

  const handleSyncPipelineLocators = async () => {
    if (!connectionString) return;
    
    setIsSyncingLocators(true);
    try {
      const insertedCount = await invoke<number>("sync_pipeline_locators", { connectionString });
      
      notifications.show({
        title: "Synchronization Complete",
        message: `Successfully synced ${insertedCount} new locators from pipeline data.`,
        color: "green",
        icon: <IconRefresh size={18} />,
      });
      
      // Refresh the table
      fetchData("locatorMapping");
    } catch (err) {
      console.error(err);
      notifications.show({
        title: "Sync Error",
        message: typeof err === "string" ? err : "Failed to synchronize locators",
        color: "red",
      });
    } finally {
      setIsSyncingLocators(false);
    }
  };

  const addRecord = () => {
    if (activeTab === "locatorMapping") {
      setLocatorMappings(prev => [...prev, { wipLocator: "", process: "", daysFromShipment: 0 }]);
    } else if (activeTab === "partInfo") {
      setPartInfos(prev => [...prev, { partNumber: "", process: "", batchSize: 0, processingTime: 0 }]);
    } else if (activeTab === "processInfo") {
      const today = new Date().toISOString().split('T')[0];
      setProcessInfos(prev => [...prev, { process: "", date: today, hoursAvailable: 8, machineId: "" }]);
    }
  };

  const updateRecord = (index: number, field: string, value: any) => {
    if (activeTab === "locatorMapping") {
      const next = [...locatorMappings];
      next[index] = { ...next[index], [field]: value };
      setLocatorMappings(next);
    } else if (activeTab === "partInfo") {
      const next = [...partInfos];
      next[index] = { ...next[index], [field]: value };
      setPartInfos(next);
    } else if (activeTab === "processInfo") {
      const next = [...processInfos];
      next[index] = { ...next[index], [field]: value };
      setProcessInfos(next);
    }
  };

  const removeLocalRecord = (index: number) => {
    if (activeTab === "locatorMapping") {
      const record = locatorMappings[index];
      const initial = JSON.parse(initialLocatorMappings) as LocatorMapping[];
      const wasInDb = initial.some(r => r.wipLocator === record.wipLocator);
      
      if (wasInDb && record.wipLocator) {
        setDeletedLocators(prev => [...prev, record.wipLocator!]);
      }
      setLocatorMappings(prev => prev.filter((_, i) => i !== index));
    } else if (activeTab === "partInfo") {
      const record = partInfos[index];
      const initial = JSON.parse(initialPartInfos) as PartInfo[];
      const wasInDb = initial.some(r => r.partNumber === record.partNumber && r.process === record.process);
      
      if (wasInDb && record.partNumber && record.process) {
        setDeletedPartInfos(prev => [...prev, { partNumber: record.partNumber!, process: record.process! }]);
      }
      setPartInfos(prev => prev.filter((_, i) => i !== index));
    } else if (activeTab === "processInfo") {
      const record = processInfos[index];
      const initial = JSON.parse(initialProcessInfos) as ProcessInfo[];
      const wasInDb = initial.some(r => r.process === record.process && r.date === record.date && r.machineId === record.machineId);
      
      if (wasInDb && record.process && record.date && record.machineId) {
        setDeletedProcessInfos(prev => [...prev, { process: record.process!, date: record.date!, machineId: record.machineId! }]);
      }
      setProcessInfos(prev => prev.filter((_, i) => i !== index));
    }
  };


  const handleFileUpload = (file: File | null) => {
    if (!file || !connectionString) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        setIsSavingData(true);
        try {
          const rawData = results.data as any[];
          
          if (activeTab === "locatorMapping") {
            const mapped = rawData.map(r => ({
              wipLocator: r.WIPLocator || r.wipLocator || "",
              process: r.Process || r.process || "",
              daysFromShipment: parseInt(r.DaysFromShipment || r.daysFromShipment || "0")
            }));
            await invoke("replace_locator_mappings", { connectionString, records: mapped });
          } else if (activeTab === "partInfo") {
            const mapped = rawData.map(r => ({
              partNumber: r.PartNumber || r.partNumber || "",
              process: r.Process || r.process || "",
              batchSize: parseInt(r.BatchSize || r.batchSize || "0"),
              processingTime: parseInt(r.ProcessingTime || r.processingTime || "0")
            }));
            await invoke("replace_part_infos", { connectionString, records: mapped });
          } else if (activeTab === "processInfo") {
            const mapped = rawData.map(r => ({
              process: r.Process || r.process || "",
              date: r.Date || r.date || "",
              hoursAvailable: parseInt(r.HoursAvailable || r.hoursAvailable || "0"),
              machineId: r.MachineID || r.MachineId || r.machineId || ""
            }));
            await invoke("replace_process_infos", { connectionString, records: mapped });
          }

          notifications.show({
            title: "Import Successful",
            message: `Replaced all records in ${activeTab} with data from ${file.name}`,
            color: "green",
          });
          fetchData(activeTab);
        } catch (err) {
          console.error(err);
          notifications.show({
            title: "Import Failed",
            message: typeof err === "string" ? err : "Failed to process CSV file",
            color: "red",
          });
        } finally {
          setIsSavingData(false);
        }
      }
    });
  };

  const downloadTemplate = () => {
    let headers = "";
    let fileName = "";
    
    if (activeTab === "locatorMapping") {
      headers = "WIPLocator,Process,DaysFromShipment";
      fileName = "locator_mapping_template.csv";
    } else if (activeTab === "partInfo") {
      headers = "PartNumber,Process,BatchSize,ProcessingTime";
      fileName = "part_information_template.csv";
    } else if (activeTab === "processInfo") {
      headers = "Process,Date,HoursAvailable,MachineID";
      fileName = "process_information_template.csv";
    }
    
    if (!headers) return;

    const blob = new Blob([headers], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    notifications.show({
      title: "Template Downloaded",
      message: `Headed to your downloads: ${fileName}`,
      color: "blue",
    });
  };

  const renderTable = () => {


    if (isLoadingData) {
      return (
        <Center h={200}>
          <Stack align="center" gap="xs">
            <Loader size="md" color="indigo" />
            <Text size="sm" c="dimmed">Loading records...</Text>
          </Stack>
        </Center>
      );
    }

    if (fetchError) {
      return (
        <Alert variant="light" color="red" title="Database Error" icon={<IconAlertCircle size={18} />} mt="md">
          {fetchError}
          <Button variant="outline" color="red" size="xs" mt="md" onClick={() => fetchData(activeTab)} leftSection={<IconRefresh size={14} />}>
            Retry
          </Button>
        </Alert>
      );
    }

    if (activeTab === "locatorMapping") {
      return (
        <ScrollArea h={400} mt="md">
          <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>WIP Locator</Table.Th>
                <Table.Th>Process</Table.Th>
                <Table.Th>Days From Shipment</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {locatorMappings.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <TextInput 
                      variant="unstyled" 
                      size="xs" 
                      p={0} 
                      value={row.wipLocator || ""} 
                      onChange={(e) => updateRecord(i, "wipLocator", e.currentTarget.value)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.process || ""} 
                      onChange={(e) => updateRecord(i, "process", e.currentTarget.value)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.daysFromShipment} 
                      onChange={(val) => updateRecord(i, "daysFromShipment", val)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" onClick={() => removeLocalRecord(i)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {locatorMappings.length === 0 && (
                <Table.Tr><Table.Td colSpan={4}><Text ta="center" c="dimmed">No records found</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      );
    }

    if (activeTab === "partInfo") {
      return (
        <ScrollArea h={400} mt="md">
          <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="auto">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Part Number</Table.Th>
                <Table.Th>Process</Table.Th>
                <Table.Th>Batch Size</Table.Th>
                <Table.Th>Processing Time</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {partInfos.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <TextInput variant="unstyled" size="xs" value={row.partNumber || ""} onChange={(e) => updateRecord(i, "partNumber", e.currentTarget.value)} />
                  </Table.Td>
                  <Table.Td>
                    <TextInput variant="unstyled" size="xs" value={row.process || ""} onChange={(e) => updateRecord(i, "process", e.currentTarget.value)} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput variant="unstyled" size="xs" value={row.batchSize} onChange={(val) => updateRecord(i, "batchSize", val)} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput variant="unstyled" size="xs" value={row.processingTime} onChange={(val) => updateRecord(i, "processingTime", val)} />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" onClick={() => removeLocalRecord(i)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {partInfos.length === 0 && (
                <Table.Tr><Table.Td colSpan={5}><Text ta="center" c="dimmed">No records found</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      );
    }

    if (activeTab === "processInfo") {
      return (
        <ScrollArea h={400} mt="md">
          <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Process</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Hours Available</Table.Th>
                <Table.Th>Machine ID</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {processInfos.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <TextInput variant="unstyled" size="xs" value={row.process || ""} onChange={(e) => updateRecord(i, "process", e.currentTarget.value)} />
                  </Table.Td>
                  <Table.Td>
                    <TextInput variant="unstyled" size="xs" value={row.date || ""} onChange={(e) => updateRecord(i, "date", e.currentTarget.value)} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput variant="unstyled" size="xs" value={row.hoursAvailable} onChange={(val) => updateRecord(i, "hoursAvailable", val)} />
                  </Table.Td>
                  <Table.Td>
                    <TextInput variant="unstyled" size="xs" value={row.machineId || ""} onChange={(e) => updateRecord(i, "machineId", e.currentTarget.value)} />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" onClick={() => removeLocalRecord(i)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {processInfos.length === 0 && (
                <Table.Tr><Table.Td colSpan={5}><Text ta="center" c="dimmed">No records found</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      );
    }

    return null;
  };

  return (
    <Stack gap="lg">
      <Card shadow="sm" p="lg" radius="md" withBorder>
        <Stack gap="md">
          <Title order={3}>Database Settings</Title>
          <Text size="sm" c="dimmed">
            Configure the Microsoft SQL Server connection for the application backend.
            Ensure that your connection string follows the standard ADO.NET format.
          </Text>

          <TextInput
            label="Connection String"
            placeholder="server=tcp:localhost,1433;user=sa;password=my_password;TrustServerCertificate=true"
            value={connectionString}
            onChange={(e) => setConnectionString(e.currentTarget.value)}
            required
            leftSection={<IconSearch size={16} />}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={handleTestConnection} loading={isTesting} leftSection={<IconRefresh size={16} />}>
              Test Connection
            </Button>
            <Button onClick={handleSaveSettings} loading={isSaving}>
              Save Connection
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card shadow="sm" p="lg" radius="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Group gap="xs">
              <IconTable size={20} color="var(--mantine-color-indigo-6)" />
              <Title order={4}>Data Management</Title>
            </Group>
            
            <Group gap="xs">
              <Button 
                variant="subtle" 
                color="gray" 
                size="xs" 
                leftSection={<IconDownload size={14} />}
                onClick={downloadTemplate}
              >
                Download Template
              </Button>
              <FileButton onChange={handleFileUpload} accept=".csv">
                {(props) => (
                  <Button 
                    {...props} 
                    variant="light" 
                    color="gray" 
                    size="xs" 
                    leftSection={<IconUpload size={14} />}
                    loading={isSavingData}
                  >
                    Replace with CSV
                  </Button>
                )}
              </FileButton>

              {activeTab === "locatorMapping" && (
                <Button 
                  variant="light" 
                  color="blue" 
                  size="xs" 
                  leftSection={<IconRefresh size={14} />}
                  loading={isSyncingLocators}
                  onClick={handleSyncPipelineLocators}
                >
                  Refresh to Pipeline
                </Button>
              )}

              <Button 
                variant="light" 
                color="indigo" 
                size="xs" 
                leftSection={<IconPlus size={14} />}
                onClick={addRecord}
              >
                Add Record
              </Button>

              <Button 
                color="green" 
                size="xs" 
                leftSection={<IconDeviceFloppy size={14} />}
                disabled={!hasChanges}
                loading={isSavingData}
                onClick={handleSaveChanges}
              >
                Save Changes
              </Button>
            </Group>
          </Group>
          
          <Text size="sm" c="dimmed">
            Directly edit manufacturing records. Changes will be synchronized with MSSQL using an UPSERT pattern.
          </Text>

          <Tabs value={activeTab} onChange={setActiveTab} color="indigo">
            <Tabs.List>
              <Tabs.Tab value="locatorMapping" leftSection={<IconTable size={14} />}>
                Locator Mapping
              </Tabs.Tab>
              <Tabs.Tab value="partInfo" leftSection={<IconTable size={14} />}>
                Part Information
              </Tabs.Tab>
              <Tabs.Tab value="processInfo" leftSection={<IconTable size={14} />}>
                Process Information
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="locatorMapping">
              {renderTable()}
            </Tabs.Panel>

            <Tabs.Panel value="partInfo">
              {renderTable()}
            </Tabs.Panel>

            <Tabs.Panel value="processInfo">
              {renderTable()}
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Card>
    </Stack>
  );
}


