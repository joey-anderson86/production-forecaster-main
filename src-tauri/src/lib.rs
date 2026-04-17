mod models;
mod db;
pub mod commands;

use tokio::sync::Mutex;
use crate::db::DbState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(DbState {
            connection_string: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            // Scheduler Commands
            commands::scheduler::get_machine_utilization,
            commands::scheduler::update_job_machine_assignment,
            commands::scheduler::get_scheduler_meta,
            commands::scheduler::save_scheduler_state,
            commands::scheduler::calculate_demand_distribution,
            commands::scheduler::submit_shift_production,

            // Scorecard & Planning Commands
            commands::scorecard::get_scorecard_data,
            commands::scorecard::upsert_scorecard_data,
            commands::scorecard::replace_delivery_data,
            commands::scorecard::delete_scorecard_week,
            commands::scorecard::delete_scorecard_row,
            commands::scorecard::get_rolling_gaps,
            commands::scorecard::get_plan_data_preview,
            commands::scorecard::append_plan_data,
            commands::scorecard::delete_plan_data_by_date,
            commands::scorecard::get_plan_data_for_shift,

            // Pipeline Commands
            commands::pipeline::get_pipeline_data_preview,
            commands::pipeline::append_pipeline_data,
            commands::pipeline::delete_pipeline_data_by_date,
            commands::pipeline::parse_and_transpose_pipeline_csv,
            commands::pipeline::sync_pipeline_locators,

            // Master Data Commands
            commands::master_data::get_locator_mapping_preview,
            commands::master_data::upsert_locator_mapping,
            commands::master_data::delete_locator_mappings,
            commands::master_data::replace_locator_mappings,
            commands::master_data::get_part_info_preview,
            commands::master_data::upsert_part_info,
            commands::master_data::delete_part_infos,
            commands::master_data::replace_part_infos,
            commands::master_data::get_all_part_numbers,
            commands::master_data::get_part_numbers_by_process,
            commands::master_data::get_process_info_preview,
            commands::master_data::get_process_info,
            commands::master_data::upsert_process_info,
            commands::master_data::delete_process_infos,
            commands::master_data::replace_process_infos,
            commands::master_data::get_processes_preview,
            commands::master_data::upsert_process,
            commands::master_data::delete_processes,
            commands::master_data::replace_processes,
            commands::master_data::get_processes,
            commands::master_data::get_active_weeks,
            commands::master_data::get_machines_by_process,
            commands::master_data::get_reason_codes_preview,
            commands::master_data::upsert_reason_codes,
            commands::master_data::delete_reason_codes,
            commands::master_data::replace_reason_codes,
            commands::master_data::get_reason_codes_by_process,

            // Daily Rate Commands
            commands::rates::get_daily_rate_preview,
            commands::rates::upsert_daily_rate,
            commands::rates::delete_daily_rates,
            commands::rates::replace_daily_rates,

            // Export Commands
            commands::export::save_csv_file,
            commands::export::save_csv_file_with_handle,

            // Database Utilities
            db::test_mssql_connection
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
