import { Table, Title, Text, Group, Box, Divider } from '@mantine/core';

interface HourByHourSheetProps {
  partNumber: string;
  machineId: string;
  shiftTarget: number;
  shiftHours?: number; // Default to 8
  date: string;
  shift: string;
}

export function HourByHourSheet({
  partNumber,
  machineId,
  shiftTarget,
  shiftHours = 8,
  date,
  shift
}: HourByHourSheetProps) {
  // Calculate the hourly run rate
  const hourlyTarget = Math.ceil(shiftTarget / shiftHours);

  // Generate the rows for the shift
  const rows = Array.from({ length: shiftHours }).map((_, index) => {
    const currentHour = index + 1;
    const cumulativeTarget = Math.min(hourlyTarget * currentHour, shiftTarget);

    return (
      <Table.Tr key={currentHour}>
        <Table.Td>{currentHour}</Table.Td>
        <Table.Td>{hourlyTarget}</Table.Td>
        <Table.Td>{cumulativeTarget}</Table.Td>
        <Table.Td>{/* Blank for Operator to write Actual */}</Table.Td>
        <Table.Td>{/* Blank for Operator to write Cumulative Actual */}</Table.Td>
        <Table.Td>{/* Blank for +/- Variance */}</Table.Td>
        <Table.Td>{/* Blank for Reason Codes/Downtime Comments */}</Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Box className="print-only-sheet" p="xl" style={{ backgroundColor: 'white', color: 'black' }}>
      <Group justify="space-between" align="flex-end" mb="md">
        <div>
          <Title order={2}>Production Tracking Sheet</Title>
          <Text c="dimmed">Hour-by-Hour Operator Log</Text>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Text fw={700}>Date: {date}</Text>
          <Text fw={700}>Shift: {shift}</Text>
        </div>
      </Group>
      
      <Divider mb="md" />

      <Group justify="space-between" mb="xl">
        <Text><strong>Part Number:</strong> {partNumber}</Text>
        <Text><strong>Machine:</strong> {machineId}</Text>
        <Text><strong>Total Shift Target:</strong> {shiftTarget} pcs</Text>
        <Text><strong>Run Rate:</strong> {hourlyTarget} pcs/hr</Text>
      </Group>

      <Table withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Hour</Table.Th>
            <Table.Th>Hr Target</Table.Th>
            <Table.Th>Cum. Target</Table.Th>
            <Table.Th>Hr Actual</Table.Th>
            <Table.Th>Cum. Actual</Table.Th>
            <Table.Th>Variance (+/-)</Table.Th>
            <Table.Th>Downtime Notes / Reason Codes</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows}
          {/* Add a totals row at the bottom */}
           <Table.Tr style={{ fontWeight: 'bold', backgroundColor: '#f8f9fa' }}>
            <Table.Td colSpan={2}>SHIFT TOTALS</Table.Td>
            <Table.Td>{shiftTarget}</Table.Td>
            <Table.Td></Table.Td>
            <Table.Td></Table.Td>
            <Table.Td></Table.Td>
            <Table.Td></Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Box>
  );
}
