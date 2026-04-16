'use client';

import React from 'react';
import { Group, Card, Stack, Text, Tooltip, ActionIcon, Slider } from '@mantine/core';
import { AlertCircle, CheckCircle2, Package, TrendingUp, Calendar, Info } from 'lucide-react';
import { ForecasterSummary as SummaryType } from './ForecasterTypes';

interface ForecasterSummaryProps {
  summary: SummaryType;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  dates: string[];
}

export function ForecasterSummary({ summary, selectedDate, setSelectedDate, dates }: ForecasterSummaryProps) {
  const selectedIndex = dates.indexOf(selectedDate);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card withBorder radius="lg" className="bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-900/50">
          <Group justify="space-between">
            <Stack gap={0}>
              <Text size="xs" fw={700} c="red.7" className="uppercase tracking-wider">Starving Today</Text>
              <Text size="xl" fw={800} c="red.9">{summary.starvingToday}</Text>
            </Stack>
            <ActionIcon color="red" variant="light" size="lg" radius="md">
              <AlertCircle size={20} />
            </ActionIcon>
          </Group>
        </Card>

        <Card withBorder radius="lg" className="bg-amber-50/50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/50">
          <Group justify="space-between">
            <Stack gap={0}>
              <Text size="xs" fw={700} c="amber.7" className="uppercase tracking-wider">Total Shortages</Text>
              <Text size="xl" fw={800} c="amber.9">{summary.totalShortages}</Text>
            </Stack>
            <ActionIcon color="amber" variant="light" size="lg" radius="md">
              <Package size={20} />
            </ActionIcon>
          </Group>
        </Card>

        <Card withBorder radius="lg" className="bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/50">
          <Group justify="space-between">
            <Stack gap={0}>
              <Text size="xs" fw={700} c="emerald.7" className="uppercase tracking-wider">Healthy Parts</Text>
              <Text size="xl" fw={800} c="emerald.9">{summary.healthyParts}</Text>
            </Stack>
            <ActionIcon color="emerald" variant="light" size="lg" radius="md">
              <CheckCircle2 size={20} />
            </ActionIcon>
          </Group>
        </Card>

        <Card withBorder radius="lg" className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/50">
          <Group justify="space-between">
            <Stack gap={0}>
              <Text size="xs" fw={700} c="blue.7" className="uppercase tracking-wider">Avg Pipeline DOI</Text>
              <Text size="xl" fw={800} c="blue.9">{summary.avgPipelineDOI.toFixed(1)} Days</Text>
            </Stack>
            <ActionIcon color="blue" variant="light" size="lg" radius="md">
              <TrendingUp size={20} />
            </ActionIcon>
          </Group>
        </Card>
      </div>

      <Card withBorder radius="lg" p="md" className="mb-6 bg-slate-50 dark:bg-slate-800/50">
        <Stack gap="sm">
          <Group justify="space-between">
            <Group gap="xs">
              <Calendar size={18} className="text-indigo-600" />
              <Text fw={700} size="sm">Forecast Timeline Snapshot</Text>
            </Group>
            <Group gap={4}>
              <Text size="xs" c="dimmed">Currently viewing:</Text>
              <Text size="sm" fw={700} c="indigo">
                {new Date(selectedDate.includes('T') ? selectedDate : selectedDate + 'T12:00:00')
                  .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </Text>
              <Tooltip label="Moving the slider changes the 'Day 0' starting point for the shortage calculation and row distributions.">
                 <Info size={14} className="text-slate-400 cursor-help" />
              </Tooltip>
            </Group>
          </Group>
          <div className="px-4 py-2">
            <Slider
              max={dates.length - 1}
              step={1}
              value={selectedIndex}
              onChange={(val) => setSelectedDate(dates[val])}
              label={(val) => {
                const date = new Date(dates[val].includes('T') ? dates[val] : dates[val] + 'T12:00:00');
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              }}
              color="indigo"
              size="lg"
              marks={dates.slice(0, 10).map((d, i) => ({
                value: i,
                label: new Date(d.includes('T') ? d : d + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
              }))}
              mb="xl"
            />
          </div>
        </Stack>
      </Card>
    </>
  );
}
