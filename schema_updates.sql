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
    BatchSize SMALLINT,
    ProcessingTime SMALLINT,
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

-- 3. ProcessInfo
IF OBJECT_ID('dbo.ProcessInfo', 'U') IS NOT NULL
BEGIN
    -- Handle migration: ensure NO nulls exist before adding the constraint if the table exists
    EXEC('UPDATE dbo.ProcessInfo SET MachineID = '''' WHERE MachineID IS NULL');
    DROP TABLE dbo.ProcessInfo;
END
GO
CREATE TABLE dbo.ProcessInfo (
    ProcessName NVARCHAR(50) NOT NULL,
    Date DATE NOT NULL,
    Shift NVARCHAR(50) NOT NULL,
    MachineID NVARCHAR(50) NOT NULL DEFAULT '',
    HoursAvailable SMALLINT,
    WeekIdentifier NVARCHAR(50),
    CONSTRAINT PK_ProcessInfo PRIMARY KEY (ProcessName, Date, Shift, MachineID)
);
GO

-- 4. DeliveryData
IF OBJECT_ID('dbo.DeliveryData', 'U') IS NOT NULL
DROP TABLE dbo.DeliveryData;
GO
CREATE TABLE dbo.DeliveryData (
    Date DATE NOT NULL,
    Department NVARCHAR(50) NOT NULL,
    PartNumber NVARCHAR(50) NOT NULL,
    Shift NVARCHAR(50) NOT NULL, -- Shift cannot be NULL if it is part of the PK
    WeekIdentifier NVARCHAR(50),
    DayOfWeek NVARCHAR(50),
    Target SMALLINT,
    Actual SMALLINT,
    ReasonCode NVARCHAR(50),
    CONSTRAINT PK_DeliveryData PRIMARY KEY (Date, Department, PartNumber, Shift)
);
-- 5. ReasonCode
IF OBJECT_ID('dbo.ReasonCode', 'U') IS NOT NULL
DROP TABLE dbo.ReasonCode;
GO
CREATE TABLE dbo.ReasonCode (
    ProcessName NVARCHAR(50) NOT NULL,
    ReasonCode NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_ReasonCode PRIMARY KEY (ProcessName, ReasonCode)
);
GO

-- 6. LocatorMapping
IF OBJECT_ID('dbo.LocatorMapping', 'U') IS NOT NULL
DROP TABLE dbo.LocatorMapping;
GO
CREATE TABLE dbo.LocatorMapping (
    WIPLocator NVARCHAR(50) NOT NULL,
    ProcessName NVARCHAR(50),
    DaysFromShipment SMALLINT,
    CONSTRAINT PK_LocatorMapping PRIMARY KEY (WIPLocator)
);
GO

-- 7. DailyRate
IF OBJECT_ID('dbo.DailyRate', 'U') IS NOT NULL
DROP TABLE dbo.DailyRate;
GO
CREATE TABLE dbo.DailyRate (
    PartNumber NVARCHAR(50) NOT NULL,
    Week SMALLINT NOT NULL,
    Year SMALLINT NOT NULL,
    Qty SMALLINT,
    CONSTRAINT PK_DailyRate PRIMARY KEY (PartNumber, Week, Year)
);
GO

-- Phase 3: Transition to Machine-ID Scheduling
IF COL_LENGTH('dbo.DeliveryData', 'MachineID') IS NULL
BEGIN
    ALTER TABLE dbo.DeliveryData ADD MachineID NVARCHAR(50) NULL;
END
GO
