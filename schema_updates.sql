-- Phase 1: Schema Updates for SARGability and Index Utilization
-- Replace nchar columns with NVARCHAR(50) to prevent space-padding issues.

-- 1. PartInfo
IF OBJECT_ID('dbo.PartInfo', 'U') IS NOT NULL
DROP TABLE dbo.PartInfo;
GO
CREATE TABLE dbo.PartInfo (
    PartNumber NVARCHAR(50) NOT NULL,
    PartName NVARCHAR(255), -- Added to support UI displays and PlanRow descriptions
    ProcessName NVARCHAR(50) NOT NULL,
    BatchSize INT,
    ProcessingTime INT,
    CONSTRAINT PK_PartInfo PRIMARY KEY (PartNumber, ProcessName)
);
GO

-- 2. Process
IF OBJECT_ID('dbo.Process', 'U') IS NOT NULL
DROP TABLE dbo.Process;
GO
CREATE TABLE dbo.Process (
    ProcessName NVARCHAR(50) NOT NULL,
    MachineID NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Process PRIMARY KEY (ProcessName, MachineID)
);
GO

-- 3. ReasonCode (Moved up for Foreign Key reference)
IF OBJECT_ID('dbo.ReasonCode', 'U') IS NOT NULL
DROP TABLE dbo.ReasonCode;
GO
CREATE TABLE dbo.ReasonCode (
    ProcessName NVARCHAR(50) NOT NULL,
    ReasonCode NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_ReasonCode PRIMARY KEY (ProcessName, ReasonCode)
);
GO

-- 4. ProcessInfo
IF OBJECT_ID('dbo.ProcessInfo', 'U') IS NOT NULL
BEGIN
    -- Handle migration: ensure NO nulls exist before adding the constraint if the table exists
    EXEC('UPDATE dbo.ProcessInfo SET MachineID = '''' WHERE MachineID IS NULL');
    DROP TABLE dbo.ProcessInfo;
END
GO
CREATE TABLE dbo.ProcessInfo (
    ProcessInfoID INT IDENTITY(1,1) PRIMARY KEY CLUSTERED,
    ProcessName NVARCHAR(50) NOT NULL,
    Date DATE NOT NULL,
    Shift NVARCHAR(50) NOT NULL,
    MachineID NVARCHAR(50) NOT NULL DEFAULT '',
    HoursAvailable FLOAT, -- Changed from INT to FLOAT to match f64 in Rust ProcessInfo struct
    WeekIdentifier NVARCHAR(50),
    CONSTRAINT UQ_ProcessInfo UNIQUE NONCLUSTERED (ProcessName, Date, Shift, MachineID)
);
GO

-- 5. DeliveryData (Supports ScorecardRow and PlanRow)
IF OBJECT_ID('dbo.DeliveryData', 'U') IS NOT NULL
DROP TABLE dbo.DeliveryData;
GO
CREATE TABLE dbo.DeliveryData (
    DeliveryDataID INT IDENTITY(1,1) PRIMARY KEY CLUSTERED,
    Date DATE NOT NULL,
    Department NVARCHAR(50) NOT NULL,
    PartNumber NVARCHAR(50) NOT NULL,
    Shift NVARCHAR(50) NOT NULL, 
    WeekIdentifier NVARCHAR(50),
    DayOfWeek NVARCHAR(50),
    Target INT,
    Actual INT,
    ReasonCode NVARCHAR(50),
    IsMRPGenerated BIT NOT NULL DEFAULT 0,
    CONSTRAINT UQ_DeliveryData UNIQUE NONCLUSTERED (Date, Department, PartNumber, Shift),
    CONSTRAINT FK_DeliveryData_ReasonCode FOREIGN KEY (Department, ReasonCode) REFERENCES dbo.ReasonCode (ProcessName, ReasonCode)
);
GO

-- 6. LocatorMapping
IF OBJECT_ID('dbo.LocatorMapping', 'U') IS NOT NULL
DROP TABLE dbo.LocatorMapping;
GO
CREATE TABLE dbo.LocatorMapping (
    WIPLocator NVARCHAR(50) NOT NULL,
    ProcessName NVARCHAR(50),
    DaysFromShipment INT,
    CONSTRAINT PK_LocatorMapping PRIMARY KEY (WIPLocator)
);
GO

-- 7. DailyRate
IF OBJECT_ID('dbo.DailyRate', 'U') IS NOT NULL
DROP TABLE dbo.DailyRate;
GO
CREATE TABLE dbo.DailyRate (
    PartNumber NVARCHAR(50) NOT NULL,
    Week INT NOT NULL,
    Year INT NOT NULL,
    Qty INT,
    CONSTRAINT PK_DailyRate PRIMARY KEY (PartNumber, Week, Year)
);
GO

-- 8. PartMachineCapability (Routing map for the Auto-Scheduler)
IF OBJECT_ID('dbo.PartMachineCapability', 'U') IS NOT NULL
DROP TABLE dbo.PartMachineCapability;
GO
CREATE TABLE dbo.PartMachineCapability (
    PartNumber NVARCHAR(50) NOT NULL,
    MachineID NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_PartMachineCapability PRIMARY KEY (PartNumber, MachineID)
);
GO

-- 9. EquipmentSchedule (Drag-and-drop schedule state)
IF OBJECT_ID('dbo.EquipmentSchedule', 'U') IS NOT NULL
DROP TABLE dbo.EquipmentSchedule;
GO
CREATE TABLE dbo.EquipmentSchedule (
    ScheduleID INT IDENTITY(1,1) PRIMARY KEY CLUSTERED,
    WeekIdentifier NVARCHAR(50) NOT NULL,
    Department NVARCHAR(50) NOT NULL,
    MachineID NVARCHAR(50) NOT NULL,
    Date DATE NOT NULL,
    Shift NVARCHAR(50) NOT NULL,
    PartNumber NVARCHAR(50) NOT NULL,
    Qty INT NOT NULL,
    RunSequence INT NOT NULL, -- Tracks the drag-and-drop order
    IsMRPGenerated BIT NOT NULL DEFAULT 0
);
GO

-- Index for fast querying by week and department during schedule load
CREATE NONCLUSTERED INDEX IX_EquipmentSchedule_Week_Dept 
ON dbo.EquipmentSchedule(WeekIdentifier, Department);
GO

-- 10. PipelineData (NEW: Added to support Pipeline CSV Imports and the PipelineRow struct)
IF OBJECT_ID('dbo.PipelineData', 'U') IS NOT NULL
DROP TABLE dbo.PipelineData;
GO
CREATE TABLE dbo.PipelineData (
    PipelineDataID INT IDENTITY(1,1) PRIMARY KEY CLUSTERED,
    Date DATE,
    Customer NVARCHAR(100),
    CustomerCity NVARCHAR(100),
    PartNumber NVARCHAR(50) NOT NULL,
    PartName NVARCHAR(255),
    WIPLocator NVARCHAR(50),
    Qty INT
);
GO

-- Index for fast Pipeline queries by PartNumber and WIPLocator
CREATE NONCLUSTERED INDEX IX_PipelineData_Part_Locator 
ON dbo.PipelineData(PartNumber, WIPLocator);
GO

-- Migration: Add IsMRPGenerated to existing tables
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.EquipmentSchedule') AND name = 'IsMRPGenerated')
BEGIN
    ALTER TABLE dbo.EquipmentSchedule ADD IsMRPGenerated BIT NOT NULL DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DeliveryData') AND name = 'IsMRPGenerated')
BEGIN
    ALTER TABLE dbo.DeliveryData ADD IsMRPGenerated BIT NOT NULL DEFAULT 0;
END
GO