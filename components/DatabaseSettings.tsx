"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  TextInput,
  Select,
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
  Grid,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import Papa from "papaparse";
import dayjs from "dayjs";
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
  IconDownload,
  IconCalendar,
  IconInfoCircle,
} from "@tabler/icons-react";
import { getCurrentWeekId, parseISOLocal } from "@/lib/dateUtils";
import { useProcessStore } from "@/lib/processStore";
import { useScorecardStore } from "@/lib/scorecardStore";



interface LocatorMapping {
  WIPLocator?: string;
  ProcessName?: string;
  DaysFromShipment?: number;
}

interface PartInfo {
  PartNumber?: string;
  ProcessName?: string;
  BatchSize?: number;
  ProcessingTime?: number;
}

interface ProcessInfo {
  ProcessName?: string;
  Date?: string;
  HoursAvailable?: number;
  MachineID?: string;
  Shift?: string;
}

interface DailyRate {
  PartNumber?: string;
  Week?: number;
  Year?: number;
  Qty?: number;
}

interface Process {
  ProcessName: string;
  MachineID?: string;
}

interface ReasonCodeData {
  ProcessName?: string;
  ReasonCode?: string;
}

export function DatabaseSettings({ roleMode }: { roleMode?: 'supervisor' | 'planner' }) {
  const fetchGlobalProcesses = useProcessStore((state) => state.fetchProcesses);
  const globalProcesses = useProcessStore((state) => state.processes);
  const shiftSettings = useScorecardStore((state) => state.shiftSettings);
  const updateShiftSettings = useScorecardStore((state) => state.updateShiftSettings);
  const [connectionString, setConnectionString] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Preview States
  const [activeTab, setActiveTab] = useState<string | null>("process");
  const [locatorMappings, setLocatorMappings] = useState<LocatorMapping[]>([]);
  const [partInfos, setPartInfos] = useState<PartInfo[]>([]);
  const [processInfos, setProcessInfos] = useState<ProcessInfo[]>([]);
  const [dailyRates, setDailyRates] = useState<DailyRate[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCodeData[]>([]);
  const [allPartNumbers, setAllPartNumbers] = useState<string[]>([]);
  
  // Initial states for comparison
  const [initialLocatorMappings, setInitialLocatorMappings] = useState<string>("");
  const [initialPartInfos, setInitialPartInfos] = useState<string>("");
  const [initialProcessInfos, setInitialProcessInfos] = useState<string>("");
  const [initialDailyRates, setInitialDailyRates] = useState<string>("");
  const [initialProcesses, setInitialProcesses] = useState<string>("");
  const [initialReasonCodes, setInitialReasonCodes] = useState<string>("");

  // Deletion tracking
  const [deletedLocators, setDeletedLocators] = useState<string[]>([]);
  const [deletedPartInfos, setDeletedPartInfos] = useState<{PartNumber: string, ProcessName: string}[]>([]);
  const [deletedProcessInfos, setDeletedProcessInfos] = useState<{ProcessName: string, Date: string, MachineID: string, Shift: string}[]>([]);
  const [deletedDailyRates, setDeletedDailyRates] = useState<DailyRate[]>([]);
  const [deletedProcesses, setDeletedProcesses] = useState<Process[]>([]);
  const [deletedReasonCodes, setDeletedReasonCodes] = useState<ReasonCodeData[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSavingData, setIsSavingData] = useState(false);
  const [isSyncingLocators, setIsSyncingLocators] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Detection of changes
  const hasChanges = useMemo(() => {
    const isDeepEqual = (a: any, b: string) => {
      try {
        const aStr = JSON.stringify(a);
        const bParsed = JSON.parse(b);
        const bStr = JSON.stringify(bParsed);
        return aStr === bStr;
      } catch {
        return false;
      }
    };

    let tableDirty = false;
    if (activeTab === "locatorMapping") {
      tableDirty = !isDeepEqual(locatorMappings, initialLocatorMappings);
    } else if (activeTab === "partInfo") {
      tableDirty = !isDeepEqual(partInfos, initialPartInfos);
    } else if (activeTab === "processInfo") {
      tableDirty = !isDeepEqual(processInfos, initialProcessInfos);
    } else if (activeTab === "dailyRate") {
      tableDirty = !isDeepEqual(dailyRates, initialDailyRates);
    } else if (activeTab === "process") {
      tableDirty = !isDeepEqual(processes, initialProcesses);
    } else if (activeTab === "reasonCode") {
      tableDirty = !isDeepEqual(reasonCodes, initialReasonCodes);
    }

    const deletionDirty = activeTab === "locatorMapping" 
      ? deletedLocators.length > 0 
      : activeTab === "partInfo" 
      ? deletedPartInfos.length > 0
      : activeTab === "processInfo"
      ? deletedProcessInfos.length > 0
      : activeTab === "dailyRate"
      ? deletedDailyRates.length > 0
      : activeTab === "process"
      ? deletedProcesses.length > 0
      : activeTab === "reasonCode"
      ? deletedReasonCodes.length > 0
      : false;

    return tableDirty || deletionDirty;
  }, [activeTab, locatorMappings, partInfos, processInfos, dailyRates, processes, reasonCodes, initialLocatorMappings, initialPartInfos, initialProcessInfos, initialDailyRates, initialProcesses, initialReasonCodes, deletedLocators, deletedPartInfos, deletedProcessInfos, deletedDailyRates, deletedProcesses, deletedReasonCodes]);

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

  const fetchData = useCallback(async (tab: string | null, connStr?: string) => {
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
      } else if (tab === "dailyRate") {
        const data = await invoke<DailyRate[]>("get_daily_rate_preview", { connectionString: activeConnStr });
        setDailyRates(data);
        setInitialDailyRates(JSON.stringify(data));
        setDeletedDailyRates([]);

        // Fetch part numbers for dropdown validation
        const parts = await invoke<string[]>("get_all_part_numbers", { connectionString: activeConnStr });
        setAllPartNumbers(parts);
      } else if (tab === "process") {
        const data = await invoke<Process[]>("get_processes_preview", { connectionString: activeConnStr });
        setProcesses(data);
        setInitialProcesses(JSON.stringify(data));
        setDeletedProcesses([]);
      } else if (tab === "reasonCode") {
        const data = await invoke<ReasonCodeData[]>("get_reason_codes_preview", { connectionString: activeConnStr });
        setReasonCodes(data);
        setInitialReasonCodes(JSON.stringify(data));
        setDeletedReasonCodes([]);
      }
    } catch (err) {
      console.error(`Failed to fetch ${tab} data:`, err);
      setFetchError(typeof err === "string" ? err : "Failed to fetch data from database.");
    } finally {
      setIsLoadingData(false);
    }
  }, [connectionString]);

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
          const identifiers = deletedPartInfos.map(p => ({ PartNumber: p.PartNumber, ProcessName: p.ProcessName }));
          await invoke("delete_part_infos", { connectionString, identifiers });
        }
        // Handle upserts
        await invoke("upsert_part_info", { connectionString, records: partInfos });
      } else if (activeTab === "processInfo") {
        // Handle deletions
        if (deletedProcessInfos.length > 0) {
          const identifiers = deletedProcessInfos.map(p => ({ process: p.ProcessName, date: p.Date, machine_id: p.MachineID, shift: p.Shift }));
          await invoke("delete_process_infos", { connectionString, identifiers });
        }
        // Handle upserts
        await invoke("upsert_process_info", { connectionString, records: processInfos });
      } else if (activeTab === "dailyRate") {
        // Handle deletions
        if (deletedDailyRates.length > 0) {
          const identifiers = deletedDailyRates.map(r => ({ 
            PartNumber: String(r.PartNumber || "").trim(), 
            Week: Number(r.Week || 0), 
            Year: Number(r.Year || 0), 
            Qty: Number(r.Qty || 0)
          }));
          await invoke("delete_daily_rates", { connectionString, records: identifiers });
        }
        // Handle upserts
        const upsertRecords = dailyRates.map(r => ({
          PartNumber: String(r.PartNumber || "").trim(),
          Week: Number(r.Week || 0),
          Year: Number(r.Year || 0),
          Qty: Number(r.Qty || 0)
        }));
        await invoke("upsert_daily_rate", { connectionString, records: upsertRecords });
      } else if (activeTab === "process") {
         // Handle deletions
         if (deletedProcesses.length > 0) {
           await invoke("delete_processes", { connectionString, records: deletedProcesses });
         }
         // Handle upserts
          await invoke("upsert_process", { connectionString, records: processes });
          
          // Refresh global process store
          await fetchGlobalProcesses(connectionString);
      } else if (activeTab === "reasonCode") {
         if (deletedReasonCodes.length > 0) {
           const cleanDeleted = deletedReasonCodes.map(r => ({ ProcessName: r.ProcessName || "", ReasonCode: r.ReasonCode || "" }));
           await invoke("delete_reason_codes", { connectionString, records: cleanDeleted });
         }
         const cleanRecords = reasonCodes.map(r => ({ ProcessName: r.ProcessName || "", ReasonCode: r.ReasonCode || "" }));
         await invoke("upsert_reason_codes", { connectionString, records: cleanRecords });
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
      setLocatorMappings(prev => [...prev, { WIPLocator: "", ProcessName: "", DaysFromShipment: 0 }]);
    } else if (activeTab === "partInfo") {
      setPartInfos(prev => [...prev, { PartNumber: "", ProcessName: "", BatchSize: 0, ProcessingTime: 0 }]);
    } else if (activeTab === "processInfo") {
      const today = new Date().toISOString().split('T')[0];
      setProcessInfos(prev => [...prev, { ProcessName: "", Date: today, HoursAvailable: 8, MachineID: "", Shift: "A" }]);
    } else if (activeTab === "dailyRate") {
      const currentWeekId = getCurrentWeekId();
      const [currYear, currWeekStr] = currentWeekId.split("-w");
      setDailyRates(prev => [...prev, { 
        PartNumber: "", 
        Week: parseInt(currWeekStr), 
        Year: parseInt(currYear), 
        Qty: 0 
      }]);
    } else if (activeTab === "process") {
      setProcesses(prev => [...prev, { ProcessName: "", MachineID: "" }]);
    } else if (activeTab === "reasonCode") {
      setReasonCodes(prev => [...prev, { ProcessName: "", ReasonCode: "" }]);
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
    } else if (activeTab === "dailyRate") {
      const next = [...dailyRates];
      next[index] = { ...next[index], [field]: value };
      setDailyRates(next);
    } else if (activeTab === "process") {
      const next = [...processes];
      next[index] = { ...next[index], [field]: value };
      setProcesses(next);
    } else if (activeTab === "reasonCode") {
      const next = [...reasonCodes];
      next[index] = { ...next[index], [field]: value };
      setReasonCodes(next);
    }
  };

  const normalize = (v: any) => v === null || v === undefined ? "" : v;

  const removeLocalRecord = (index: number) => {
    if (activeTab === "locatorMapping") {
      const record = locatorMappings[index];
      const initial = JSON.parse(initialLocatorMappings) as LocatorMapping[];
      const wasInDb = initial.some(r => normalize(r.WIPLocator) === normalize(record.WIPLocator));
      
      if (wasInDb && record.WIPLocator) {
        setDeletedLocators(prev => [...prev, record.WIPLocator!]);
      }
      setLocatorMappings(prev => prev.filter((_, i) => i !== index));
    } else if (activeTab === "partInfo") {
      const record = partInfos[index];
      const initial = JSON.parse(initialPartInfos) as PartInfo[];
      const wasInDb = initial.some(r => 
        normalize(r.PartNumber) === normalize(record.PartNumber) && 
        normalize(r.ProcessName) === normalize(record.ProcessName)
      );
      
      if (wasInDb && record.PartNumber && record.ProcessName) {
        setDeletedPartInfos(prev => [...prev, { PartNumber: record.PartNumber!, ProcessName: record.ProcessName! }]);
      }
      setPartInfos(prev => prev.filter((_, i) => i !== index));
    } else if (activeTab === "processInfo") {
      const record = processInfos[index];
      const initial = JSON.parse(initialProcessInfos) as ProcessInfo[];
      const wasInDb = initial.some(r => 
        normalize(r.ProcessName) === normalize(record.ProcessName) && 
        normalize(r.Date) === normalize(record.Date) && 
        normalize(r.MachineID) === normalize(record.MachineID) &&
        normalize(r.Shift) === normalize(record.Shift)
      );
      
      if (wasInDb && (record.ProcessName || record.Date)) {
        setDeletedProcessInfos(prev => [...prev, { 
          ProcessName: record.ProcessName || null as any, 
          Date: record.Date || null as any, 
          MachineID: record.MachineID || null as any,
          Shift: record.Shift || null as any
        }]);
      }
      setProcessInfos(prev => prev.filter((_, i) => i !== index));
    } else if (activeTab === "dailyRate") {
      const record = dailyRates[index];
      const initial = JSON.parse(initialDailyRates) as DailyRate[];
      const wasInDb = initial.some(r => 
        normalize(r.PartNumber) === normalize(record.PartNumber) &&
        normalize(r.Week) === normalize(record.Week) &&
        normalize(r.Year) === normalize(record.Year)
      );
      
      if (wasInDb) {
        setDeletedDailyRates(prev => [...prev, record]);
      }
      setDailyRates(prev => prev.filter((_, i) => i !== index));
    } else if (activeTab === "process") {
      const record = processes[index];
      const initial = JSON.parse(initialProcesses) as Process[];
      const wasInDb = initial.some(r => 
        normalize(r.ProcessName) === normalize(record.ProcessName) &&
        normalize(r.MachineID) === normalize(record.MachineID)
      );
      
      if (wasInDb && record.ProcessName) {
        setDeletedProcesses(prev => [...prev, { 
          ProcessName: record.ProcessName, 
          MachineID: record.MachineID || "" 
        }]);
      }
      setProcesses(prev => prev.filter((_, i) => i !== index));
    } else if (activeTab === "reasonCode") {
      const record = reasonCodes[index];
      const initial = JSON.parse(initialReasonCodes) as ReasonCodeData[];
      const wasInDb = initial.some(r => 
        normalize(r.ProcessName) === normalize(record.ProcessName) &&
        normalize(r.ReasonCode) === normalize(record.ReasonCode)
      );
      if (wasInDb) {
        setDeletedReasonCodes(prev => [...prev, record]);
      }
      setReasonCodes(prev => prev.filter((_, i) => i !== index));
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
              WIPLocator: r.WIPLocator || r.wipLocator || "",
              ProcessName: r.Process || r.process || r.ProcessName || "",
              DaysFromShipment: parseInt(r.DaysFromShipment || r.daysFromShipment || "0")
            }));
            await invoke("replace_locator_mappings", { connectionString, records: mapped });
          } else if (activeTab === "partInfo") {
            const mapped = rawData.map(r => ({
              PartNumber: r.PartNumber || r.partNumber || "",
              ProcessName: r.Process || r.process || r.ProcessName || "",
              BatchSize: parseInt(r.BatchSize || r.batchSize || "0"),
              ProcessingTime: parseInt(r.ProcessingTime || r.processingTime || "0")
            }));
            await invoke("replace_part_infos", { connectionString, records: mapped });
          } else if (activeTab === "processInfo") {
            const mapped = rawData.map(r => ({
              ProcessName: r.Process || r.process || r.ProcessName || "",
              Date: r.Date || r.date || "",
              HoursAvailable: parseInt(r.HoursAvailable || r.hoursAvailable || "0"),
              MachineID: r.MachineID || r.MachineId || r.machineId || "",
              Shift: r.Shift || r.shift || ""
            }));
            await invoke("replace_process_infos", { connectionString, records: mapped });
          } else if (activeTab === "dailyRate") {
            const now = new Date();
            const currentWeekId = getCurrentWeekId();
            const [currYear, currWeekStr] = currentWeekId.split("-w");
            const defaultYear = parseInt(currYear);
            const defaultWeek = parseInt(currWeekStr);

            const mapped = rawData.map(r => {
              const find = (options: string[]) => {
                const key = Object.keys(r).find(k => 
                  options.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ''))
                );
                return key ? r[key] : undefined;
              };

              return {
                PartNumber: String(find(['partnumber', 'part', 'pn']) || ""),
                Week: parseInt(String(find(['week', 'wk']) || defaultWeek)),
                Year: parseInt(String(find(['year', 'yr']) || defaultYear)),
                Qty: parseInt(String(find(['qty', 'quantity', 'rate', 'dailyrate']) || "0"))
              };
            });
            await invoke("replace_daily_rates", { connectionString, records: mapped });
          } else if (activeTab === "process") {
            const mapped = rawData.map(r => ({
              ProcessName: r.ProcessName || r.processName || r.Process || r.process || "",
              MachineID: r.MachineID || r.MachineId || r.machineId || ""
            }));
            await invoke("replace_processes", { connectionString, records: mapped });
            await fetchGlobalProcesses(connectionString);
          } else if (activeTab === "reasonCode") {
            const mapped = rawData.map(r => ({
              ProcessName: r.Process || r.process || r.ProcessName || "",
              ReasonCode: r.ReasonCode || r.reasonCode || r.Reason || r.reason || ""
            }));
            await invoke("replace_reason_codes", { connectionString, records: mapped });
          } else if (activeTab === "deliveryData") {
            const mapped = rawData.map(r => ({
              Department: r.Department || r.department || "",
              WeekIdentifier: r.WeekIdentifier || r.weekIdentifier || "",
              PartNumber: r.PartNumber || r.partNumber || "",
              DayOfWeek: r.DayOfWeek || r.dayOfWeek || "",
              Target: r.Target !== undefined && r.Target !== "" ? parseInt(r.Target) : null,
              Actual: r.Actual !== undefined && r.Actual !== "" ? parseInt(r.Actual) : null,
              Date: r.Date || r.date || null,
              Shift: r.Shift || r.shift || null,
              ReasonCode: r.ReasonCode || r.reasonCode || null
            }));
            await invoke("replace_delivery_data", { connectionString, records: mapped });
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
      headers = "Process,Date,Shift,HoursAvailable,MachineID";
      fileName = "process_information_template.csv";
    } else if (activeTab === "dailyRate") {
      headers = "PartNumber,Week,Year,Qty";
      fileName = "daily_rate_template.csv";
    } else if (activeTab === "process") {
      headers = "ProcessName,MachineID";
      fileName = "manufacturing_processes_template.csv";
    } else if (activeTab === "reasonCode") {
      headers = "Process,ReasonCode";
      fileName = "reason_codes_template.csv";
    } else if (activeTab === "deliveryData") {
      headers = "Department,WeekIdentifier,PartNumber,DayOfWeek,Target,Actual,Date,Shift,ReasonCode";
      fileName = "delivery_data_backup.csv";
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

  const parseOrNull = (isoStr: string | undefined): Date | null => {
    if (!isoStr) return null;
    const d = parseISOLocal(isoStr);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatIso = (date: Date | null | undefined): string => {
    if (!date) return "";
    return dayjs(date).format("YYYY-MM-DD");
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
                      value={row.WIPLocator || ""} 
                      onChange={(e) => updateRecord(i, "WIPLocator", e.currentTarget.value)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      variant="unstyled"
                      size="xs"
                      data={globalProcesses}
                      value={row.Process || ""}
                      onChange={(val) => updateRecord(i, "Process", val || "")}
                      searchable
                      clearable
                      placeholder="Select process"
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.DaysFromShipment} 
                      onChange={(val) => updateRecord(i, "DaysFromShipment", val)} 
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
          <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Part Number</Table.Th>
                <Table.Th>Process</Table.Th>
                <Table.Th>Batch Size</Table.Th>
                <Table.Th>Processing Time (m)</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {partInfos.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <TextInput 
                      variant="unstyled" 
                      size="xs" 
                      p={0} 
                      value={row.PartNumber || ""} 
                      onChange={(e) => updateRecord(i, "PartNumber", e.currentTarget.value)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      variant="unstyled"
                      size="xs"
                      data={globalProcesses}
                      value={row.ProcessName || ""}
                      onChange={(val) => updateRecord(i, "ProcessName", val || "")}
                      searchable
                      clearable
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.BatchSize} 
                      onChange={(val) => updateRecord(i, "BatchSize", val)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.ProcessingTime} 
                      onChange={(val) => updateRecord(i, "ProcessingTime", val)} 
                    />
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
                <Table.Th>Machine ID</Table.Th>
                <Table.Th>Shift</Table.Th>
                <Table.Th>Hours Available</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {processInfos.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Select
                      variant="unstyled"
                      size="xs"
                      data={globalProcesses}
                      value={row.ProcessName || ""}
                      onChange={(val) => updateRecord(i, "ProcessName", val || "")}
                      searchable
                      clearable
                    />
                  </Table.Td>
                  <Table.Td>
                    <DatePickerInput
                      variant="unstyled"
                      size="xs"
                      value={parseOrNull(row.Date)}
                      onChange={(val) => updateRecord(i, "Date", formatIso(val))}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput 
                      variant="unstyled" 
                      size="xs" 
                      p={0} 
                      value={row.MachineID || ""} 
                      onChange={(e) => updateRecord(i, "MachineID", e.currentTarget.value)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      variant="unstyled"
                      size="xs"
                      data={['A', 'B', 'C', 'D']}
                      value={row.Shift || ""}
                      onChange={(val) => updateRecord(i, "Shift", val || "A")}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.HoursAvailable} 
                      onChange={(val) => updateRecord(i, "HoursAvailable", val)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" onClick={() => removeLocalRecord(i)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {processInfos.length === 0 && (
                <Table.Tr><Table.Td colSpan={6}><Text ta="center" c="dimmed">No records found</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      );
    }

    if (activeTab === "dailyRate") {
      return (
        <ScrollArea h={400} mt="md">
          <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Part Number</Table.Th>
                <Table.Th>Week</Table.Th>
                <Table.Th>Year</Table.Th>
                <Table.Th>Daily Rate (Qty)</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {dailyRates.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Select
                      variant="unstyled"
                      size="xs"
                      data={allPartNumbers}
                      value={row.PartNumber || ""}
                      onChange={(val) => updateRecord(i, "PartNumber", val || "")}
                      searchable
                      clearable
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.Week} 
                      onChange={(val) => updateRecord(i, "Week", val)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.Year} 
                      onChange={(val) => updateRecord(i, "Year", val)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput 
                      variant="unstyled" 
                      size="xs" 
                      value={row.Qty} 
                      onChange={(val) => updateRecord(i, "Qty", val)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" onClick={() => removeLocalRecord(i)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {dailyRates.length === 0 && (
                <Table.Tr><Table.Td colSpan={5}><Text ta="center" c="dimmed">No records found</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      );
    }

    if (activeTab === "process") {
      return (
        <ScrollArea h={400} mt="md">
          <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Process Name</Table.Th>
                <Table.Th>Machine ID</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {processes.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <TextInput 
                      variant="unstyled" 
                      size="xs" 
                      p={0} 
                      value={row.ProcessName || ""} 
                      onChange={(e) => updateRecord(i, "ProcessName", e.currentTarget.value)} 
                      placeholder="e.g. Plating, Shipping..."
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput 
                      variant="unstyled" 
                      size="xs" 
                      p={0} 
                      value={row.MachineID || ""} 
                      onChange={(e) => updateRecord(i, "MachineID", e.currentTarget.value)} 
                      placeholder="e.g. MC-01"
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" onClick={() => removeLocalRecord(i)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {processes.length === 0 && (
                <Table.Tr><Table.Td colSpan={3}><Text ta="center" c="dimmed">No records found</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      );
    }

    if (activeTab === "reasonCode") {
      return (
        <ScrollArea h={400} mt="md">
          <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Process</Table.Th>
                <Table.Th>Reason Code</Table.Th>
                <Table.Th w={50}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {reasonCodes.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Select
                      variant="unstyled"
                      size="xs"
                      data={globalProcesses}
                      value={row.ProcessName || ""}
                      onChange={(val) => updateRecord(i, "ProcessName", val || "")}
                      searchable
                      clearable
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput 
                      variant="unstyled" 
                      size="xs" 
                      p={0} 
                      value={row.ReasonCode || ""} 
                      onChange={(e) => updateRecord(i, "ReasonCode", e.currentTarget.value)} 
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" onClick={() => removeLocalRecord(i)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
              {reasonCodes.length === 0 && (
                <Table.Tr><Table.Td colSpan={3}><Text ta="center" c="dimmed">No records found</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      );
    } else if (activeTab === "deliveryData") {
      return (
        <Center h={400} mt="md">
          <Stack align="center" gap="md">
            <IconDatabase size={48} color="var(--mantine-color-indigo-4)" />
            <Text fw={700} size="lg">Delivery Data Bulk Upload</Text>
            <Text c="dimmed" size="sm" ta="center" maw={400}>
              Due to the large volume of delivery data, this tab is reserved strictly for uploading bulk CSV backups. 
              To view or modify specific records, please use the Production Planner.
            </Text>
          </Stack>
        </Center>
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

      {/* Work Shift Schedule Section */}
      <Card shadow="sm" p="lg" radius="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Stack gap={4}>
              <Group gap="xs">
                <IconCalendar size={22} color="var(--mantine-color-indigo-6)" />
                <Title order={4}>Work Shift Schedule (Panama 2-2-3)</Title>
              </Group>
              <Text size="sm" c="dimmed">
                Configure the 14-day cycle "Anchor Date" (Day 0) for each shift pair.
              </Text>
            </Stack>
            <Alert icon={<IconInfoCircle size={16} />} variant="light" color="indigo" p="xs" style={{ maxWidth: 350 }}>
              <Text size="xs">
                The Panama schedule follows a 14-day rotation: <b>2 ON, 2 OFF, 3 ON, 2 OFF, 2 ON, 3 OFF.</b> 
                The Anchor Date defines Day 0 of this cycle.
              </Text>
            </Alert>
          </Group>

          <Grid gutter="xl">
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <DatePickerInput
                label="Shifts A & B Anchor Date"
                placeholder="Pick anchor date for A & B"
                value={parseOrNull(shiftSettings['A'])}
                onChange={(val) => {
                  const d = formatIso(Array.isArray(val) ? val[0] : val);
                  updateShiftSettings('A', d);
                  updateShiftSettings('B', d);
                }}
                leftSection={<IconCalendar size={18} stroke={1.5} />}
                clearable
                dropdownType="popover"
                valueFormat="YYYY-MM-DD"
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <DatePickerInput
                label="Shifts C & D Anchor Date"
                placeholder="Pick anchor date for C & D"
                value={parseOrNull(shiftSettings['C'])}
                onChange={(val) => {
                  const d = formatIso(Array.isArray(val) ? val[0] : val);
                  updateShiftSettings('C', d);
                  updateShiftSettings('D', d);
                }}
                leftSection={<IconCalendar size={18} stroke={1.5} />}
                clearable
                dropdownType="popover"
                valueFormat="YYYY-MM-DD"
              />
            </Grid.Col>
          </Grid>
        </Stack>
      </Card>

      {roleMode === 'planner' && (
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
              <Tabs.Tab value="process" leftSection={<IconTable size={14} />}>
                Processes
              </Tabs.Tab>
              <Tabs.Tab value="partInfo" leftSection={<IconTable size={14} />}>
                Part Information
              </Tabs.Tab>
              <Tabs.Tab value="processInfo" leftSection={<IconTable size={14} />}>
                Process Information
              </Tabs.Tab>
              <Tabs.Tab value="dailyRate" leftSection={<IconTable size={14} />}>
                Daily Rate
              </Tabs.Tab>
              <Tabs.Tab value="locatorMapping" leftSection={<IconTable size={14} />}>
                Locator Mapping
              </Tabs.Tab>
              <Tabs.Tab value="reasonCode" leftSection={<IconTable size={14} />}>
                Reason Codes
              </Tabs.Tab>
              <Tabs.Tab value="deliveryData" leftSection={<IconDatabase size={14} />}>
                Delivery Data
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="process">
              {renderTable()}
            </Tabs.Panel>

            <Tabs.Panel value="partInfo">
              {renderTable()}
            </Tabs.Panel>

            <Tabs.Panel value="processInfo">
              {renderTable()}
            </Tabs.Panel>

            <Tabs.Panel value="dailyRate">
              {renderTable()}
            </Tabs.Panel>

            <Tabs.Panel value="locatorMapping">
              {renderTable()}
            </Tabs.Panel>

            <Tabs.Panel value="reasonCode">
              {renderTable()}
            </Tabs.Panel>

            <Tabs.Panel value="deliveryData">
              {renderTable()}
            </Tabs.Panel>
          </Tabs>
        </Stack>
        </Card>
      )}
    </Stack>
  );
}


