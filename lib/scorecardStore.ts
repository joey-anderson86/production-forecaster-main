import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getISODateForDay, isWorkingDay } from './dateUtils';

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
  id: string; // New field for stable identity
  partNumber: string;
  shift: string;
  dailyRecords: DailyScorecardRecord[]; // Always length 7
  groupId?: string; // New field for grouping newly added rows
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
  shiftSettings: Record<string, string>; // Shift -> Anchor Date (ISO)
  isLoading: boolean;
  syncStatus: 'saved' | 'saving' | 'error';
  error: string | null;
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
      shiftSettings: {
        'A': '2026-03-23',
        'B': '2026-03-23',
        'C': '2026-03-30',
        'D': '2026-03-30',
      },
      isLoading: false,
      syncStatus: 'saved',
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

      addPartNumber: (departmentName, weekId, partNumber = '', shift = '', groupId?: string) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        
        // Only prevent duplicates if values are provided
        if (partNumber && shift && week.parts.some(p => p.partNumber === partNumber && p.shift === shift)) {
          return state;
        }

        const newPart: PartScorecard = {
          id: crypto.randomUUID(),
          partNumber,
          shift,
          dailyRecords: emptyDailyRecords(weekId),
          groupId
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

      removePartNumber: (departmentName, weekId, rowId) => set((state) => {
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
                   parts: week.parts.filter(p => p.id !== rowId)
                 }
               }
             }
           }
         };
      }),

      updatePartIdentity: (departmentName, weekId, rowId, updates) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        const updatedParts = week.parts.map(part => {
          if (part.id !== rowId) return part;
          
          let updatedPart = { ...part, ...updates };

          // Panama Schedule: Force non-working days to null if shift changes
          if (updates.shift && updates.shift !== part.shift) {
            const newAnchor = state.shiftSettings[updates.shift];
            if (newAnchor) {
              updatedPart.dailyRecords = updatedPart.dailyRecords.map(record => {
                const targetDate = record.date ? new Date(record.date) : null;
                if (targetDate && !isWorkingDay(targetDate, newAnchor)) {
                  return { ...record, target: null };
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

      updatePartGroupIdentity: (departmentName, weekId, groupId, partNumber) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        const updatedParts = week.parts.map(part => {
          if (part.groupId !== groupId) return part;
          return { ...part, partNumber };
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

      updateDailyRecord: (departmentName, weekId, rowId, dayOfWeek, field, value) => set((state) => {
        const dept = state.departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return state;

        const week = dept.weeks[weekId];
        const updatedParts = week.parts.map(part => {
          if (part.id !== rowId) return part;
          
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
        
        // Ensure imported data has dates populated and IDs
        const augmentedData = data.map(part => ({
          ...part,
          id: part.id || crypto.randomUUID(),
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

          // Ensure imported data has dates populated and IDs
          const augmentedParts = group.parts.map(part => ({
            ...part,
            id: part.id || crypto.randomUUID(),
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
                id: crypto.randomUUID(),
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

      syncToDb: async (connectionString: string, departmentName?: string, weekId?: string) => {
        const { departments } = get();
        const { invoke } = await import('@tauri-apps/api/core');
        const records: any[] = [];
        
        // If a specific week is targeted, clear its data in DB first to handle any deletions
        if (departmentName && weekId) {
          try {
            await invoke('delete_scorecard_week', { 
              connectionString, 
              department: departmentName, 
              weekIdentifier: weekId 
            });
          } catch (err) {
            console.error("Failed to clear week data before sync:", err);
            // We continue anyway—the upsert might still work for edits/adds
          }
        }
        
        Object.values(departments).forEach(dept => {
          // If we are scoped, only collect records for that department
          if (departmentName && dept.departmentName !== departmentName) return;

          Object.values(dept.weeks).forEach(week => {
            // If we are scoped, only collect records for that week
            if (weekId && week.weekId !== weekId) return;

            week.parts.forEach(part => {
              part.dailyRecords.forEach(record => {
                records.push({
                  department: dept.departmentName,
                  weekIdentifier: week.weekId,
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
      },

      saveRecordToDb: async (connectionString: string, departmentName: string, weekId: string, rowId: string, dayOfWeek: DayOfWeek) => {
        const { departments } = get();
        const dept = departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return;

        const week = dept.weeks[weekId];
        const part = week.parts.find(p => p.id === rowId);
        if (!part) return;

        const record = part.dailyRecords.find(r => r.dayOfWeek === dayOfWeek);
        if (!record) return;

        set({ syncStatus: 'saving', error: null });

        try {
          const { invoke } = await import('@tauri-apps/api/core');
          
          // Construct the DB record. Note the field mapping to ScorecardRow in Rust
          const dbRecord = {
            department: departmentName,
            weekIdentifier: weekId,
            partNumber: part.partNumber || "", // Allow empty string but better to gate at UI
            dayOfWeek: record.dayOfWeek,
            target: record.target,
            actual: record.actual,
            date: record.date,
            shift: part.shift || "",
            reasonCode: record.reasonCode
          };

          await invoke('upsert_scorecard_data', { 
            connectionString: connectionString, 
            records: [dbRecord] 
          });
          
          set({ syncStatus: 'saved' });
        } catch (err: any) {
          console.error("Auto-save failed:", err);
          set({ syncStatus: 'error', error: err.toString() });
          throw err;
        }
      },

      saveRowToDb: async (connectionString: string, departmentName: string, weekId: string, rowId: string) => {
        const { departments } = get();
        const dept = departments[departmentName];
        if (!dept || !dept.weeks[weekId]) return;

        const week = dept.weeks[weekId];
        const part = week.parts.find(p => p.id === rowId);
        if (!part || !part.partNumber || !part.shift) return;

        set({ syncStatus: 'saving', error: null });

        try {
          const { invoke } = await import('@tauri-apps/api/core');
          
          const records = part.dailyRecords.map(record => ({
            department: departmentName,
            weekIdentifier: weekId,
            partNumber: part.partNumber,
            dayOfWeek: record.dayOfWeek,
            target: record.target,
            actual: record.actual,
            date: record.date,
            shift: part.shift,
            reasonCode: record.reasonCode
          }));

          await invoke('upsert_scorecard_data', { 
            connectionString: connectionString, 
            records: records 
          });
          
          set({ syncStatus: 'saved' });
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
            department: departmentName, 
            weekIdentifier: weekId, 
            partNumber: partNumber, 
            shift: shift 
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
      name: 'scorecard-storage', // Key for local storage persistence
    }
  )
);
