import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface DailyScorecardRecord {
  dayOfWeek: DayOfWeek;
  actual: number | null; 
  target: number | null; 
  reasonCode: string; // Required if actual < target
  wipAvailable?: number;
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

export interface ScorecardState {
  departments: Record<string, DepartmentScorecard>;
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
}

export type ScorecardStore = ScorecardState & ScorecardActions;

const emptyDailyRecords = (): DailyScorecardRecord[] => [
  { dayOfWeek: 'Mon', actual: null, target: null, reasonCode: '' },
  { dayOfWeek: 'Tue', actual: null, target: null, reasonCode: '' },
  { dayOfWeek: 'Wed', actual: null, target: null, reasonCode: '' },
  { dayOfWeek: 'Thu', actual: null, target: null, reasonCode: '' },
  { dayOfWeek: 'Fri', actual: null, target: null, reasonCode: '' },
  { dayOfWeek: 'Sat', actual: null, target: null, reasonCode: '' },
  { dayOfWeek: 'Sun', actual: null, target: null, reasonCode: '' },
];


export const useScorecardStore = create<ScorecardStore>()(
  persist(
    (set) => ({
      departments: {},

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
          dailyRecords: emptyDailyRecords()
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
        
        return {
          departments: {
            ...state.departments,
            [departmentName]: {
              ...dept,
              weeks: {
                ...dept.weeks,
                [weekId]: {
                  ...week,
                  parts: data // completely replace existing parts for this week
                }
              }
            }
          }
        };
      })

    }),
    {
      name: 'scorecard-storage', // Key for local storage persistence
    }
  )
);
