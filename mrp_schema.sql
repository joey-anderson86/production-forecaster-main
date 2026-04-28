-- Phase 1: Database Schema Refactor (The Routing Engine)

-- 1. Create PartRoutings Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PartRoutings]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[PartRoutings] (
        [RoutingID] INT IDENTITY(1,1) PRIMARY KEY,
        [PartNumber] VARCHAR(100) NOT NULL,
        [ProcessName] VARCHAR(100) NOT NULL,
        [SequenceNumber] INT NOT NULL, -- e.g., 10, 20, 30
        [ProcessingTimeMins] FLOAT DEFAULT 0.0,
        [BatchSize] INT DEFAULT 1,
        [TransitShifts] INT DEFAULT 0, -- Lead time in shifts
        CONSTRAINT UC_PartRouting UNIQUE (PartNumber, SequenceNumber)
    );
END
GO

-- 2. Create UpstreamDemand Table
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[UpstreamDemand]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[UpstreamDemand] (
        [DemandID] INT IDENTITY(1,1) PRIMARY KEY,
        [PartNumber] VARCHAR(100) NOT NULL,
        [ProcessName] VARCHAR(100) NOT NULL,
        [TargetDate] DATE NOT NULL,
        [TargetShift] VARCHAR(10) NOT NULL, -- A, B, C, D
        [RequiredQty] INT NOT NULL,
        [CreatedAt] DATETIME DEFAULT GETDATE()
    );
END
GO
