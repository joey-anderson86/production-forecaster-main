import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { notifications } from '@mantine/notifications';
import { getISODateForDay, isWorkingDay, formatSqlDate, formatSqlDateFromIso, parseISOLocal, generateWeekLabel } from './dateUtils';
import { SQLDeliveryData } from './types';

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface DailyScorecardRecord {
  DayOfWeek: DayOfWeek;
  Actual: number | null; 
  Target: number | null; 
  WipAvailable?: number;
  Date?: string;       // YYYY-MM-DD
  ReasonCode?: string | null;
}

export interface PartScorecard {
  Id: string; 
  PartNumber: string;
  Shift: string;
  DailyRecords: DailyScorecardRecord[]; 
  GroupId?: string; 
}

export interface WeeklyScorecard {
  WeekId: string; 
  WeekLabel: string; 
  Parts: PartScorecard[];
}

export interface DepartmentScorecard {
  DepartmentName: string;
  Weeks: Record<string, WeeklyScorecard>; 
}

export interface BulkImportGroup {
  DepartmentName: string;
  WeekLabel: string;
  Parts: PartScorecard[];
}

export interface ScorecardState {
  departments: Record<string, DepartmentScorecard>;
  shiftSettings: Record<string, string>; 
  isLoading: boolean;
  syncStatus: 'saved' | 'saving' | 'error';
  error: string | null;
  dirtyRows: Record<string, boolean>;
}

interface ScorecardActions {
  addDepartment: (departmentName: string) => void;
  removeDepartment: (departmentName: string) => void;
  addWeek: (departmentName: string, weekId: string, weekLabel: string) => void;
  deleteWeek: (departmentName: string, weekId: string) => void;
  addPartNumber: (departmentName: string, weekId: string, partNumber?: string, shift?: string, groupId?: string) => void;
  removePartNumber: (departmentName: string, weekId: string, rowId: string) => void;
  updatePartIdentity: (departmentName: string, weekId: string, rowId: string, updates: { partNumber?: string, shift?: string }) => void;
  updatePartGroupIdentity: (departmentName: string, weekId: string, groupId: string, partNumber: string) => void;
  updateDailyRecord: (
    departmentName: string, 
    weekId: string, 
    rowId: string,
    dayOfWeek: DayOfWeek, 
    field: keyof DailyScorecardRecord, 
    value: any
  ) => void;
  importWeeklyCsv: (departmentName: string, weekId: string, data: PartScorecard[]) => void;
  bulkImportCsv: (groups: BulkImportGroup[]) => void;
  fetchFromDb: (connectionString: string) => Promise<void>;
  syncToDb: (connectionString: string, departmentName?: string, weekId?: string) => Promise<void>;
  saveRecordToDb: (
    connectionString: string, 
    departmentName: string, 
    weekId: string, 
    rowId: string,
    dayOfWeek: DayOfWeek
  ) => Promise<void>;
  saveRowToDb: (
    connectionString: string, 
    departmentName: string, 
    weekId: string, 
    rowId: string
  ) => Promise<void>;
  deletePartFromDb: (
    connectionString: string,
    departmentName: string,
    weekId: string,
    partNumber: string,
    shift: string
  ) => Promise<void>;
  updateShiftSettings: (shift: string, anchorDate: string) => void;
}

export type ScorecardStore = ScorecardState & ScorecardActions;

const emptyDailyRecords = (weekId: string): DailyScorecardRecord[] => [
  { DayOfWeek: 'Mon', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Mon') },
  { DayOfWeek: 'Tue', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Tue') },
  { DayOfWeek: 'Wed', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Wed') },
  { DayOfWeek: 'Thu', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Thu') },
  { DayOfWeek: 'Fri', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Fri') },
  { DayOfWeek: 'Sat', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Sat') },
  { DayOfWeek: 'Sun', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Sun') },
];

export const useScorecardStore = create<ScorecardStore>()(
  immer(
    persist(
      (set, get) => ({
        departments: {},
        shiftSettings: {
          'A': '2026-03-23',
          'B': '2026-03-23',
          'C': '2026-03-30',
          'D': '2026-03-30',
        },
        isLoading: false,
        syncStatus: 'saved',
        error: null,
        dirtyRows: {},

        addDepartment: (departmentName) => set((state) => {
          if (!state.departments[departmentName]) {
            state.departments[departmentName] = { DepartmentName: departmentName, Weeks: {} };
          }
        }),

        removeDepartment: (departmentName) => set((state) => {
          delete state.departments[departmentName];
        }),

        addWeek: (departmentName, weekId, weekLabel) => set((state) => {
          const dept = state.departments[departmentName];
          if (dept && !dept.Weeks[weekId]) {
            dept.Weeks[weekId] = { WeekId: weekId, WeekLabel: weekLabel, Parts: [] };
          }
        }),

        deleteWeek: (departmentName, weekId) => set((state) => {
          const dept = state.departments[departmentName];
          if (dept) delete dept.Weeks[weekId];
        }),

        addPartNumber: (departmentName, weekId, partNumber = '', shift = '', groupId?: string) => set((state) => {
          const dept = state.departments[departmentName];
          if (!dept) return;

          if (!dept.Weeks[weekId]) {
            dept.Weeks[weekId] = { 
              WeekId: weekId, 
              WeekLabel: generateWeekLabel(weekId), 
              Parts: [] 
            };
          }
          
          const week = dept.Weeks[weekId];
          if (partNumber && shift && week.Parts.some(p => p.PartNumber === partNumber && p.Shift === shift)) {
            return;
          }

          const newPart: PartScorecard = {
            Id: crypto.randomUUID(),
            PartNumber: partNumber,
            Shift: shift,
            DailyRecords: emptyDailyRecords(weekId),
            GroupId: groupId
          };

          week.Parts.push(newPart);
          state.dirtyRows[newPart.Id] = true;
        }),

        removePartNumber: (departmentName, weekId, rowId) => set((state) => {
          const week = state.departments[departmentName]?.Weeks[weekId];
          if (week) {
            week.Parts = week.Parts.filter(p => p.Id !== rowId);
          }
        }),

        updatePartIdentity: (departmentName, weekId, rowId, updates) => set((state) => {
          const week = state.departments[departmentName]?.Weeks[weekId];
          if (!week) return;

          const part = week.Parts.find(p => p.Id === rowId);
          if (!part) return;
          
          if (updates.partNumber !== undefined) part.PartNumber = updates.partNumber;
          if (updates.shift !== undefined) {
            const oldShift = part.Shift;
            part.Shift = updates.shift;

            // Panama Schedule Logic
            const newAnchor = state.shiftSettings[updates.shift];
            if (newAnchor && updates.shift !== oldShift) {
              part.DailyRecords.forEach(record => {
                const targetDate = record.Date ? parseISOLocal(record.Date) : null;
                if (targetDate && !isWorkingDay(targetDate, newAnchor)) {
                  record.Target = null;
                }
              });
            }
          }

          state.dirtyRows[rowId] = true;
        }),

        updatePartGroupIdentity: (departmentName, weekId, groupId, partNumber) => set((state) => {
          const week = state.departments[departmentName]?.Weeks[weekId];
          if (week) {
            week.Parts.forEach(part => {
              if (part.GroupId === groupId) {
                part.PartNumber = partNumber;
              }
            });
          }
        }),

        updateDailyRecord: (departmentName, weekId, rowId, dayOfWeek, field, value) => set((state) => {
          const week = state.departments[departmentName]?.Weeks[weekId];
          if (!week) return;

          const part = week.Parts.find(p => p.Id === rowId);
          if (!part) return;

          const record = part.DailyRecords.find(r => r.DayOfWeek === dayOfWeek);
          if (record) {
            (record as any)[field] = value;
            state.dirtyRows[rowId] = true;
          }
        }),

        importWeeklyCsv: (departmentName, weekId, data) => set((state) => {
          const week = state.departments[departmentName]?.Weeks[weekId];
          if (!week) return;
          
          week.Parts = data.map(part => ({
            ...part,
            Id: part.Id || crypto.randomUUID(),
            DailyRecords: part.DailyRecords.map(record => ({
              ...record,
              Date: record.Date || getISODateForDay(weekId, record.DayOfWeek)
            }))
          }));
        }),

        bulkImportCsv: (groups) => set((state) => {
          groups.forEach(group => {
            const dept = state.departments[group.DepartmentName];
            if (!dept) return;

            let existingWeekId: string | null = null;
            for (const [id, w] of Object.entries(dept.Weeks)) {
              if (w.WeekLabel === group.WeekLabel) {
                existingWeekId = id;
                break;
              }
            }

            const weekIdToUse = existingWeekId || `week-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            const augmentedParts = group.Parts.map(part => ({
              ...part,
              Id: part.Id || crypto.randomUUID(),
              DailyRecords: part.DailyRecords.map(record => ({
                ...record,
                Date: record.Date || getISODateForDay(weekIdToUse, record.DayOfWeek)
              }))
            }));

            dept.Weeks[weekIdToUse] = {
              WeekId: weekIdToUse,
              WeekLabel: group.WeekLabel,
              Parts: augmentedParts
            };
          });
        }),

        fetchFromDb: async (connectionString: string) => {
          set({ isLoading: true, error: null, syncStatus: 'saving' });
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const rawData = await invoke<SQLDeliveryData[]>('get_scorecard_data', { connectionString });
            
            set((state) => {
              const newDepartments: Record<string, DepartmentScorecard> = {};
              
              rawData.forEach(row => {
                const dept = row.Department;
                const weekId = row.WeekIdentifier;
                const pNum = row.PartNumber.trim().toUpperCase();
                const shift = (row.Shift || 'A').trim().toUpperCase();
                
                if (!newDepartments[dept]) {
                  newDepartments[dept] = { DepartmentName: dept, Weeks: {} };
                }
                
                if (!newDepartments[dept].Weeks[weekId]) {
                  const existingDept = state.departments[dept];
                  const existingWeek = existingDept?.Weeks[weekId];
                  
                  newDepartments[dept].Weeks[weekId] = { 
                    WeekId: weekId, 
                    WeekLabel: existingWeek?.WeekLabel || weekId, 
                    Parts: [] 
                  };
                }
                
                const week = newDepartments[dept].Weeks[weekId];
                let part = week.Parts.find(p => p.PartNumber.toUpperCase() === pNum && p.Shift.toUpperCase() === shift);
                
                if (!part) {
                  part = {
                    Id: crypto.randomUUID(),
                    PartNumber: pNum,
                    Shift: shift,
                    DailyRecords: [
                      { DayOfWeek: 'Mon', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Mon') },
                      { DayOfWeek: 'Tue', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Tue') },
                      { DayOfWeek: 'Wed', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Wed') },
                      { DayOfWeek: 'Thu', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Thu') },
                      { DayOfWeek: 'Fri', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Fri') },
                      { DayOfWeek: 'Sat', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Sat') },
                      { DayOfWeek: 'Sun', Actual: null, Target: null, Date: getISODateForDay(weekId, 'Sun') },
                    ]
                  };
                  week.Parts.push(part);
                }
                
                const record = part.DailyRecords.find(d => d.DayOfWeek === row.DayOfWeek);
                if (record) {
                  record.Actual = row.Actual;
                  record.Target = row.Target;
                  record.Date = row.Date;
                  record.ReasonCode = row.ReasonCode;
                }
              });
              
              state.departments = newDepartments;
              state.isLoading = false;
              state.syncStatus = 'saved';
              state.error = null;
              state.dirtyRows = {}; // Clear any stale dirty row IDs since we have a fresh DB state
            });
          } catch (err: any) {
            set({ error: `[Fetch] ${err.toString()}`, isLoading: false, syncStatus: 'error' });
          }
        },

        syncToDb: async (connectionString: string, departmentName?: string, weekId?: string) => {
          const { departments, dirtyRows } = get();
          const records: any[] = [];
          const syncedRowIds = new Set<string>();
          
          Object.values(departments).forEach(dept => {
            if (departmentName && dept.DepartmentName !== departmentName) return;
            Object.values(dept.Weeks).forEach(week => {
              if (weekId && week.WeekId !== weekId) return;
              week.Parts.forEach(part => {
                if (dirtyRows[part.Id]) {
                  syncedRowIds.add(part.Id);
                  part.DailyRecords.forEach(record => {
                    records.push({
                      Department: dept.DepartmentName,
                      WeekIdentifier: week.WeekId,
                      PartNumber: (part.PartNumber || "").trim().toUpperCase(),
                      Shift: (part.Shift || "A").trim().toUpperCase(),
                      DayOfWeek: record.DayOfWeek,
                      Target: record.Target,
                      Actual: record.Actual,
                      Date: record.Date ? formatSqlDateFromIso(record.Date) : null,
                      ReasonCode: record.ReasonCode
                    });
                  });
                }
              });
            });
          });
          
          if (records.length === 0) return;

          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('upsert_scorecard_data', { connectionString, records });
            set((state) => {
              syncedRowIds.forEach(id => delete state.dirtyRows[id]);
              state.syncStatus = 'saved';
              state.error = null;
            });
          } catch (err: any) {
            set({ syncStatus: 'error', error: `[Sync] ${err.toString()}` });
            throw err;
          }
        },

        saveRecordToDb: async (connectionString: string, departmentName: string, weekId: string, rowId: string, dayOfWeek: DayOfWeek) => {
          const { departments } = get();
          const part = departments[departmentName]?.Weeks[weekId]?.Parts.find(p => p.Id === rowId);
          if (!part) return;

          const record = part.DailyRecords.find(r => r.DayOfWeek === dayOfWeek);
          if (!record) return;

          set({ syncStatus: 'saving', error: null });

          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const dbRecord = {
              Department: departmentName,
              WeekIdentifier: weekId,
              PartNumber: part.PartNumber || "",
              DayOfWeek: record.DayOfWeek,
              Target: record.Target,
              Actual: record.Actual,
              Date: record.Date ? formatSqlDateFromIso(record.Date) : null,
              Shift: part.Shift || "",
              ReasonCode: record.ReasonCode
            };

            await invoke('upsert_scorecard_data', { connectionString, records: [dbRecord] });
            set((state) => {
              delete state.dirtyRows[part.Id];
              state.syncStatus = 'saved';
            });
          } catch (err: any) {
            console.error("Auto-save failed:", err);
            set({ syncStatus: 'error', error: `[Save] ${err.toString()}` });
            notifications.show({
              title: 'Auto-save Failed',
              message: `Could not save ${part.PartNumber} - ${dayOfWeek}: ${err.toString()}`,
              color: 'red',
              position: 'bottom-right'
            });
            throw err;
          }
        },

        saveRowToDb: async (connectionString: string, departmentName: string, weekId: string, rowId: string) => {
          const { departments } = get();
          const part = departments[departmentName]?.Weeks[weekId]?.Parts.find(p => p.Id === rowId);
          if (!part || !part.PartNumber || !part.Shift) return;

          set({ syncStatus: 'saving', error: null });

          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const records = part.DailyRecords.map(record => ({
              Department: departmentName,
              WeekIdentifier: weekId,
              PartNumber: part.PartNumber,
              DayOfWeek: record.DayOfWeek,
              Target: record.Target,
              Actual: record.Actual,
              Date: record.Date ? formatSqlDateFromIso(record.Date) : null,
              Shift: part.Shift,
              ReasonCode: record.ReasonCode
            }));

            await invoke('upsert_scorecard_data', { connectionString, records });
            set((state) => {
              delete state.dirtyRows[part.Id];
              state.syncStatus = 'saved';
            });
          } catch (err: any) {
            console.error("Auto-save row failed:", err);
            set({ syncStatus: 'error', error: `[Save] ${err.toString()}` });
            notifications.show({
              title: 'Auto-save Failed',
              message: `Could not save data for row ${part.PartNumber}: ${err.toString()}`,
              color: 'red',
              position: 'bottom-right'
            });
            throw err;
          }
        },

        deletePartFromDb: async (connectionString, departmentName, weekId, partNumber, shift) => {
          set({ syncStatus: 'saving', error: null });
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('delete_scorecard_row', { 
              connectionString, 
              department: departmentName, 
              weekIdentifier: weekId, 
              partNumber: partNumber, 
              shift: shift 
            });
            set({ syncStatus: 'saved', error: null });
          } catch (err: any) {
            console.error("Delete record failed:", err);
            set({ syncStatus: 'error', error: `[Delete] ${err.toString()}` });
            throw err;
          }
        },

        updateShiftSettings: (shift, anchorDate) => set((state) => {
          state.shiftSettings[shift] = anchorDate;
        })
      }),
      {
        name: 'scorecard-storage',
        version: 1,
        migrate: (persistedState: any, version: number) => {
          if (version === 0) {
            const state = persistedState as any;
            if (state.departments) {
              Object.keys(state.departments).forEach(deptKey => {
                const dept = state.departments[deptKey];
                if (dept.weeks && !dept.Weeks) { dept.Weeks = dept.weeks; delete dept.weeks; }
                if (dept.Weeks) {
                  Object.keys(dept.Weeks).forEach(weekKey => {
                    const week = dept.Weeks[weekKey];
                    if (week.weekId && !week.WeekId) { week.WeekId = week.weekId; delete week.weekId; }
                    if (week.weekLabel && !week.WeekLabel) { week.WeekLabel = week.weekLabel; delete week.weekLabel; }
                    if (week.parts && !week.Parts) { week.Parts = week.parts; delete week.parts; }
                    if (week.Parts) {
                      week.Parts.forEach((part: any) => {
                        if (part.partNumber && !part.PartNumber) { part.PartNumber = part.partNumber; delete part.partNumber; }
                        if (part.shift && !part.Shift) { part.Shift = part.shift; delete part.shift; }
                        if (part.dailyRecords && !part.DailyRecords) { part.DailyRecords = part.dailyRecords; delete part.dailyRecords; }
                        if (part.DailyRecords) {
                          part.DailyRecords.forEach((record: any) => {
                            if (record.dayOfWeek && !record.DayOfWeek) { record.DayOfWeek = record.dayOfWeek; delete record.dayOfWeek; }
                            if (record.actual !== undefined && record.Actual === undefined) { record.Actual = record.actual; delete record.actual; }
                            if (record.target !== undefined && record.Target === undefined) { record.Target = record.target; delete record.target; }
                            if (record.reasonCode !== undefined && record.ReasonCode === undefined) { record.ReasonCode = record.reasonCode; delete record.reasonCode; }
                            if (record.date && !record.Date) { record.Date = record.date; delete record.date; }
                          });
                        }
                      });
                    }
                  });
                }
              });
            }
            return state;
          }
          return persistedState;
        }
      }
    )
  )
);
