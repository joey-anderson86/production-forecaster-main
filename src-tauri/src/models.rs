use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct ScorecardRow {
    pub department: String,
    pub week_identifier: String,
    pub part_number: String,
    pub day_of_week: String,
    pub target: Option<i32>,
    pub actual: Option<i32>,
    pub date: Option<String>,
    pub shift: Option<String>,
    pub reason_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct LocatorMapping {
    #[serde(rename = "WIPLocator")]
    pub wip_locator: Option<String>,
    pub process_name: Option<String>,
    pub days_from_shipment: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PartInfo {
    pub part_number: Option<String>,
    pub process_name: Option<String>,
    pub batch_size: Option<i32>,
    pub processing_time: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ProcessInfo {
    pub process_name: Option<String>,
    pub date: Option<String>,
    pub hours_available: Option<f64>,
    #[serde(rename = "MachineID")]
    pub machine_id: Option<String>,
    pub shift: Option<String>,
    pub week_identifier: Option<String>,
}

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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct SchedulerState {
    pub unassigned: Vec<JobBlock>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PartMachineCapability {
    pub part_id: String,
    pub machine_id: String,
    pub parts_per_hour: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BacklogItem {
    pub id: String,
    pub part_id: String,
    pub quantity: u32,
    pub priority: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MachineState {
    pub machine_id: String,
    pub total_capacity_hours: f64,
    pub current_utilization_pct: f64,
    pub max_utilization_pct: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub backlog_item_id: String,
    pub part_id: String,
    pub machine_id: String,
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

