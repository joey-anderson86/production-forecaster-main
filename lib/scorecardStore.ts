import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  Id: string; // New field for stable identity
  PartNumber: string;
  Shift: string;
  DailyRecords: DailyScorecardRecord[]; // Always length 7
  GroupId?: string; // New field for grouping newly added rows
}

export interface WeeklyScorecard {
  WeekId: string; // e.g., "2026-w41"
  WeekLabel: string; // e.g., "Week 41 (Oct 5 - Oct 11)"
  Parts: PartScorecard[];
}

export interface DepartmentScorecard {
  DepartmentName: string;
  Weeks: Record<string, WeeklyScorecard>; // Key is weekId
}

export interface BulkImportGroup {
  DepartmentName: string;
  WeekLabel: string;
  Parts: PartScorecard[];
}

export interface ScorecardState {
  departments: Record<string, DepartmentScorecard>;
  shiftSettings: Record<string, string>; // Shift -> Anchor Date (ISO)
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
        if (state.departments[departmentName]) return state;
        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              DepartmentName: departmentName,
              Weeks: {}
            }
          }
        };
      }),

      removeDepartment: (departmentName) => set((state) => {
        const newDeps = { ...state.departments };
        delete newDeps[departmentName];
        return { departments: newDeps };
      }),

      addWeek: (departmentName, weekId, weekLabel) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept) return state;

        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              Weeks: {
                ...dept.Weeks,
                [weekId]: dept.Weeks[weekId] || { WeekId: weekId, WeekLabel: weekLabel, Parts: [] }
              }
            }
          }
        };
      }),

      deleteWeek: (departmentName, weekId) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.Weeks[weekId]) return state;

        const newWeeks = { ...dept.Weeks };
        delete newWeeks[weekId];

        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              Weeks: newWeeks
            }
          }
        };
      }),

      addPartNumber: (departmentName, weekId, partNumber = '', shift = '', groupId?: string) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept) return state;

        // Ensure week exists (initializes if missing)
        const week = dept.Weeks[weekId] || { 
          WeekId: weekId, 
          WeekLabel: generateWeekLabel(weekId), 
          Parts: [] 
        };
        
        // Only prevent duplicates if values are provided
        if (partNumber && shift && week.Parts.some(p => p.PartNumber === partNumber && p.Shift === shift)) {
          return state;
        }

        const newPart: PartScorecard = {
          Id: crypto.randomUUID(),
          PartNumber: partNumber,
          Shift: shift,
          DailyRecords: emptyDailyRecords(weekId),
          GroupId: groupId
        };

        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              Weeks: {
                ...dept.Weeks,
                [weekId]: {
                  ...week,
                  Parts: [...week.Parts, newPart]
                }
              }
            }
          },
          dirtyRows: {
            ...state.dirtyRows,
            [newPart.Id]: true
          }
        };
      }),

      removePartNumber: (departmentName, weekId, rowId) => set((state) => {
         const dept = state.departments[departmentName];
         if (!dept || !dept.Weeks[weekId]) return state;

         const week = dept.Weeks[weekId];
         return {
           departments: {
             ...state.departments,
             [departmentName]: {
               ...dept,
               Weeks: {
                 ...dept.Weeks,
                 [weekId]: {
                   ...week,
                   Parts: week.Parts.filter(p => p.Id !== rowId)
                 }
               }
             }
           }
         };
      }),

      updatePartIdentity: (departmentName, weekId, rowId, updates) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.Weeks[weekId]) return state;

        const week = dept.Weeks[weekId];
        const updatedParts = week.Parts.map(part => {
          if (part.Id !== rowId) return part;
          
          let updatedPart = { ...part };
          if (updates.partNumber !== undefined) updatedPart.PartNumber = updates.partNumber;
          if (updates.shift !== undefined) updatedPart.Shift = updates.shift;

          // Panama Schedule: Force non-working days to null if shift changes
          if (updates.shift && updates.shift !== part.Shift) {
            const newAnchor = state.shiftSettings[updates.shift];
            if (newAnchor) {
              updatedPart.DailyRecords = updatedPart.DailyRecords.map(record => {
                const targetDate = record.Date ? parseISOLocal(record.Date) : null;
                if (targetDate && !isWorkingDay(targetDate, newAnchor)) {
                  return { ...record, Target: null };
                }
                return record;
              });
            }
          }

          return updatedPart;
        });

        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              Weeks: {
                ...dept.Weeks,
                [weekId]: {
                  ...week,
                  Parts: updatedParts
                }
              }
            }
          },
          dirtyRows: {
            ...state.dirtyRows,
            [rowId]: true
          }
        };
      }),

      updatePartGroupIdentity: (departmentName, weekId, groupId, partNumber) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.Weeks[weekId]) return state;

        const week = dept.Weeks[weekId];
        const updatedParts = week.Parts.map(part => {
          if (part.GroupId !== groupId) return part;
          return { ...part, PartNumber: partNumber };
        });

        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              Weeks: {
                ...dept.Weeks,
                [weekId]: {
                  ...week,
                  Parts: updatedParts
                }
              }
            }
          }
        };
      }),

      updateDailyRecord: (departmentName, weekId, rowId, dayOfWeek, field, value) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.Weeks[weekId]) return state;

        const week = dept.Weeks[weekId];
        const updatedParts = week.Parts.map(part => {
          if (part.Id !== rowId) return part;
          
          const targetField = field;

          return {
            ...part,
            DailyRecords: part.DailyRecords.map(record => {
              if (record.DayOfWeek !== dayOfWeek) return record;
              
              return { ...record, [targetField]: value };
            })
          };
        });

        return {
           departments: {
             ...state.departments,
             [departmentName]: {
               ...dept,
               Weeks: {
                 ...dept.Weeks,
                 [weekId]: {
                   ...week,
                   Parts: updatedParts
                 }
               }
             }
           },
           dirtyRows: {
             ...state.dirtyRows,
             [rowId]: true
           }
         };
      }),

      importWeeklyCsv: (departmentName, weekId, data) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.Weeks[weekId]) return state;

        const week = dept.Weeks[weekId];
        
        // Ensure imported data has dates populated and IDs
        const augmentedData = data.map(part => ({
          ...part,
          Id: part.Id || crypto.randomUUID(),
          DailyRecords: part.DailyRecords.map(record => ({
            ...record,
            Date: record.Date || getISODateForDay(weekId, record.DayOfWeek)
          }))
        }));
        
        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              Weeks: {
                ...dept.Weeks,
                [weekId]: {
                  ...week,
                  Parts: augmentedData 
                }
              }
            }
          }
        };
      }),

      bulkImportCsv: (groups) => set((state) => {
        let newDepartments = { ...state.departments };

        groups.forEach(group => {
          const dept = newDepartments[group.DepartmentName];
          if (!dept) return; // Ignore if department doesn't exist

          // Find existing week by label
          let existingWeekId: string | null = null;
          for (const [id, w] of Object.entries(dept.Weeks)) {
            if (w.WeekLabel === group.WeekLabel) {
              existingWeekId = id;
              break;
            }
          }

          const weekIdToUse = existingWeekId || `week-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          // Ensure imported data has dates populated and IDs
          const augmentedParts = group.Parts.map(part => ({
            ...part,
            Id: part.Id || crypto.randomUUID(),
            DailyRecords: part.DailyRecords.map(record => ({
              ...record,
              Date: record.Date || getISODateForDay(weekIdToUse, record.DayOfWeek)
            }))
          }));

          newDepartments = {
            ...newDepartments,
            [group.DepartmentName]: {
              ...dept,
              Weeks: {
                ...dept.Weeks,
                [weekIdToUse]: {
                  WeekId: weekIdToUse,
                  WeekLabel: group.WeekLabel,
                  Parts: augmentedParts
                }
              }
            }
          };
        });

        return { departments: newDepartments };
      }),

      fetchFromDb: async (connectionString: string) => {
        set({ isLoading: true, error: null });
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const rawData = await invoke<SQLDeliveryData[]>('get_scorecard_data', { connectionString });
          
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
              // Try to preserve existing week label if it exists in current state
              const currentState = get();
              const existingDept = currentState.departments[dept];
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
                Shift,
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
          
          set({ departments: newDepartments, isLoading: false });
        } catch (err: any) {
          set({ error: err.toString(), isLoading: false });
        }
      },

      syncToDb: async (connectionString: string, departmentName?: string, weekId?: string) => {
        const { departments, dirtyRows } = get();
        const records: any[] = [];
        const syncedRowIds = new Set<string>();
        
        Object.values(departments).forEach(dept => {
          // If we are scoped, only collect records for that department
          if (departmentName && dept.DepartmentName !== departmentName) return;

          Object.values(dept.Weeks).forEach(week => {
            // If we are scoped, only collect records for that week
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
        
        if (records.length === 0) return; // Nothing to sync

        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('upsert_scorecard_data', { connectionString, records });
          
          set((state) => {
            const nextDirtyRows = { ...state.dirtyRows };
            syncedRowIds.forEach(id => delete nextDirtyRows[id]);
            return { dirtyRows: nextDirtyRows };
          });
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        }
      },

      saveRecordToDb: async (connectionString: string, departmentName: string, weekId: string, rowId: string, dayOfWeek: DayOfWeek) => {
        const { departments } = get();
        const dept = departments[departmentName];
        if (!dept || !dept.Weeks[weekId]) return;

        const week = dept.Weeks[weekId];
        const part = week.Parts.find(p => p.Id === rowId);
        if (!part) return;

        const record = part.DailyRecords.find(r => r.DayOfWeek === dayOfWeek);
        if (!record) return;

        set({ syncStatus: 'saving', error: null });

        try {
          const { invoke } = await import('@tauri-apps/api/core');
          
          // Construct the DB record. Note the field mapping to ScorecardRow in Rust
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

          await invoke('upsert_scorecard_data', { 
            connectionString: connectionString, 
            records: [dbRecord] 
          });
          
          set((state) => {
            const nextDirtyRows = { ...state.dirtyRows };
            delete nextDirtyRows[part.Id];
            return { syncStatus: 'saved', dirtyRows: nextDirtyRows };
          });
        } catch (err: any) {
          console.error("Auto-save failed:", err);
          set({ syncStatus: 'error', error: err.toString() });
          throw err;
        }
      },

      saveRowToDb: async (connectionString: string, departmentName: string, weekId: string, rowId: string) => {
        const { departments } = get();
        const dept = departments[departmentName];
        if (!dept || !dept.Weeks[weekId]) return;

        const week = dept.Weeks[weekId];
        const part = week.Parts.find(p => p.Id === rowId);
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

          await invoke('upsert_scorecard_data', { 
            connectionString: connectionString, 
            records: records 
          });
          
          set((state) => {
            const nextDirtyRows = { ...state.dirtyRows };
            delete nextDirtyRows[part.Id];
            return { syncStatus: 'saved', dirtyRows: nextDirtyRows };
          });
        } catch (err: any) {
          console.error("Auto-save row failed:", err);
          set({ syncStatus: 'error', error: err.toString() });
          throw err;
        }
      },

      deletePartFromDb: async (connectionString, departmentName, weekId, partNumber, shift) => {
        set({ syncStatus: 'saving', error: null });
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('delete_scorecard_row', { 
            connectionString, 
            Department: departmentName, 
            WeekIdentifier: weekId, 
            PartNumber: partNumber, 
            Shift: shift 
          });
          set({ syncStatus: 'saved' });
        } catch (err: any) {
          console.error("Delete record failed:", err);
          set({ syncStatus: 'error', error: err.toString() });
          throw err;
        }
      },

      updateShiftSettings: (shift, anchorDate) => set((state) => ({
        shiftSettings: {
          ...state.shiftSettings,
          [shift]: anchorDate
        }
      }))
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
              if (dept.weeks && !dept.Weeks) {
                dept.Weeks = dept.weeks;
                delete dept.weeks;
              }
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
                          // Note: Use undefined check because Actual/Target can be null
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
);
