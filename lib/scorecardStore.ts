import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getISODateForDay } from './dateUtils';

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface DailyScorecardRecord {
  dayOfWeek: DayOfWeek;
  actual: number | null; 
  target: number | null; 
  wipAvailable?: number;
  date?: string;       // YYYY-MM-DD
  reasonCode?: string | null;
}

export interface PartScorecard {
  partNumber: string;
  shift: string;
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
  isLoading: boolean;
  error: string | null;
}

interface ScorecardActions {
  addDepartment: (departmentName: string) => void;
  removeDepartment: (departmentName: string) => void;
  addWeek: (departmentName: string, weekId: string, weekLabel: string) => void;
  deleteWeek: (departmentName: string, weekId: string) => void;
  addPartNumber: (departmentName: string, weekId: string, partNumber: string, shift: string) => void;
  removePartNumber: (departmentName: string, weekId: string, partNumber: string, shift: string) => void;
  updateDailyRecord: (
    departmentName: string, 
    weekId: string, 
    partNumber: string, 
    shift: string,
    dayOfWeek: DayOfWeek, 
    field: keyof DailyScorecardRecord, 
    value: any
  ) => void;
  importWeeklyCsv: (departmentName: string, weekId: string, data: PartScorecard[]) => void;
  bulkImportCsv: (groups: BulkImportGroup[]) => void;
  fetchFromDb: (connectionString: string) => Promise<void>;
  syncToDb: (connectionString: string) => Promise<void>;
}

export type ScorecardStore = ScorecardState & ScorecardActions;

const emptyDailyRecords = (weekId: string): DailyScorecardRecord[] => [
  { dayOfWeek: 'Mon', actual: null, target: null, date: getISODateForDay(weekId, 'Mon') },
  { dayOfWeek: 'Tue', actual: null, target: null, date: getISODateForDay(weekId, 'Tue') },
  { dayOfWeek: 'Wed', actual: null, target: null, date: getISODateForDay(weekId, 'Wed') },
  { dayOfWeek: 'Thu', actual: null, target: null, date: getISODateForDay(weekId, 'Thu') },
  { dayOfWeek: 'Fri', actual: null, target: null, date: getISODateForDay(weekId, 'Fri') },
  { dayOfWeek: 'Sat', actual: null, target: null, date: getISODateForDay(weekId, 'Sat') },
  { dayOfWeek: 'Sun', actual: null, target: null, date: getISODateForDay(weekId, 'Sun') },
];


export const useScorecardStore = create<ScorecardStore>()(
  persist(
    (set, get) => ({
      departments: {},
      isLoading: false,
      error: null,

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

      addPartNumber: (departmentName, weekId, partNumber, shift) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        
        // Don't add if part+shift combination already exists
        if (week.parts.some(p => p.partNumber === partNumber && p.shift === shift)) {
          return state;
        }

        const newPart: PartScorecard = {
          partNumber,
          shift,
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

      removePartNumber: (departmentName, weekId, partNumber, shift) => set((state) => {
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
                   parts: week.parts.filter(p => !(p.partNumber === partNumber && p.shift === shift))
                 }
               }
             }
           }
         };
      }),

      updateDailyRecord: (departmentName, weekId, partNumber, shift, dayOfWeek, field, value) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        const updatedParts = week.parts.map(part => {
          if (part.partNumber !== partNumber || part.shift !== shift) return part;
          
          return {
            ...part,
            dailyRecords: part.dailyRecords.map(record => {
              if (record.dayOfWeek !== dayOfWeek) return record;
              
              return { ...record, [field]: value };
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
            date: record.date || getISODateForDay(weekId, record.dayOfWeek)
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
              date: record.date || getISODateForDay(weekIdToUse, record.dayOfWeek)
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

      fetchFromDb: async (connectionString: string) => {
        set({ isLoading: true, error: null });
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const rawData = await invoke<any[]>('get_scorecard_data', { connectionString });
          
          const newDepartments: Record<string, DepartmentScorecard> = {};
          
          rawData.forEach(row => {
            const dept = row.department;
            const weekId = row.weekIdentifier;
            const pNum = row.partNumber;
            
            if (!newDepartments[dept]) {
              newDepartments[dept] = { departmentName: dept, weeks: {} };
            }
            
            if (!newDepartments[dept].weeks[weekId]) {
              // We need the week label. For now, we'll try to find it or generate one.
              // In a real app, we might want to store the label in the DB too.
              // For simplicity, let's assume the Row has weekLabel if we added it, 
              // but my struct didn't have it. I'll use weekId as label if missing.
              newDepartments[dept].weeks[weekId] = { 
                weekId, 
                weekLabel: weekId, // Fallback
                parts: [] 
              };
            }
            
            const week = newDepartments[dept].weeks[weekId];
            const shift = row.shift || 'A'; // Default to 'A' if null
            let part = week.parts.find(p => p.partNumber === pNum && p.shift === shift);
            
            if (!part) {
              part = {
                partNumber: pNum,
                shift,
                dailyRecords: [
                  { dayOfWeek: 'Mon', actual: null, target: null, date: getISODateForDay(weekId, 'Mon') },
                  { dayOfWeek: 'Tue', actual: null, target: null, date: getISODateForDay(weekId, 'Tue') },
                  { dayOfWeek: 'Wed', actual: null, target: null, date: getISODateForDay(weekId, 'Wed') },
                  { dayOfWeek: 'Thu', actual: null, target: null, date: getISODateForDay(weekId, 'Thu') },
                  { dayOfWeek: 'Fri', actual: null, target: null, date: getISODateForDay(weekId, 'Fri') },
                  { dayOfWeek: 'Sat', actual: null, target: null, date: getISODateForDay(weekId, 'Sat') },
                  { dayOfWeek: 'Sun', actual: null, target: null, date: getISODateForDay(weekId, 'Sun') },
                ]
              };
              week.parts.push(part);
            }
            
            const record = part.dailyRecords.find(d => d.dayOfWeek === row.dayOfWeek);
            if (record) {
              record.actual = row.actual;
              record.target = row.target;
              record.date = row.date;
              record.reasonCode = row.reasonCode;
            }
          });
          
          set({ departments: newDepartments, isLoading: false });
        } catch (err: any) {
          set({ error: err.toString(), isLoading: false });
        }
      },

      syncToDb: async (connectionString: string) => {
        const { departments } = get();
        const records: any[] = [];
        
        Object.values(departments).forEach(dept => {
          Object.values(dept.weeks).forEach(week => {
            week.parts.forEach(part => {
              part.dailyRecords.forEach(record => {
                records.push({
                  department: dept.departmentName,
                  weekIdentifier: week.weekId, // Use weekId for DB
                  partNumber: part.partNumber,
                  shift: part.shift,
                  dayOfWeek: record.dayOfWeek,
                  target: record.target,
                  actual: record.actual,
                  date: record.date,
                  reasonCode: record.reasonCode
                });
              });
            });
          });
        });
        
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('upsert_scorecard_data', { connectionString, records });
        } catch (err: any) {
          set({ error: err.toString() });
          throw err;
        }
      }

    }),
    {
      name: 'scorecard-storage', // Key for local storage persistence
    }
  )
);
