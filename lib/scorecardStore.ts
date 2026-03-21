import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getISODateForDay, getNumericDateForDay } from './dateUtils';

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface DailyScorecardRecord {
  dayOfWeek: DayOfWeek;
  actual: number | null; 
  target: number | null; 
  reasonCode: string; // Required if actual < target
  wipAvailable?: number;
  date?: string;       // YYYY-MM-DD
  numericDate?: number; // YYYYMMDD
}

export interface PartScorecard {
  partNumber: string;
  dailyRecords: DailyScorecardRecord[]; // Always length 7
}

export interface WeeklyScorecard {
  weekId: string; // e.g., "2026-w41"
  weekLabel: string; // e.g., "Week 41 (Oct 5 - Oct 11)"
  parts: PartScorecard[];
}

export interface DepartmentScorecard {
  departmentName: string;
  weeks: Record<string, WeeklyScorecard>; // Key is weekId
}

export interface BulkImportGroup {
  departmentName: string;
  weekLabel: string;
  parts: PartScorecard[];
}

export interface ScorecardState {
  departments: Record<string, DepartmentScorecard>;
  syncFilePath: string | null;
  lastSyncStatus: 'synced' | 'syncing' | 'error' | null;
  lastSyncTime: string | null;
}

interface ScorecardActions {
  addDepartment: (departmentName: string) => void;
  removeDepartment: (departmentName: string) => void;
  addWeek: (departmentName: string, weekId: string, weekLabel: string) => void;
  deleteWeek: (departmentName: string, weekId: string) => void;
  addPartNumber: (departmentName: string, weekId: string, partNumber: string) => void;
  removePartNumber: (departmentName: string, weekId: string, partNumber: string) => void;
  updateDailyRecord: (
    departmentName: string, 
    weekId: string, 
    partNumber: string, 
    dayOfWeek: DayOfWeek, 
    field: keyof DailyScorecardRecord, 
    value: any
  ) => void;
  importWeeklyCsv: (departmentName: string, weekId: string, data: PartScorecard[]) => void;
  bulkImportCsv: (groups: BulkImportGroup[]) => void;
  setSyncFilePath: (path: string | null) => void;
  setSyncStatus: (status: 'synced' | 'syncing' | 'error' | null) => void;
}

export type ScorecardStore = ScorecardState & ScorecardActions;

const emptyDailyRecords = (weekId: string): DailyScorecardRecord[] => [
  { dayOfWeek: 'Mon', actual: null, target: null, reasonCode: '', date: getISODateForDay(weekId, 'Mon'), numericDate: getNumericDateForDay(weekId, 'Mon') },
  { dayOfWeek: 'Tue', actual: null, target: null, reasonCode: '', date: getISODateForDay(weekId, 'Tue'), numericDate: getNumericDateForDay(weekId, 'Tue') },
  { dayOfWeek: 'Wed', actual: null, target: null, reasonCode: '', date: getISODateForDay(weekId, 'Wed'), numericDate: getNumericDateForDay(weekId, 'Wed') },
  { dayOfWeek: 'Thu', actual: null, target: null, reasonCode: '', date: getISODateForDay(weekId, 'Thu'), numericDate: getNumericDateForDay(weekId, 'Thu') },
  { dayOfWeek: 'Fri', actual: null, target: null, reasonCode: '', date: getISODateForDay(weekId, 'Fri'), numericDate: getNumericDateForDay(weekId, 'Fri') },
  { dayOfWeek: 'Sat', actual: null, target: null, reasonCode: '', date: getISODateForDay(weekId, 'Sat'), numericDate: getNumericDateForDay(weekId, 'Sat') },
  { dayOfWeek: 'Sun', actual: null, target: null, reasonCode: '', date: getISODateForDay(weekId, 'Sun'), numericDate: getNumericDateForDay(weekId, 'Sun') },
];


export const useScorecardStore = create<ScorecardStore>()(
  persist(
    (set) => ({
      departments: {},
      syncFilePath: null,
      lastSyncStatus: null,
      lastSyncTime: null,

      addDepartment: (departmentName) => set((state) => {
        if (state.departments[departmentName]) return state;
        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              departmentName,
              weeks: {}
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
              weeks: {
                ...dept.weeks,
                [weekId]: dept.weeks[weekId] || { weekId, weekLabel, parts: [] }
              }
            }
          }
        };
      }),

      deleteWeek: (departmentName, weekId) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const newWeeks = { ...dept.weeks };
        delete newWeeks[weekId];

        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              weeks: newWeeks
            }
          }
        };
      }),

      addPartNumber: (departmentName, weekId, partNumber) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        
        // Don't add if part already exists
        if (week.parts.some(p => p.partNumber === partNumber)) {
          return state;
        }

        const newPart: PartScorecard = {
          partNumber,
          dailyRecords: emptyDailyRecords(weekId)
        };

        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              weeks: {
                ...dept.weeks,
                [weekId]: {
                  ...week,
                  parts: [...week.parts, newPart]
                }
              }
            }
          }
        };
      }),

      removePartNumber: (departmentName, weekId, partNumber) => set((state) => {
         const dept = state.departments[departmentName];
         if (!dept || !dept.weeks[weekId]) return state;

         const week = dept.weeks[weekId];
         return {
           departments: {
             ...state.departments,
             [departmentName]: {
               ...dept,
               weeks: {
                 ...dept.weeks,
                 [weekId]: {
                   ...week,
                   parts: week.parts.filter(p => p.partNumber !== partNumber)
                 }
               }
             }
           }
         };
      }),

      updateDailyRecord: (departmentName, weekId, partNumber, dayOfWeek, field, value) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        const updatedParts = week.parts.map(part => {
          if (part.partNumber !== partNumber) return part;
          
          return {
            ...part,
            dailyRecords: part.dailyRecords.map(record => {
              if (record.dayOfWeek !== dayOfWeek) return record;
              
              const newRecord = { ...record, [field]: value };
              // if actual is not less than target, or values are missing, clear the reason
              if (newRecord.actual !== null && newRecord.target !== null && newRecord.actual >= newRecord.target) {
                newRecord.reasonCode = '';
              }
              
              return newRecord;
            })
          };
        });

        return {
           departments: {
             ...state.departments,
             [departmentName]: {
               ...dept,
               weeks: {
                 ...dept.weeks,
                 [weekId]: {
                   ...week,
                   parts: updatedParts
                 }
               }
             }
           }
         };
      }),

      importWeeklyCsv: (departmentName, weekId, data) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        
        // Ensure imported data has dates populated
        const augmentedData = data.map(part => ({
          ...part,
          dailyRecords: part.dailyRecords.map(record => ({
            ...record,
            date: record.date || getISODateForDay(weekId, record.dayOfWeek),
            numericDate: record.numericDate || getNumericDateForDay(weekId, record.dayOfWeek)
          }))
        }));
        
        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              weeks: {
                ...dept.weeks,
                [weekId]: {
                  ...week,
                  parts: augmentedData 
                }
              }
            }
          }
        };
      }),

      bulkImportCsv: (groups) => set((state) => {
        let newDepartments = { ...state.departments };

        groups.forEach(group => {
          const dept = newDepartments[group.departmentName];
          if (!dept) return; // Ignore if department doesn't exist

          // Find existing week by label
          let existingWeekId: string | null = null;
          for (const [id, w] of Object.entries(dept.weeks)) {
            if (w.weekLabel === group.weekLabel) {
              existingWeekId = id;
              break;
            }
          }

          const weekIdToUse = existingWeekId || `week-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          // Ensure imported data has dates populated
          const augmentedParts = group.parts.map(part => ({
            ...part,
            dailyRecords: part.dailyRecords.map(record => ({
              ...record,
              date: record.date || getISODateForDay(weekIdToUse, record.dayOfWeek),
              numericDate: record.numericDate || getNumericDateForDay(weekIdToUse, record.dayOfWeek)
            }))
          }));

          newDepartments = {
            ...newDepartments,
            [group.departmentName]: {
              ...dept,
              weeks: {
                ...dept.weeks,
                [weekIdToUse]: {
                  weekId: weekIdToUse,
                  weekLabel: group.weekLabel,
                  parts: augmentedParts
                }
              }
            }
          };
        });

        return { departments: newDepartments };
      }),

      setSyncFilePath: (path: string | null) => set({ syncFilePath: path }),
      setSyncStatus: (status: 'synced' | 'syncing' | 'error' | null) => set({ 
        lastSyncStatus: status,
        lastSyncTime: status === 'synced' ? new Date().toLocaleTimeString() : null
      })

    }),
    {
      name: 'scorecard-storage', // Key for local storage persistence
    }
  )
);
