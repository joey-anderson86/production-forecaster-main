"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Table,
  Tabs,
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
  Box,
  Divider,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import { 
  IconAlertCircle, 
  IconRefresh, 
  IconTimeline, 
  IconCalendarCheck,
  IconDatabaseExport,
  IconChevronRight,
  IconChevronDown,
  IconCalculator
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useProcessStore } from "@/lib/processStore";
import { useGlobalWeek } from "./WeekContext";
import { getCurrentWeekId, getWeekDates, formatISODate, DAYS_OF_WEEK, DayOfWeek } from "@/lib/dateUtils";
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
  const { processes, activeProcess, setActiveProcess } = useProcessStore();
  const { selectedWeekId } = useGlobalWeek();
  const [data, setData] = useState<UpstreamDemandRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionString, setConnectionString] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());

  // Initialize connection
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
      // Fetch for all processes so switching tabs is instant
      const result = await invoke<UpstreamDemandRow[]>("get_upstream_demand", {
        connectionString,
        processName: undefined, // Fetch all
      });
      setData(result);
    } catch (err) {
      console.error("Failed to fetch upstream demand:", err);
      setError(typeof err === "string" ? err : "Failed to fetch data");
    } finally {
      setIsLoading(false);
    }
  }, [connectionString]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sync active tab if null
  useEffect(() => {
    if (!activeProcess && processes.length > 0) {
      setActiveProcess(processes[0]);
    }
  }, [processes, activeProcess, setActiveProcess]);

  const handleGeneratePlan = async () => {
    if (!connectionString) return;
    setIsGenerating(true);
    try {
      const weekId = selectedWeekId || getCurrentWeekId();
      await invoke("generate_cascaded_demand_from_schedule", {
        connectionString: connectionString,
        weekId: weekId,
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

  const handleCommitPlan = async () => {
    if (!connectionString) return;
    setIsCommitting(true);
    try {
      const weekId = selectedWeekId || getCurrentWeekId();
      await invoke("commit_mrp_plan", {
        connectionString: connectionString,
        weekId: weekId,
      });
      notifications.show({
        title: "Success",
        message: `MRP plan committed for week ${weekId}`,
        color: "green",
      });
    } catch (err) {
      console.error("Failed to commit plan:", err);
      notifications.show({
        title: "Commit Failed",
        message: typeof err === "string" ? err : "Unknown error",
        color: "red",
      });
    } finally {
      setIsCommitting(false);
    }
  };

  // Get dates for the current week
  const weekDates = useMemo(() => {
    if (!selectedWeekId) return [];
    try {
      return getWeekDates(selectedWeekId);
    } catch {
      return [];
    }
  }, [selectedWeekId]);

  const dateMap = useMemo(() => {
    const map: Record<string, DayOfWeek> = {};
    weekDates.forEach((date, idx) => {
      if (date) {
        map[formatISODate(date)] = DAYS_OF_WEEK[idx];
      }
    });
    return map;
  }, [weekDates]);

  // Group data by Part -> Shift -> Day
  const transformedData = useMemo(() => {
    const filtered = data.filter(row => row.ProcessName === activeProcess);
    const groups: Record<string, Record<string, Record<DayOfWeek, number>>> = {};

    filtered.forEach(row => {
      const day = dateMap[row.TargetDate];
      if (!day) return; // Skip demand outside the selected week

      if (!groups[row.PartNumber]) groups[row.PartNumber] = {};
      if (!groups[row.PartNumber][row.TargetShift]) {
        groups[row.PartNumber][row.TargetShift] = {
          Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0
        };
      }
      groups[row.PartNumber][row.TargetShift][day] += row.RequiredQty;
    });

    return groups;
  }, [data, activeProcess, dateMap]);

  const toggleExpand = (part: string) => {
    setExpandedParts(prev => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  };

  const calculatePartTotal = (partData: Record<string, Record<DayOfWeek, number>>) => {
    let total = 0;
    Object.values(partData).forEach(shiftData => {
      Object.values(shiftData).forEach(qty => {
        total += qty;
      });
    });
    return total;
  };

  const calculateShiftTotal = (shiftData: Record<DayOfWeek, number>) => {
    return Object.values(shiftData).reduce((a, b) => a + b, 0);
  };

  const calculateDailyTotal = (day: DayOfWeek) => {
    let total = 0;
    Object.values(transformedData).forEach(partData => {
      Object.values(partData).forEach(shiftData => {
        total += shiftData[day];
      });
    });
    return total;
  };

  const grandTotal = useMemo(() => {
    return DAYS_OF_WEEK.reduce((sum, day) => sum + calculateDailyTotal(day), 0);
  }, [transformedData]);

  return (
    <Stack gap="md" className="w-full">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <IconTimeline size={20} color="var(--mantine-color-indigo-6)" />
          <Text size="sm" fw={600} c="indigo.7">MRP Shadow Plan Preview</Text>
          <Badge variant="dot" color={data.length > 0 ? "teal" : "gray"}>
            {data.length} Requirements
          </Badge>
        </Group>
        <Group>
          <Button 
            variant="light" 
            color="indigo" 
            size="xs"
            onClick={handleGeneratePlan} 
            loading={isGenerating}
            leftSection={<IconRefresh size={14} />}
          >
            Regenerate MRP Plan
          </Button>
          <Button 
            variant="filled" 
            color="indigo" 
            size="xs"
            onClick={handleCommitPlan} 
            loading={isCommitting}
            leftSection={<IconDatabaseExport size={14} />}
          >
            Commit MRP Plan
          </Button>
        </Group>
      </Group>

      <Box bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))" p="sm" style={{ borderRadius: 'var(--mantine-radius-md)' }}>
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Tabs value={activeProcess} onChange={setActiveProcess} variant="pills">
              <Tabs.List>
                {processes.map(name => (
                  <Tabs.Tab key={name} value={name} color="indigo">
                    {name}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
            
            <Group gap="xs">
              <Text size="xs" c="dimmed" fw={500}>Displaying Week:</Text>
              <Badge variant="light" color="indigo" radius="sm">
                {selectedWeekId || "None Selected"}
              </Badge>
            </Group>
          </Group>

          {error && (
            <Alert color="red" title="Data Load Error" icon={<IconAlertCircle size={16} />}>
              {error}
            </Alert>
          )}

          <Box style={{ border: `1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))`, borderRadius: '8px', overflow: 'hidden', backgroundColor: 'white' }}>
            <ScrollArea h={500} offsetScrollbars>
              {isLoading ? (
                <Center h={300}>
                  <Stack align="center" gap="xs">
                    <Loader size="md" color="indigo" />
                    <Text size="sm" c="dimmed">Loading Shadow Plan...</Text>
                  </Stack>
                </Center>
              ) : (
                <Table 
                  verticalSpacing="xs" 
                  highlightOnHover 
                  withTableBorder
                  styles={{
                    thead: {
                      backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))',
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                    },
                    tfoot: {
                      backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))',
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 10,
                    }
                  }}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 220 }}><Text size="xs" fw={700} c="dimmed">PART NUMBER</Text></Table.Th>
                      <Table.Th style={{ width: 100 }} ta="center"><Text size="xs" fw={700} c="dimmed">SHIFT</Text></Table.Th>
                      {DAYS_OF_WEEK.map((day, idx) => (
                        <Table.Th key={day} ta="center" style={{ width: 85, borderLeft: `1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-5))` }}>
                          <Stack gap={0} align="center">
                            <Text size="xs" fw={700} c="dimmed">{day.toUpperCase()}</Text>
                            {weekDates[idx] && <Text size="10px" c="indigo.4" fw={700}>{weekDates[idx].toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</Text>}
                          </Stack>
                        </Table.Th>
                      ))}
                      <Table.Th ta="center" style={{ width: 90, backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))' }}>
                        <Group gap={4} justify="center">
                          <IconCalculator size={14} />
                          <Text size="xs" fw={700}>TOTAL</Text>
                        </Group>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>

                  <Table.Tbody>
                    {Object.keys(transformedData).length > 0 ? (
                      Object.entries(transformedData).map(([part, shifts]) => (
                        <React.Fragment key={part}>
                          {/* Parent Row */}
                          <Table.Tr 
                            style={{ cursor: 'pointer' }} 
                            onClick={() => toggleExpand(part)}
                            bg={expandedParts.has(part) ? "indigo.0" : "transparent"}
                          >
                            <Table.Td>
                              <Group gap="xs" wrap="nowrap">
                                <ActionIcon variant="subtle" size="sm" color="indigo">
                                  {expandedParts.has(part) ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                                </ActionIcon>
                                <Text fw={700} size="sm" c="indigo.9">{part}</Text>
                              </Group>
                            </Table.Td>
                            <Table.Td ta="center">
                              <Badge variant="light" color="indigo" size="xs">ALL SHIFTS</Badge>
                            </Table.Td>
                            {DAYS_OF_WEEK.map(day => {
                              const dailyTotal = Object.values(shifts).reduce((sum, s) => sum + s[day], 0);
                              return (
                                <Table.Td key={day} ta="center" style={{ borderLeft: `1px solid light-dark(var(--mantine-color-indigo-0), var(--mantine-color-dark-5))` }}>
                                  <Text fw={700} size="xs" c={dailyTotal > 0 ? "indigo.7" : "dimmed"}>
                                    {dailyTotal > 0 ? dailyTotal.toLocaleString() : "—"}
                                  </Text>
                                </Table.Td>
                              );
                            })}
                            <Table.Td ta="center" bg="indigo.1">
                              <Text fw={800} size="sm" c="indigo.9">
                                {calculatePartTotal(shifts).toLocaleString()}
                              </Text>
                            </Table.Td>
                          </Table.Tr>

                          {/* Child Rows (Shifts) */}
                          {expandedParts.has(part) && Object.entries(shifts)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([shift, dayData]) => (
                              <Table.Tr key={`${part}-${shift}`}>
                                <Table.Td pl={45}>
                                  <Text size="xs" fw={500} c="dimmed">{part}</Text>
                                </Table.Td>
                                <Table.Td ta="center">
                                  <Badge 
                                    variant="outline" 
                                    size="xs" 
                                    color={shift === "A" || shift === "C" ? "orange" : "grape"}
                                  >
                                    Shift {shift}
                                  </Badge>
                                </Table.Td>
                                {DAYS_OF_WEEK.map(day => (
                                  <Table.Td key={day} ta="center" style={{ borderLeft: `1px solid light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-5))` }}>
                                    <Text size="xs" fw={500} c={dayData[day] > 0 ? "dark" : "dimmed"}>
                                      {dayData[day] > 0 ? dayData[day].toLocaleString() : "—"}
                                    </Text>
                                  </Table.Td>
                                ))}
                                <Table.Td ta="center" bg="gray.0">
                                  <Text fw={600} size="xs" c="indigo.7">
                                    {calculateShiftTotal(dayData).toLocaleString()}
                                  </Text>
                                </Table.Td>
                              </Table.Tr>
                            ))
                          }
                        </React.Fragment>
                      ))
                    ) : (
                      <Table.Tr>
                        <Table.Td colSpan={10} py={60}>
                          <Center>
                            <Stack align="center" gap="xs">
                              <IconCalendarCheck size={40} color="var(--mantine-color-gray-4)" />
                              <Text c="dimmed" size="sm">No demand requirements found for this week.</Text>
                              <Button variant="subtle" size="xs" onClick={handleGeneratePlan}>Generate Now</Button>
                            </Stack>
                          </Center>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Table.Tbody>

                  <Table.Tfoot>
                    <Table.Tr fw={700}>
                      <Table.Td colSpan={2}>
                        <Text size="xs" fw={800}>GRAND TOTAL (Required Qty)</Text>
                      </Table.Td>
                      {DAYS_OF_WEEK.map(day => (
                        <Table.Td key={day} ta="center" style={{ borderLeft: `1px solid light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))` }}>
                          <Text fw={800} size="xs" c="indigo.9">
                            {calculateDailyTotal(day).toLocaleString()}
                          </Text>
                        </Table.Td>
                      ))}
                      <Table.Td ta="center" bg="indigo.1">
                        <Text fw={900} size="sm" c="indigo.9">
                          {grandTotal.toLocaleString()}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              )}
            </ScrollArea>
          </Box>
        </Stack>
      </Box>
    </Stack>
  );
}
