/**
 * Database Entity Interfaces
 * These match the MSSQL schema defined in schema_updates.sql
 */

/**
 * Represents static information about a manufacturing part and its associated process.
 */
export interface SQLPartInfo {
  /** The unique identifier for the part. */
  PartNumber: string;
  /** The name of the process (e.g., 'Assembly', 'Machining') required for this part. */
  ProcessName: string;
  /** The standard quantity produced in a single batch. */
  BatchSize: number;
  /** The time in minutes required to process one unit. */
  ProcessingTime: number;
}

/**
 * Defines a mapping between a manufacturing process and a specific machine or workstation.
 */
export interface SQLProcess {
  /** The name of the production process. */
  ProcessName: string;
  /** The unique identifier of the machine that performs this process. */
  MachineID: string;
}

/**
 * Represents a valid reason code for production downtime or targets misses within a specific process.
 */
export interface SQLReasonCode {
  /** The process to which this reason code applies. */
  ProcessName: string;
  /** The human-readable reason for the discrepancy (e.g., 'Material Shortage', 'Machine Down'). */
  ReasonCode: string;
}

/**
 * Captures operational capacity and availability for a specific machine on a given shift.
 */
export interface SQLProcessInfo {
  /** Primary key in the database (auto-incremented). */
  ProcessInfoID?: number;
  /** The process being tracked. */
  ProcessName: string;
  /** The calendar date (ISO 8601 format). */
  Date: string;
  /** The production shift (e.g., 'A', 'B', 'C', 'D'). */
  Shift: string;
  /** The machine identifier. */
  MachineID: string;
  /** Total clock hours available for production during this shift. */
  HoursAvailable: number;
  /** Fiscal week identifier (e.g., '2024-W15') used for grouping. */
  WeekIdentifier: string;
}

/**
 * Record of production targets vs. actuals for a specific part on a specific shift.
 * Used for attainment calculations and scorecard displays.
 */
export interface SQLDeliveryData {
  /** Primary key in the database. */
  DeliveryDataID?: number;
  /** The production date. */
  Date: string;
  /** The organizational department (e.g., 'Brakes', 'Chassis'). */
  Department: string;
  /** The part number produced. */
  PartNumber: string;
  /** The production shift. */
  Shift: string;
  /** Week grouping identifier. */
  WeekIdentifier: string;
  /** The day of the week (e.g., 'Monday'). */
  DayOfWeek: string;
  /** The target production quantity. */
  Target: number;
  /** The actual production quantity achieved. */
  Actual: number;
  /** Optional reason code if the target was not met. */
  ReasonCode?: string;
}

/**
 * Maps Work-In-Progress (WIP) locators to production processes for lead-time calculations.
 */
export interface SQLLocatorMapping {
  /** The physical location code in the facility. */
  WIPLocator: string;
  /** The process currently handling parts at this locator. */
  ProcessName: string | null;
  /** Estimated days until the part at this locator reaches the shipping dock. */
  DaysFromShipment: number;
}

/**
 * Defines the planned production rate for a part on a weekly basis.
 */
export interface SQLDailyRate {
  /** The part number. */
  PartNumber: string;
  /** The fiscal week number. */
  Week: number;
  /** The fiscal year. */
  Year: number;
  /** The required production quantity for the week. */
  Qty: number;
}

/**
 * Defines the process routing sequence and lead-time offsetting for a part.
 */
export interface SQLPartRouting {
  /** Primary key. */
  RoutingID?: number;
  /** The part number. */
  PartNumber: string;
  /** The process name in the sequence. */
  ProcessName: string;
  /** The order in which the process occurs (e.g., 10, 20). */
  SequenceNumber: number;
  /** Standard time per unit in minutes. */
  ProcessingTimeMins: number;
  /** Standard production lot size. */
  BatchSize: number;
  /** Number of shifts between this operation and the next. */
  TransitShifts: number;
}

/**
 * A persisted entry in the equipment schedule representing an assigned production task.
 */
export interface SQLEquipmentSchedule {
  /** Primary key. */
  ScheduleID?: number;
  /** Target week identifier. */
  WeekIdentifier: string;
  /** Department name. */
  Department: string;
  /** Target machine. */
  MachineID: string;
  /** Scheduled date. */
  Date: string;
  /** Scheduled shift. */
  Shift: string;
  /** Part number to produce. */
  PartNumber: string;
  /** Quantity to produce. */
  Qty: number;
  /** The order of execution on the machine during the shift. */
  RunSequence: number;
}

/**
 * A lightweight DTO for transferring job assignments between the frontend and backend.
 */
export interface JobAssignment {
  WeekIdentifier: string;
  PartNumber: string;
  MachineID: string;
  Date: string;
  Shift: string;
  Qty: number;
  RunSequence: number;
}

/**
 * Represents the inherent ability of a machine to produce a specific part.
 */
export interface SQLPartMachineCapability {
  /** Unique part ID. */
  partId: string;
  /** Unique machine ID. */
  machineId: string;
}

/**
 * UI State Types
 * Used for frontend data processing and display
 */

/**
 * Represents a row in the production pipeline visualization.
 * Dynamically includes columns for various WIP locators.
 */
export interface PipelineRow {
  PartNumber: string;
  Customer: string;
  "Customer City": string;
  Date: string;
  Qty?: number | string;
  WIPLocator?: string;
  /** Index signature for dynamic locator columns (e.g. "LOC1": 50, "LOC2": 10). */
  [locator: string]: string | number | undefined;
}

/**
 * Represents a row in the daily rate management table.
 */
export interface DailyRateRow {
  "Part Number": string;
  "Daily Rate": number;
  [key: string]: string | number;
}

/**
 * Represents a raw record of work-in-progress data before it is transposed for display.
 */
export interface RawPipelineRow {
  PartNumber: string;
  Customer: string;
  CustomerCity: string;
  Date: string;
  WIPLocator: string;
  Qty: number;
}

// --- Scheduler Algorithm Types ---

/**
 * An item in the production backlog awaiting scheduling.
 */
export interface BacklogItem {
  /** Unique identifier for the backlog entry. */
  id: string;
  /** The part number required. */
  partId: string;
  /** Total quantity to be produced. */
  quantity: number;
  /** Numerical priority (lower is higher priority). */
  priority: number;
  /** Preferred production shift. */
  shift: string;
  /**
   * The requested or planned date for this item.
   * This provides date context for the scheduling engine to ensure chronological assignment.
   */
  originalDate?: string;
  /** Routing sequence position. */
  sequenceNumber?: number;
}

/**
 * Performance metric defining how efficiently a machine produces a specific part.
 */
export interface PartMachineCapability {
  /** Unique part identifier. */
  partId: string;
  /** Unique machine identifier. */
  machineId: string;
  /** Calculated throughput (units per hour). */
  partsPerHour: number;
}

/**
 * Represents the availability and current workload of a machine on a specific date/shift.
 */
export interface MachineState {
  /** Unique machine identifier. */
  machineId: string;
  /**
   * The date this machine state applies to.
   * Allows the scheduling engine to assign capacity on specific dates.
   */
  date: string;
  /** The production shift. */
  shift: string;
  /** Total capacity in hours for this shift. */
  totalCapacityHours: number;
  /** Current percentage of capacity utilized by scheduled tasks. */
  currentUtilizationPct: number;
  /** Maximum allowable utilization percentage (safety buffer). */
  maxUtilizationPct: number;
}

/**
 * A task that has been assigned to a machine and time slot by the scheduler.
 */
export interface ScheduledTask {
  /** Reference to the original backlog item. */
  backlogItemId: string;
  /** The part number. */
  partId: string;
  /** Assigned machine. */
  machineId: string;
  /**
   * The date this task was successfully scheduled for.
   */
  date: string;
  /** Assigned shift. */
  shift: string;
  /** Quantity to produce in this slot. */
  quantity: number;
  /** Estimated time required based on machine capability. */
  estimatedHours: number;
  /** Impact of this task on the machine's utilization percentage. */
  addedUtilizationPct: number;
  /** Routing sequence position. */
  sequenceNumber?: number;
}

/**
 * Payload sent to the scheduling engine to perform an automated scheduling run.
 */
export interface ScheduleRequest {
  /** List of parts needing production. */
  backlogItems: BacklogItem[];
  /** Available machine throughput data. */
  capabilities: PartMachineCapability[];
  /** Current availability of machines. */
  machineStates: MachineState[];
  /** Tasks already scheduled for other processes to ensure sequencing logic. */
  existingAssignments?: ScheduledTask[];
}

/**
 * Result of a scheduling run, containing new assignments and remaining work.
 */
export interface ScheduleResponse {
  /** Tasks successfully assigned to machine slots. */
  newlyScheduled: ScheduledTask[];
  /** Items that could not be scheduled due to capacity constraints. */
  remainingBacklog: BacklogItem[];
  /** Updated utilization states for all machines involved. */
  updatedMachineStates: MachineState[];
}
