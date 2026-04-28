"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Table,
  Select,
  Card,
  Group,
  Title,
  Text,
  Stack,
  Loader,
  Alert,
  Center,
  ScrollArea,
  Button,
  Badge,
} from "@mantine/core";
import { IconAlertCircle, IconRefresh, IconTimeline } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useProcessStore } from "@/lib/processStore";
import { getCurrentWeekId } from "@/lib/dateUtils";
import { notifications } from "@mantine/notifications";

interface UpstreamDemandRow {
  DemandID: number;
  PartNumber: string;
  ProcessName: string;
  TargetDate: string;
  TargetShift: string;
  RequiredQty: number;
}

export function CascadedPlanPreview() {
  const processes = useProcessStore((state) => state.processes);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [data, setData] = useState<UpstreamDemandRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionString, setConnectionString] = useState("");

  useEffect(() => {
    async function init() {
      try {
        const store = await load("store.json", { autoSave: false, defaults: {} });
        const val = await store.get<string>("db_connection_string");
        if (val) {
          setConnectionString(val);
        }
      } catch (err) {
        console.error("Failed to load store:", err);
      }
    }
    init();
  }, []);

  const fetchData = useCallback(async () => {
    if (!connectionString) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<UpstreamDemandRow[]>("get_upstream_demand", {
        connectionString,
        processName: selectedProcess || undefined,
      });
      setData(result);
    } catch (err) {
      console.error("Failed to fetch upstream demand:", err);
      setError(typeof err === "string" ? err : "Failed to fetch data");
    } finally {
      setIsLoading(false);
    }
  }, [connectionString, selectedProcess]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGeneratePlan = async () => {
    if (!connectionString) return;
    setIsGenerating(true);
    try {
      const weekId = getCurrentWeekId();
      await invoke("generate_cascaded_demand", {
        connection_string: connectionString,
        week_id: weekId,
      });
      notifications.show({
        title: "Success",
        message: `Cascaded demand generated for week ${weekId}`,
        color: "green",
      });
      fetchData();
    } catch (err) {
      console.error("Failed to generate plan:", err);
      notifications.show({
        title: "Generation Failed",
        message: typeof err === "string" ? err : "Unknown error",
        color: "red",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Stack gap="md">
      <Card withBorder shadow="sm" radius="md" p="lg">
        <Stack gap="md">
          <Group justify="space-between">
            <Group gap="xs">
              <IconTimeline size={24} color="var(--mantine-color-indigo-6)" />
              <Stack gap={0}>
                <Title order={3}>MRP Shadow Plan Preview</Title>
                <Text size="xs" c="dimmed">Backward-scheduled dependent demand based on Lead Time Offsetting</Text>
              </Stack>
            </Group>
            <Group>
              <Button 
                variant="light" 
                color="indigo" 
                onClick={handleGeneratePlan} 
                loading={isGenerating}
                leftSection={<IconRefresh size={16} />}
              >
                Regenerate MRP Plan
              </Button>
            </Group>
          </Group>

          <Group grow>
            <Select
              label="Filter by Process Area"
              placeholder="All Processes"
              data={processes}
              value={selectedProcess}
              onChange={setSelectedProcess}
              clearable
              searchable
            />
          </Group>

          {error && (
            <Alert color="red" title="Error" icon={<IconAlertCircle size={16} />}>
              {error}
            </Alert>
          )}

          <ScrollArea h={500} mt="md" offsetScrollbars>
            {isLoading ? (
              <Center h={200}>
                <Loader size="md" />
              </Center>
            ) : (
              <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Part Number</Table.Th>
                    <Table.Th>Process Area</Table.Th>
                    <Table.Th>Target Date</Table.Th>
                    <Table.Th>Shift</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Required Qty</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.length > 0 ? (
                    data.map((row) => (
                      <Table.Tr key={row.DemandID}>
                        <Table.Td fw={700}>{row.PartNumber}</Table.Td>
                        <Table.Td>
                          <Badge variant="dot" color="indigo">{row.ProcessName}</Badge>
                        </Table.Td>
                        <Table.Td>{row.TargetDate}</Table.Td>
                        <Table.Td>
                          <Badge variant="outline" color={row.TargetShift === "A" || row.TargetShift === "C" ? "orange" : "grape"}>
                            Shift {row.TargetShift}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          <Text fw={700}>{row.RequiredQty.toLocaleString()}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))
                  ) : (
                    <Table.Tr>
                      <Table.Td colSpan={5}>
                        <Center h={100}>
                          <Text c="dimmed">No demand data found. Try generating the plan.</Text>
                        </Center>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            )}
          </ScrollArea>
        </Stack>
      </Card>
    </Stack>
  );
}
