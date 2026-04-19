/**
 * Database Entity Interfaces
 * These match the MSSQL schema defined in schema_updates.sql
 */

export interface SQLPartInfo {
  PartNumber: string;
  ProcessName: string;
  BatchSize: number;
  ProcessingTime: number;
}

export interface SQLProcess {
  ProcessName: string;
  MachineID: string;
}

export interface SQLReasonCode {
  ProcessName: string;
  ReasonCode: string;
}

export interface SQLProcessInfo {
  ProcessInfoID?: number;
  ProcessName: string;
  Date: string;
  Shift: string;
  MachineID: string;
  HoursAvailable: number;
  WeekIdentifier: string;
}

export interface SQLDeliveryData {
  DeliveryDataID?: number;
  Date: string;
  Department: string;
  PartNumber: string;
  Shift: string;
  WeekIdentifier: string;
  DayOfWeek: string;
  Target: number;
  Actual: number;
  ReasonCode?: string;
}

export interface SQLLocatorMapping {
  WIPLocator: string;
  ProcessName: string | null;
  DaysFromShipment: number;
}

export interface SQLDailyRate {
  PartNumber: string;
  Week: number;
  Year: number;
  Qty: number;
}

export interface SQLEquipmentSchedule {
  ScheduleID?: number;
  WeekIdentifier: string;
  Department: string;
  MachineID: string;
  Date: string;
  Shift: string;
  PartNumber: string;
  Qty: number;
  RunSequence: number;
}

export interface JobAssignment {
  WeekIdentifier: string;
  PartNumber: string;
  MachineID: string;
  Date: string;
  Shift: string;
  Qty: number;
  RunSequence: number;
}

export interface SQLPartMachineCapability {
  PartNumber: string;
  MachineID: string;
}

/**
 * UI State Types
 * Used for frontend data processing and display
 */

export interface PipelineRow {
  PartNumber: string;
  Customer: string;
  "Customer City": string;
  Date: string;
  Qty?: number | string;
  WIPLocator?: string;
  // Index signature for dynamic locator columns (e.g. "LOC1": 50, "LOC2": 10)
  [locator: string]: string | number | undefined;
}

export interface DailyRateRow {
  "Part Number": string;
  "Daily Rate": number;
  [key: string]: string | number;
}

export interface RawPipelineRow {
  PartNumber: string;
  Customer: string;
  CustomerCity: string;
  Date: string;
  WIPLocator: string;
  Qty: number;
}
