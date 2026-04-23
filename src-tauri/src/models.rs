use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Represents a single row from the production scorecard database.
/// 
/// This structure captures daily production targets and actual achievements for a specific
/// part, shift, and department.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct ScorecardRow {
    /// The organizational department (e.g., 'Brakes', 'Assembly').
    pub department: String,
    /// Fiscal week identifier (e.g., '2024-W15').
    pub week_identifier: String,
    /// The unique part number identifier.
    pub part_number: String,
    /// Day of the week (e.g., 'Monday').
    pub day_of_week: String,
    /// The production goal for this entry.
    pub target: Option<i32>,
    /// The quantity actually produced.
    pub actual: Option<i32>,
    /// Calendar date in ISO 8601 format.
    pub date: Option<String>,
    /// Production shift (e.g., 'A', 'B').
    pub shift: Option<String>,
    /// Explanation code for target variances.
    pub reason_code: Option<String>,
}

/// Maps physical storage or staging locators to manufacturing processes.
///
/// Used to determine lead times based on where a part is physically located in the factory.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct LocatorMapping {
    /// The unique identifier for a physical location.
    #[serde(rename = "WIPLocator")]
    pub wip_locator: Option<String>,
    /// The process name associated with this location.
    pub process_name: Option<String>,
    /// Estimated days remaining until shipment from this point in the process.
    pub days_from_shipment: Option<i32>,
}

/// Static metadata for a manufacturing part.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PartInfo {
    /// Unique part identifier.
    pub part_number: Option<String>,
    /// Name of the primary manufacturing process.
    pub process_name: Option<String>,
    /// Standard quantity produced per batch.
    pub batch_size: Option<i32>,
    /// Theoretical time in minutes to produce one unit.
    pub processing_time: Option<i32>,
}

/// Captures resource availability for a specific machine and shift.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ProcessInfo {
    pub process_name: Option<String>,
    pub date: Option<String>,
    /// Total hours available for production on this machine/shift.
    pub hours_available: Option<f64>,
    #[serde(rename = "MachineID")]
    pub machine_id: Option<String>,
    pub shift: Option<String>,
    pub week_identifier: Option<String>,
}

/// A row in the production pipeline, representing a customer order and its current status.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct PipelineRow {
    pub date: Option<String>,
    pub customer: Option<String>,
    pub customer_city: Option<String>,
    pub part_number: Option<String>,
    pub part_name: Option<String>,
    pub wip_locator: Option<String>,
    pub qty: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct PlanRow {
    pub date: Option<String>,
    pub part_number: Option<String>,
    pub part_name: Option<String>,
    pub process_name: Option<String>,
    pub qty: Option<i32>,
    pub actual: Option<i32>,
    pub shift: Option<String>,
    pub week_identifier: Option<String>,
    pub day_of_week: Option<String>,
    pub reason_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct ShiftProductionRecord {
    pub date: String,
    pub department: String,
    pub week_identifier: String,
    pub part_number: String,
    pub day_of_week: String,
    pub target: Option<i32>,
    pub actual: Option<i32>,
    pub shift: String,
    pub reason_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct Process {
    pub process_name: String,
    #[serde(rename = "MachineID")]
    pub machine_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct ReasonCodeData {
    pub process_name: Option<String>,
    pub reason_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct DailyRateRow {
    pub part_number: Option<String>,
    pub week: i32,
    pub year: i32,
    pub qty: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct RollingGapRow {
    pub part_number: String,
    pub shift: String,
    pub rolling_gap: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct DistributeDemandRequest {
    pub total_demand: i32,
    pub child_rows: Vec<ChildRowDesc>,
    pub week_dates: Vec<Option<String>>, // YYYY-MM-DD
    pub anchor_dates: HashMap<String, String>,
    pub shift_capacities: Vec<HashMap<String, f64>>,
    pub processing_time_min: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ChildRowDesc {
    pub id: String,
    pub shift: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct DistributeDemandResult {
    pub row_id: String,
    pub day: String,
    pub value: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct JobAssignmentPayload {
    pub week_identifier: String,
    pub part_number: String,
    #[serde(rename = "MachineID")]
    pub machine_id: String,
    pub date: String,
    pub shift: String,
    pub qty: i32,
    pub run_sequence: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct JobBlock {
    pub id: String,
    pub part_number: String,
    pub shift: String,
    pub target_qty: i32,
    pub processing_time_mins: f64,
    pub standard_batch_size: Option<i32>,
    pub batch_index: i32,
    pub is_batch_split: bool,
    pub original_shift: Option<String>,
    pub original_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ShiftSchedule {
    pub jobs: Vec<JobBlock>,
    pub capacity_hrs: f64,
    pub total_assigned_hours: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct MachineSchedule {
    #[serde(rename = "MachineID")]
    pub machine_id: String,
    pub daily_capacity_hrs: f64, // Aggregate for day
    pub schedule: HashMap<String, HashMap<String, ShiftSchedule>>,
}

/// Represents the current state of the automated scheduling engine.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct SchedulerState {
    /// Tasks that have not yet been assigned to a machine slot.
    pub unassigned: Vec<JobBlock>,
    /// Map of Machine ID to its respective daily/shift schedule.
    pub machines: HashMap<String, MachineSchedule>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct SchedulerMeta {
    pub active_weeks: Vec<String>,
    pub process_hierarchy: HashMap<String, Vec<String>>,
    pub part_machine_map: HashMap<String, Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct JobAssignment {
    #[serde(rename = "JobID")]
    pub job_id: String,
    #[serde(rename = "MachineID")]
    pub machine_id: Option<String>,
    pub date: String,
    pub day_of_week: String,
    pub qty: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PartInfoId {
    pub part_number: String,
    pub process_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ProcessInfoId {
    pub process_name: Option<String>,
    pub date: Option<String>,
    #[serde(rename = "MachineID")]
    pub machine_id: Option<String>,
    pub shift: Option<String>,
}

/// Defines the production capability (units per hour) of a specific machine for a part.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PartMachineCapability {
    pub part_id: String,
    pub machine_id: String,
    /// Throughput rate used by the scheduler to estimate job duration.
    pub parts_per_hour: f64,
}

/// A high-level representation of work needing to be performed.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BacklogItem {
    pub id: String,
    pub part_id: String,
    pub quantity: u32,
    /// Numerical priority used to sort items before scheduling (lower = higher priority).
    pub priority: u32,
    pub shift: String,
    pub original_date: Option<String>,
}

/// Tracks the available and consumed capacity of a machine for a specific window.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MachineState {
    pub machine_id: String,
    pub date: String,
    pub shift: String,
    /// Maximum hours available.
    pub total_capacity_hours: f64,
    /// Current percentage of total_capacity_hours that is occupied by tasks.
    pub current_utilization_pct: f64,
    /// Upper limit for utilization (e.g., 0.85 for 85%).
    pub max_utilization_pct: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub backlog_item_id: String,
    pub part_id: String,
    pub machine_id: String,
    pub date: String,
    pub shift: String,
    pub quantity: u32,
    pub estimated_hours: f64,
    pub added_utilization_pct: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRequest {
    pub backlog_items: Vec<BacklogItem>,
    pub capabilities: Vec<PartMachineCapability>,
    pub machine_states: Vec<MachineState>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleResponse {
    pub newly_scheduled: Vec<ScheduledTask>,
    pub remaining_backlog: Vec<BacklogItem>,
    pub updated_machine_states: Vec<MachineState>,
}

