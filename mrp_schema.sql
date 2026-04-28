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

-- SQL Migration Script: Normalize PartInfo to ItemMaster and PartRoutings
-- Execute this script to establish PartRoutings as the single source of truth.

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- 1. Drop Legacy View if it exists (to avoid dependency conflicts)
IF OBJECT_ID('dbo.PartInfo', 'V') IS NOT NULL 
    DROP VIEW dbo.PartInfo;
GO

-- 2. Safely Drop Legacy Table
IF OBJECT_ID('dbo.PartInfo', 'U') IS NOT NULL 
    DROP TABLE dbo.PartInfo;
GO

-- 3. Create Item Master (Global Registry)
IF OBJECT_ID('dbo.ItemMaster', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItemMaster (
        PartNumber NVARCHAR(50) NOT NULL PRIMARY KEY,
        PartName NVARCHAR(255) NULL
    );
END
GO

-- 4. Verify / Create PartRoutings (Bill of Operations)
IF OBJECT_ID('dbo.PartRoutings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PartRoutings (
        RoutingID INT IDENTITY(1,1) PRIMARY KEY,
        PartNumber NVARCHAR(50) NOT NULL,
        ProcessName NVARCHAR(50) NOT NULL,
        SequenceNumber INT NOT NULL,
        ProcessingTimeMins FLOAT NOT NULL,
        BatchSize INT NOT NULL,
        TransitShifts INT NOT NULL,
        CONSTRAINT FK_PartRoutings_ItemMaster FOREIGN KEY (PartNumber) REFERENCES dbo.ItemMaster(PartNumber)
    );
END
GO

-- 5. Create Legacy View for Backward Compatibility
-- Maps PartRoutings data back to the PartInfo schema for existing queries.
IF OBJECT_ID('dbo.PartInfo', 'V') IS NOT NULL 
    DROP VIEW dbo.PartInfo;
GO

CREATE VIEW dbo.PartInfo AS
SELECT 
    IM.PartNumber,
    IM.PartName,
    PR.ProcessName,
    PR.BatchSize,
    PR.ProcessingTimeMins AS ProcessingTime
FROM dbo.ItemMaster IM
INNER JOIN dbo.PartRoutings PR ON IM.PartNumber = PR.PartNumber;
GO
