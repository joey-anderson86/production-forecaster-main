// Verification script to compare buggy vs fixed date parsing logic.

// Mocking the behavior for a standalone test
function parseISOLocalMock(dateStr) {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isWorkingDayMock(targetDate, anchorDateString) {
  if (!anchorDateString) return true;
  
  const PANAMA_WORKING_DAYS = [0, 1, 4, 5, 6, 9, 10];
  const anchor = parseISOLocalMock(anchorDateString); // NEW FIX
  
  const t = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  
  const diffTime = t.getTime() - a.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  const cycleDay = ((diffDays % 14) + 14) % 14;
  
  return { cycleDay, isWorking: PANAMA_WORKING_DAYS.includes(cycleDay) };
}

function isWorkingDayBuggyMock(targetDate, anchorDateString) {
  if (!anchorDateString) return true;
  
  const PANAMA_WORKING_DAYS = [0, 1, 4, 5, 6, 9, 10];
  const anchor = new Date(anchorDateString); // OLD BUG
  
  const t = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  
  const diffTime = t.getTime() - a.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  const cycleDay = ((diffDays % 14) + 14) % 14;
  
  return { cycleDay, isWorking: PANAMA_WORKING_DAYS.includes(cycleDay) };
}

const anchorStr = '2026-03-23'; // A Monday
const targetDate = new Date(2026, 2, 23); // March 23 local midnight

console.log('Testing Anchor:', anchorStr, 'Target:', targetDate.toDateString());

console.log('\n--- BUGGY VERSION ---');
const buggy = isWorkingDayBuggyMock(targetDate, anchorStr);
console.log('Cycle Day:', buggy.cycleDay, '(Expected 0 if anchor was parsed as March 23)');
console.log('Is Working:', buggy.isWorking);

console.log('\n--- FIXED VERSION ---');
const fixed = isWorkingDayMock(targetDate, anchorStr);
console.log('Cycle Day:', fixed.cycleDay, '(Expected 0)');
console.log('Is Working:', fixed.isWorking);
