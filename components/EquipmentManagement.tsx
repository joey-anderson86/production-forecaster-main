import React, { useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Drawer,
  TextInput,
  NumberInput,
  Switch,
  ActionIcon,
  Select,
  Group,
  Title,
  Text,
  Badge,
  Stack,
  Paper,
  Box,
  Divider,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconEdit, IconTrash, IconPlus, IconDeviceDesktopAnalytics } from '@tabler/icons-react';
import dayjs from 'dayjs';

// --- TypeScript Interfaces ---

export interface EquipmentRecord {
  id: string;
  machineId: string;
  process: string;
  baseDailyHours: number;
  isActive: boolean;
}

export interface DowntimeEvent {
  id: string;
  machineId: string;
  eventType: 'PM' | 'Repair' | 'Calibration';
  startDate: Date | null;
  endDate: Date | null;
  description: string;
}

// --- Mock Data ---

const INITIAL_EQUIPMENT: EquipmentRecord[] = [
  { id: '1', machineId: 'CNC-01', process: 'Machining', baseDailyHours: 24, isActive: true },
  { id: '2', machineId: 'MOLD-05', process: 'Molding', baseDailyHours: 16, isActive: true },
  { id: '3', machineId: 'ASSY-12', process: 'Assembly', baseDailyHours: 8, isActive: false },
];

const INITIAL_DOWNTIME: DowntimeEvent[] = [
  {
    id: 'd1',
    machineId: 'CNC-01',
    eventType: 'PM',
    startDate: dayjs().add(2, 'days').toDate(),
    endDate: dayjs().add(3, 'days').toDate(),
    description: 'Quarterly Servicing',
  },
];

// --- Sub-Component: Equipment Detail & Downtime Drawer ---

interface EquipmentDetailDrawerProps {
  opened: boolean;
  onClose: () => void;
  equipment: EquipmentRecord | null;
  onUpdateEquipment: (updated: EquipmentRecord) => void;
  downtimeEvents: DowntimeEvent[];
  onAddDowntime: (event: Omit<DowntimeEvent, 'id'>) => void;
  onDeleteDowntime: (eventId: string) => void;
}

function EquipmentDetailDrawer({
  opened,
  onClose,
  equipment,
  onUpdateEquipment,
  downtimeEvents,
  onAddDowntime,
  onDeleteDowntime,
}: EquipmentDetailDrawerProps) {
  // State for Add Downtime Form
  const [downtimeDates, setDowntimeDates] = useState<[Date | null, Date | null]>([null, null]);
  const [eventType, setEventType] = useState<string | null>('PM');
  const [description, setDescription] = useState('');

  if (!equipment) return null;

  const relevantDowntime = downtimeEvents.filter((d) => d.machineId === equipment.machineId);

  const handleUpdateBaseHours = (val: number | string) => {
    if (typeof val === 'number') {
      onUpdateEquipment({ ...equipment, baseDailyHours: val });
    }
  };

  const handleUpdateProcess = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdateEquipment({ ...equipment, process: e.currentTarget.value });
  };

  const handleAddDowntime = () => {
    if (!downtimeDates[0] || !downtimeDates[1] || !eventType) return;
    onAddDowntime({
      machineId: equipment.machineId,
      eventType: eventType as DowntimeEvent['eventType'],
      startDate: downtimeDates[0],
      endDate: downtimeDates[1],
      description,
    });
    // Reset Form
    setDowntimeDates([null, null]);
    setEventType('PM');
    setDescription('');
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={
        <Group>
          <IconDeviceDesktopAnalytics size={24} />
          <Title order={3}>{equipment.machineId} Details</Title>
        </Group>
      }
      position="right"
      size="lg"
      padding="md"
    >
      <Stack gap="xl">
        {/* Base Settings Section */}
        <Paper withBorder p="md" radius="md">
          <Title order={5} mb="md">General Settings</Title>
          <Group grow align="flex-start">
            <TextInput
              label="Process (Department)"
              value={equipment.process}
              onChange={handleUpdateProcess}
            />
            <NumberInput
              label="Base Daily Hours"
              description="Capacity between 0 and 24 hours"
              value={equipment.baseDailyHours}
              onChange={handleUpdateBaseHours}
              min={0}
              max={24}
              clampBehavior="strict"
              allowNegative={false}
            />
          </Group>
        </Paper>

        <Divider />

        {/* Downtime Sub-Table Section */}
        <Box>
          <Title order={5} mb="sm">Planned Downtime & PMs</Title>
          {relevantDowntime.length === 0 ? (
            <Text c="dimmed" size="sm" mb="md">No downtime events found for this machine.</Text>
          ) : (
            <Table mb="md" striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Dates</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {relevantDowntime.map((event) => (
                  <Table.Tr key={event.id}>
                    <Table.Td>
                      <Badge
                        color={event.eventType === 'PM' ? 'blue' : event.eventType === 'Repair' ? 'red' : 'orange'}
                      >
                        {event.eventType}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {dayjs(event.startDate).format('MMM D')} - {dayjs(event.endDate).format('MMM D')}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" truncate="end" maw={150}>
                        {event.description}
                      </Text>
                    </Table.Td>
                    <Table.Td align="right">
                      <ActionIcon color="red" variant="subtle" onClick={() => onDeleteDowntime(event.id)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Box>

        {/* Add Downtime Form */}
        <Paper withBorder p="md" radius="md" bg="var(--mantine-color-gray-0)">
          <Title order={6} mb="md">Add Downtime Event</Title>
          <Stack gap="sm">
            <DatePickerInput
              type="range"
              label="Downtime Range"
              placeholder="Pick dates"
              value={downtimeDates}
              onChange={setDowntimeDates}
              clearable
            />
            <Select
              label="Event Type"
              data={['PM', 'Repair', 'Calibration']}
              value={eventType}
              onChange={setEventType}
            />
            <TextInput
              label="Description"
              placeholder="Reason for downtime"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
            <Button
              mt="sm"
              leftSection={<IconPlus size={16} />}
              onClick={handleAddDowntime}
              disabled={!downtimeDates[0] || !downtimeDates[1] || !eventType}
            >
              Add Event
            </Button>
          </Stack>
        </Paper>
      </Stack>
    </Drawer>
  );
}

// --- Main Application Component ---

export function EquipmentManagement() {
  const [equipments, setEquipments] = useState<EquipmentRecord[]>(INITIAL_EQUIPMENT);
  const [downtimeEvents, setDowntimeEvents] = useState<DowntimeEvent[]>(INITIAL_DOWNTIME);

  // Modal State for New Equipment
  const [addModalOpened, setAddModalOpened] = useState(false);
  const [newMachineId, setNewMachineId] = useState('');
  const [newProcess, setNewProcess] = useState('');
  const [newBaseHours, setNewBaseHours] = useState<number | string>(24);

  // Drawer State
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);

  // Derived state
  const selectedEquipment = equipments.find((eq) => eq.id === selectedEquipmentId) || null;

  // Handlers: Main Table Actions
  const handleToggleActive = (id: string, active: boolean) => {
    setEquipments(equipments.map((eq) => (eq.id === id ? { ...eq, isActive: active } : eq)));
  };

  // Handlers: Add New Equipment
  const handleAddEquipment = () => {
    if (!newMachineId || !newProcess) return;

    const newRecord: EquipmentRecord = {
      id: Math.random().toString(36).substring(7),
      machineId: newMachineId,
      process: newProcess,
      baseDailyHours: typeof newBaseHours === 'number' ? newBaseHours : 24,
      isActive: true,
    };

    setEquipments([...equipments, newRecord]);
    setAddModalOpened(false);
    // Reset Form
    setNewMachineId('');
    setNewProcess('');
    setNewBaseHours(24);
  };

  // Handlers: Propagated from Drawer
  const handleUpdateEquipment = (updated: EquipmentRecord) => {
    setEquipments(equipments.map((eq) => (eq.id === updated.id ? updated : eq)));
  };

  const handleAddDowntime = (event: Omit<DowntimeEvent, 'id'>) => {
    const newDowntime: DowntimeEvent = {
      ...event,
      id: Math.random().toString(36).substring(7),
    };
    setDowntimeEvents([...downtimeEvents, newDowntime]);
  };

  const handleDeleteDowntime = (eventId: string) => {
    setDowntimeEvents(downtimeEvents.filter((d) => d.id !== eventId));
  };

  return (
    <Box p="md">
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2}>Equipment Management</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setAddModalOpened(true)}>
          Add New Equipment
        </Button>
      </Group>

      {/* Main Master Data Table */}
      <Paper withBorder radius="md">
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Machine ID</Table.Th>
              <Table.Th>Process</Table.Th>
              <Table.Th>Base Daily Hours</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th align="right">Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {equipments.map((eq) => (
              <Table.Tr key={eq.id}>
                <Table.Td>
                  <Text fw={500}>{eq.machineId}</Text>
                </Table.Td>
                <Table.Td>{eq.process}</Table.Td>
                <Table.Td>{eq.baseDailyHours} hrs</Table.Td>
                <Table.Td>
                  <Switch
                    checked={eq.isActive}
                    onChange={(event) => handleToggleActive(eq.id, event.currentTarget.checked)}
                    color="green"
                    labelPosition="left"
                    label={eq.isActive ? 'Active' : 'Inactive'}
                    size="sm"
                  />
                </Table.Td>
                <Table.Td align="right">
                  <Button
                    variant="light"
                    size="xs"
                    leftSection={<IconEdit size={14} />}
                    onClick={() => setSelectedEquipmentId(eq.id)}
                  >
                    Edit/Manage
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {equipments.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text ta="center" c="dimmed" py="md">
                    No equipment records found.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      {/* Add Equipment Modal */}
      <Modal
        opened={addModalOpened}
        onClose={() => setAddModalOpened(false)}
        title={<Title order={4}>Register New Equipment</Title>}
      >
        <Stack>
          <TextInput
            label="Machine ID"
            placeholder="e.g. PRESS-01"
            value={newMachineId}
            onChange={(e) => setNewMachineId(e.currentTarget.value)}
            required
          />
          <TextInput
            label="Process Area"
            placeholder="e.g. Stamping"
            value={newProcess}
            onChange={(e) => setNewProcess(e.currentTarget.value)}
            required
          />
          <NumberInput
            label="Base Daily Hours"
            description="Operational capacity (0-24)"
            value={newBaseHours}
            onChange={setNewBaseHours}
            min={0}
            max={24}
            clampBehavior="strict"
            allowNegative={false}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setAddModalOpened(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddEquipment}>Save Equipment</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Details & Downtime Drawer */}
      <EquipmentDetailDrawer
        opened={!!selectedEquipmentId}
        onClose={() => setSelectedEquipmentId(null)}
        equipment={selectedEquipment}
        onUpdateEquipment={handleUpdateEquipment}
        downtimeEvents={downtimeEvents}
        onAddDowntime={handleAddDowntime}
        onDeleteDowntime={handleDeleteDowntime}
      />
    </Box>
  );
}

export default EquipmentManagement;
