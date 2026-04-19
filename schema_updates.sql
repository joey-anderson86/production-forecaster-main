-- Phase 1: Schema Updates for SARGability and Index Utilization
-- Replace nchar columns with NVARCHAR(50) to prevent space-padding issues.
-- Note: Adjust the definitions to add constraints or keep as per the system's exact field configurations.

-- 1. PartInfo
IF OBJECT_ID('dbo.PartInfo', 'U') IS NOT NULL
DROP TABLE dbo.PartInfo;
GO
CREATE TABLE dbo.PartInfo (
    PartNumber NVARCHAR(50) NOT NULL,
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
    HoursAvailable INT,
    WeekIdentifier NVARCHAR(50),
    CONSTRAINT UQ_ProcessInfo UNIQUE NONCLUSTERED (ProcessName, Date, Shift, MachineID)
);
GO

-- 5. DeliveryData
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

-- 8. Create mapping for Part to specific Machines
IF OBJECT_ID('dbo.PartMachineCapability', 'U') IS NOT NULL
DROP TABLE dbo.PartMachineCapability;
GO
CREATE TABLE dbo.PartMachineCapability (
    PartNumber NVARCHAR(50) NOT NULL,
    MachineID NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_PartMachineCapability PRIMARY KEY (PartNumber, MachineID)
    -- Optional: Add Foreign Keys referencing PartInfo and Process tables
);
GO

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
    RunSequence INT NOT NULL -- Tracks the drag-and-drop order
);
GO

-- Index for fast querying by week and department during load
CREATE NONCLUSTERED INDEX IX_EquipmentSchedule_Week_Dept 
ON dbo.EquipmentSchedule(WeekIdentifier, Department);
GO