"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Table,
  Group,
  Button,
  Select,
  MultiSelect,
  ActionIcon,
  Stack,
  Loader,
  Center,
  Text,
  Badge,
  Paper,
  ScrollArea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { IconTrash, IconPlus, IconRefresh } from "@tabler/icons-react";
import { SQLPartMachineCapability } from "@/lib/types";

interface Props {
  connectionString: string;
  processFilter?: string | null;
}

export function PartMachineCapabilityManagement({ connectionString, processFilter }: Props) {
  const [capabilities, setCapabilities] = useState<SQLPartMachineCapability[]>([]);
  const [allParts, setAllParts] = useState<string[]>([]);
  const [allMachines, setAllMachines] = useState<string[]>([]);
  const [processHierarchy, setProcessHierarchy] = useState<{ [key: string]: string[] }>({});
  const [loading, setLoading] = useState(true);

  // Form State
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [selectedMachines, setSelectedMachines] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (!connectionString) return;
    fetchData();
  }, [connectionString, processFilter]);

  useEffect(() => {
    setSelectedPart(null);
  }, [processFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [caps, parts, meta] = await Promise.all([
        invoke<SQLPartMachineCapability[]>("get_part_machine_capabilities", { connectionString }),
        processFilter 
          ? invoke<string[]>("get_part_numbers_by_process", { connectionString, process: processFilter })
          : invoke<string[]>("get_all_part_numbers", { connectionString }),
        invoke<any>("get_scheduler_meta", { connectionString })
      ]);
      setCapabilities(caps);
      setAllParts(parts);
      
      const hierarchy = meta.ProcessHierarchy || {};
      setProcessHierarchy(hierarchy);

      const machinesSet = new Set<string>();
      Object.values(hierarchy).forEach((mList: any) => {
        mList.forEach((m: string) => machinesSet.add(m));
      });
      setAllMachines(Array.from(machinesSet).sort());
    } catch (e: any) {
      notifications.show({ title: 'Error fetching capabilities', message: e.toString(), color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!selectedPart || selectedMachines.length === 0) return;
    setIsAdding(true);
    try {
      for (const machine of selectedMachines) {
        const exists = capabilities.some(c => c.partId === selectedPart && c.machineId === machine);
        if (!exists) {
          await invoke("add_part_machine_capability", {
            connectionString,
            partNumber: selectedPart,
            machineId: machine
          });
        }
      }
      notifications.show({ title: 'Success', message: 'Routing assignments saved.', color: 'green' });
      setSelectedPart(null);
      setSelectedMachines([]);
      await fetchData();
    } catch (e: any) {
      notifications.show({ title: 'Error adding assignments', message: e.toString(), color: 'red' });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (part: string, machine: string) => {
    try {
      await invoke("delete_part_machine_capability", {
        connectionString,
        partNumber: part,
        machineId: machine
      });
      notifications.show({ title: 'Success', message: 'Routing removed.', color: 'green' });
      await fetchData();
    } catch (e: any) {
      notifications.show({ title: 'Error deleting assignment', message: e.toString(), color: 'red' });
    }
  };

  const filteredMachines = useMemo(() => {
    if (!processFilter || !processHierarchy[processFilter]) {
      return allMachines;
    }
    return processHierarchy[processFilter].sort();
  }, [allMachines, processFilter, processHierarchy]);

  const groupedCapabilities = useMemo(() => {
    const map = new Map<string, string[]>();
    
    // Create a reverse mapping for quick lookup: Machine -> Process
    const machineToProcess = new Map<string, string[]>();
    Object.entries(processHierarchy).forEach(([proc, machines]) => {
      machines.forEach(m => {
        if (!machineToProcess.has(m)) machineToProcess.set(m, []);
        machineToProcess.get(m)!.push(proc);
      });
    });

    capabilities.forEach(c => {
      // If we have a process filter, only include machines that belong to that process
      if (processFilter) {
        const belongsToProcess = machineToProcess.get(c.machineId)?.includes(processFilter);
        if (!belongsToProcess) return;
      }

      if (!map.has(c.partId)) map.set(c.partId, []);
      map.get(c.partId)!.push(c.machineId);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [capabilities, processFilter, processHierarchy]);

  if (loading) {
    return <Center h={200}><Loader size="md" color="indigo" /></Center>;
  }

  return (
    <Stack gap="md" mt="md">
      <Paper withBorder p="md" bg="gray.0">
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={700} size="sm">Add New Constraint</Text>
            <Button 
              variant="subtle" 
              size="xs" 
              leftSection={<IconRefresh size={14} />} 
              onClick={fetchData}
              loading={loading}
            >
              Refresh Data
            </Button>
          </Group>
          <Group align="flex-end">
            <Select
              label="Part Number"
              placeholder="Select or search part..."
              data={allParts}
              value={selectedPart}
              onChange={setSelectedPart}
              searchable
              clearable
              style={{ flex: 1 }}
            />
            <MultiSelect
              label="Allowed Machines"
              placeholder="Select valid equipment..."
              data={filteredMachines}
              value={selectedMachines}
              onChange={setSelectedMachines}
              searchable
              clearable
              hidePickedOptions
              style={{ flex: 2 }}
            />
            <Button 
              onClick={handleAdd} 
              loading={isAdding} 
              disabled={!selectedPart || selectedMachines.length === 0} 
              leftSection={<IconPlus size={14} />}
              color="indigo"
            >
              Add Routing
            </Button>
          </Group>
        </Stack>
      </Paper>

      <ScrollArea h={400} mt="md">
        <Table stickyHeader stickyHeaderOffset={0} striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={200}>Part Number</Table.Th>
              <Table.Th>Allowed Machines</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groupedCapabilities.map(([part, machines]) => (
              <Table.Tr key={part}>
                <Table.Td>
                  <Text fw={700} size="sm">{part}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {machines.sort().map(m => (
                       <Badge 
                         key={m} 
                         variant="light" 
                         color="indigo"
                         rightSection={
                           <ActionIcon 
                             size="xs" 
                             color="indigo" 
                             variant="transparent" 
                             onClick={() => handleDelete(part, m)}
                           >
                             <IconTrash size={10} />
                           </ActionIcon>
                         }
                       >
                         {m}
                       </Badge>
                    ))}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {groupedCapabilities.length === 0 && (
              <Table.Tr key="empty-state">
                <Table.Td colSpan={2}><Text ta="center" c="dimmed">No routing constraints defined.</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}
