import React, { useState, useEffect } from 'react';
import { Draggable, DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd';
import { Portal, Paper, Text, Group, Stack, Tooltip, HoverCard, Badge, Button, Popover, NumberInput, Box, Menu } from '@mantine/core';
import { IconClock, IconArrowsSplit } from '@tabler/icons-react';
import { JobBlock } from '@/lib/types';

const SHIFT_COLORS: Record<string, string> = {
  'A': 'blue.5',
  'B': 'green.5',
  'C': 'orange.5',
  'D': 'violet.5'
};

export interface JobCardProps {
  job: JobBlock;
  index: number;
  weekDates: Date[];
  columnIndex: number; // -1 for unassigned, 0-6 for Mon-Sun
  shiftSettings: Record<string, string>;
  onUpdateQty?: (jobId: string, newQty: number) => void;
  onPreviewChange?: (jobId: string, newQty: number | null) => void;
  onSplitJob?: (jobId: string) => void;
}

const JobCard = ({
  job,
  index,
  weekDates,
  columnIndex,
  shiftSettings,
  onUpdateQty,
  onPreviewChange,
  onSplitJob
}: JobCardProps) => {
  const [editQty, setEditQty] = useState<number>(job.TargetQty);
  const [opened, setOpened] = useState(false);
  const [contextMenuOpened, setContextMenuOpened] = useState(false);

  // Update local editQty if the job's TargetQty changes externally
  useEffect(() => {
    setEditQty(job.TargetQty);
  }, [job.TargetQty]);

  const shiftColor = SHIFT_COLORS[job.Shift] || 'gray.5';
  const processingHrs = ((editQty * (job.ProcessingTimeMins || 0)) / 60).toFixed(1);

  const jobDateStr = job.Id.split('|')[2];
  
  const isMoved = job.OriginalDate && job.OriginalShift && (jobDateStr !== job.OriginalDate || job.Shift !== job.OriginalShift);
  
  let isEarly = false;
  let isShortfall = false;

  if (isMoved && job.OriginalDate && job.OriginalShift) {
    const SHIFT_ORDER = ['A', 'B', 'C', 'D'];
    if (jobDateStr < job.OriginalDate) {
      isEarly = true;
    } else if (jobDateStr > job.OriginalDate) {
      isShortfall = true;
    } else {
      // Same date, check shift
      const currIdx = SHIFT_ORDER.indexOf(job.Shift);
      const origIdx = SHIFT_ORDER.indexOf(job.OriginalShift);
      if (currIdx < origIdx) isEarly = true;
      else if (currIdx > origIdx) isShortfall = true;
    }
  }

  let moveLabel = '';
  if (isMoved) moveLabel = `Originally: SH ${job.OriginalShift} on ${job.OriginalDate}`;

  return (
    <Draggable draggableId={job.Id} index={index}>
      {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => {
        const card = (
          <HoverCard position="right" shadow="md" withinPortal openDelay={200} disabled={snapshot.isDragging}>
            <HoverCard.Target>
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                style={{
                  ...provided.draggableProps.style,
                  marginBottom: 8,
                  zIndex: snapshot.isDragging ? 9999 : 1,
                  cursor: 'grab',
                }}
              >
                <Menu opened={contextMenuOpened} onChange={setContextMenuOpened} shadow="md" width={200} withinPortal>
                  <Menu.Target>
                    <Paper
                      shadow={snapshot.isDragging ? "xl" : "xs"}
                      p={8}
                      withBorder
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenuOpened(true);
                      }}
                      style={{
                        backgroundColor: snapshot.isDragging 
                          ? 'var(--mantine-color-indigo-0)' 
                          : (isShortfall ? 'var(--mantine-color-red-0)' : 'white'),
                        opacity: snapshot.isDragging ? 0.9 : 1,
                        borderRadius: '6px',
                        borderLeftWidth: '3px',
                        borderLeftStyle: 'solid',
                        borderLeftColor: isShortfall 
                          ? 'var(--mantine-color-red-6)' 
                          : `var(--mantine-color-${shiftColor.replace('.', '-')})`,
                        // Maintain width when dragging in Portal
                        width: snapshot.isDragging ? '220px' : '100%',
                      }}
                    >
                      <Stack gap={4}>
                        <Stack gap={2}>
                          <Text 
                            fw={800} 
                            style={{ fontSize: '13px', lineHeight: 1.2 }} 
                            truncate="end"
                            c={isShortfall ? 'red.8' : undefined}
                          >
                            {job.PartNumber}
                          </Text>
                          
                          <Stack gap={4} align="flex-start">
                            {isShortfall && (
                              <Tooltip label="Scheduled after original plan" withinPortal position="top">
                                <Badge size="xs" color="red" variant="filled" fullWidth styles={{ root: { fontSize: '10px', padding: '0 4px', height: 18, fontWeight: 800, justifyContent: 'flex-start' } }}>
                                  SHORTFALL
                                </Badge>
                              </Tooltip>
                            )}
                            {isEarly && (
                              <Tooltip label="Scheduled before original plan" withinPortal position="top">
                                <Badge size="xs" color="green" variant="filled" fullWidth styles={{ root: { fontSize: '10px', padding: '0 4px', height: 18, fontWeight: 800, justifyContent: 'flex-start' } }}>
                                  EARLY
                                </Badge>
                              </Tooltip>
                            )}
                            {isMoved && (
                              <Tooltip label={moveLabel} withinPortal position="top">
                                <Badge size="xs" color="orange" variant="filled" fullWidth styles={{ root: { fontSize: '10px', padding: '0 4px', height: 18, fontWeight: 800, justifyContent: 'flex-start' } }}>
                                  MOVED
                                </Badge>
                              </Tooltip>
                            )}
                          </Stack>
                        </Stack>

                        <Group gap={4} wrap="nowrap" align="center">
                          <Badge
                            size="xs"
                            variant="filled"
                            color={shiftColor.split('.')[0]}
                            styles={{ root: { height: 18, padding: '0 6px', fontSize: '11px', fontWeight: 800 } }}
                          >
                            {job.Shift}
                          </Badge>

                          <Popover
                            opened={opened}
                            onChange={(o) => {
                              setOpened(o);
                              if (!o) {
                                onPreviewChange?.(job.Id, null);
                                setEditQty(job.TargetQty);
                              }
                            }}
                            position="bottom"
                            withArrow
                            shadow="md"
                            withinPortal
                            trapFocus={false}
                          >
                            <Popover.Target>
                              <Badge
                                size="xs"
                                variant="light"
                                color="gray"
                                onClick={(e) => { e.stopPropagation(); setOpened(o => !o); }}
                                style={{ cursor: 'pointer', height: 18, fontSize: '11px', fontWeight: 800 }}
                              >
                                {job.TargetQty.toLocaleString()}
                              </Badge>
                            </Popover.Target>
                            <Popover.Dropdown p={8} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                              <Stack gap={8}>
                                <Text size="10px" fw={700}>Adjust Quantity</Text>
                                <Group gap={4} wrap="nowrap">
                                  <Box style={{ width: 80 }}>
                                    <NumberInput
                                      size="xs"
                                      value={editQty}
                                      onChange={(val) => {
                                        const num = Number(val);
                                        setEditQty(num);
                                        onPreviewChange?.(job.Id, num);
                                      }}
                                      min={1}
                                      step={1}
                                      styles={{ input: { fontSize: '10px', height: 24, minHeight: 24 } }}
                                    />
                                  </Box>
                                  <Button
                                    size="compact-xs"
                                    variant="filled"
                                    color="indigo"
                                    onClick={() => {
                                      onUpdateQty?.(job.Id, editQty);
                                      setOpened(false);
                                    }}
                                  >
                                    Update
                                  </Button>
                                </Group>
                                <Text size="8px" c="dimmed">Current Card: {job.TargetQty}</Text>
                              </Stack>
                            </Popover.Dropdown>
                          </Popover>
                        </Group>

                        <Group gap={3} wrap="nowrap">
                          <IconClock size={12} color="var(--mantine-color-gray-6)" />
                          <Text size="11px" fw={700} c="indigo.7" style={{ letterSpacing: '0.01em' }}>
                            {processingHrs}h
                          </Text>
                        </Group>
                      </Stack>
                    </Paper>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>Card Actions</Menu.Label>
                    <Menu.Item 
                      leftSection={<IconArrowsSplit size={14} />} 
                      onClick={() => onSplitJob?.(job.Id)}
                    >
                      Split into Batches
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </div>
            </HoverCard.Target>
            <HoverCard.Dropdown p="sm">
              <Stack gap="xs">
                <Text size="sm" fw={700} style={{ borderBottom: '1px solid var(--mantine-color-gray-2)', paddingBottom: 4 }}>
                  Job Details
                </Text>
                <Group justify="space-between" mt={4}>
                  <Text size="xs" c="dimmed">Part Number:</Text>
                  <Text size="xs" fw={600}>{job.PartNumber}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Planned Date:</Text>
                  <Text size="xs" fw={600}>{job.OriginalDate || jobDateStr}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Target Qty:</Text>
                  <Text size="xs" fw={600}>{job.TargetQty}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Processing Hrs:</Text>
                  <Text size="xs" fw={600}>{processingHrs} hrs</Text>
                </Group>
                {job.StandardBatchSize && (
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Batch Size:</Text>
                    <Text size="xs" fw={600}>{job.StandardBatchSize}</Text>
                  </Group>
                )}
              </Stack>
            </HoverCard.Dropdown>
          </HoverCard>
        );

        if (snapshot.isDragging) {
          return <Portal>{card}</Portal>;
        }
        return card;
      }}
    </Draggable>
  );
};

export default React.memo(JobCard);
