Here is the complete, expanded, and beautifully formatted `README.md` with all sections thoroughly detailed, from the interactive scheduler through the roles and access configurations. 

```markdown
<div align="center">
  <img width="1200" height="475" alt="Production Forecaster Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Production Forecaster & Scheduler

**Production Forecaster** is a comprehensive, desktop-native manufacturing intelligence application. Built to streamline production planning, capacity management, and delivery tracking, the system provides an intuitive interface for managing complex shift schedules, forecasting material shortages, and maintaining a healthy production pipeline.

---

## 🌟 Key Features

### 1. Delivery Dashboard & Scorecard
* **Real-time Performance Tracking:** Monitor daily attainments versus targets across departments.
* **Loss Pareto Analysis:** Visualize and analyze reasons for production losses (e.g., machine downtime, material shortages).
* **Role-Based Views:** Simplified read-only displays for standard users, with full CRUD (Create, Read, Update, Delete) management capabilities for authorized planners.

### 2. Interactive Equipment Scheduler
* **Drag-and-Drop Backlog Management:** Effortlessly assign production orders from a centralized backlog directly to machine shifts using a fluid drag-and-drop interface.
* **Real-Time Capacity Constraints:** Visual indicators display machine load, available capacity, and utilization percentages per shift. The system automatically splits jobs and returns the remainder to the backlog if a shift's capacity limit is exceeded.
* **Intelligent Auto-Scheduling Engine:** Automatically processes unassigned backlog items. It evaluates part-machine capabilities, standard processing times, and available shift capacities to optimally distribute workload and maximize utilization.
* **Changeover Generation:** One-click export functionality to generate precise changeover schedules based on the assigned sequence of parts per machine.

### 3. Production Forecaster
* **Predictive Pipeline Analysis:** Anticipate material shortages and identify parts "starving" production using intelligent Days of Inventory (DOI) logic.
* **Dynamic WIP Integration:** Merges daily rate requirements with active Work in Progress (WIP) locator data. It calculates expected arrival days based on standard transit times to forecast availability up to 14 days out.
* **Interactive Data Tables:** Drill down into specific part numbers to view daily expected vs. variance quantities, locator breakdowns, and aggregated pipeline metrics.

### 4. Robust Data Management
* **Centralized Master Data:** Manage Part Information, Machine Capabilities, Process Routing, and Reason Codes from a central database settings interface.
* **SQL Server Native:** Direct, secure connection to an MSSQL backend for reliable data persistence across all shifts and clients.
* **Flexible Data Imports:** Support for parsing, transposing, and importing raw pipeline CSVs and daily rate configurations directly into the backend.

---

## 🛠️ Technology Stack

This application is built using a modern desktop stack, bridging a highly responsive frontend with a performant systems-level backend. 

* **Frontend Framework:** React 19, Next.js 15 (App Router), TypeScript
* **UI & Styling:** Mantine v8, Tailwind CSS, Lucide React (Icons)
* **Interaction:** `@hello-pangea/dnd` for complex drag-and-drop state management
* **Desktop Runtime:** Tauri v2
* **Backend (Tauri Core):** Rust (v1.77.2+)
* **Database Driver:** `tiberius` (Async SQL Server driver for Rust)
* **State Management:** Zustand, Jotai (via Mantine hooks)

---

## 🚀 Getting Started

Follow these instructions to run the application locally in development mode.

### Prerequisites

* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* [Rust](https://www.rust-lang.org/tools/install) (v1.77.2 or higher)
* MSSQL Database instance (for full master data and scheduling functionality)

### Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd production-forecaster
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env.local` file in the root directory and add any required API keys (e.g., for AI Studio applet features):
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

4. **Database Configuration**
   The application requires a connection string to an MSSQL database. You will input and save this connection string within the application's "Database Settings" tab upon first launch.

### Running the App

To launch the application in development mode (spawns both the Next.js dev server and the native Tauri window):

```bash
npm run tauri dev
```

*(Note: Running standard `npm run dev` will only start the web server; you must use the Tauri CLI command above to access the native file system, dialogs, and Rust backend commands.)*

---

## 📂 Project Structure

The codebase is organized to support a modular software architecture, ensuring clear separation of concerns and reducing cognitive load for future feature implementation and long-term maintainability.

* **`/app`**: Next.js App Router definitions, global layouts, and main entry points.
* **`/components`**: Reusable, discrete React components.
  * **`/forecaster`**: Contains the complex forecasting table, data processing logic, and summary modules.
  * **`/layout`**: App headers, navigation shells, and responsive structural elements.
* **`/lib`**: Core utilities, global state stores (Zustand), date parsing functions, and shared TypeScript interfaces (`types.ts`).
* **`/src-tauri`**: The Rust backend core.
  * **`src/commands/`**: Highly modularized command files (e.g., `scheduler.rs`, `pipeline.rs`, `master_data.rs`) handling specific domains.
  * **`src/db.rs`**: Asynchronous MSSQL connection and query execution logic utilizing Tiberius.
  * **`src/lib.rs`**: Tauri application builder, plugin initialization, and command registration.
* **`schema_updates.sql`**: SQL execution scripts defining the required MSSQL tables, relationships, and data schemas.

---

## 🔒 Roles & Access

The application operates using a dual-role access model (`roleMode` toggle) to protect sensitive planning data while remaining accessible to shop-floor personnel.

* **Supervisor Mode:** Focused on daily execution. Supervisors can view delivery scorecards, monitor the production pipeline, and submit end-of-shift attainment data.
* **Planner Mode:** Requires authentication via the Auth Modal. Unlocks advanced capabilities including:
  * Drag-and-drop equipment scheduling and auto-schedule execution.
  * Pipeline and Plan data imports and full preview access.
  * Master data management (Reason Codes, Part-Machine Capabilities, Routing).
  * Deletion and replacement of historical scorecard weeks.

---

## 📝 License

*(Add your specific project license information here, e.g., MIT License)*
```