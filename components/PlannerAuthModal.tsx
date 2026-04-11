'use client';

import React, { useState } from 'react';
import { Modal, PasswordInput, Button, Stack, Text, Group } from '@mantine/core';
import { Lock } from 'lucide-react';

interface PlannerAuthModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PlannerAuthModal({ opened, onClose, onSuccess }: PlannerAuthModalProps) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleVerify = () => {
    if (passcode === 'planner_mode') {
      setError(null);
      setPasscode('');
      onSuccess();
    } else {
      setError('Incorrect passcode');
    }
  };

  const handleClose = () => {
    setPasscode('');
    setError(null);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <Lock size={18} className="text-indigo-600" />
          <Text fw={600}>Unlock Planner Mode</Text>
        </Group>
      }
      centered
      radius="md"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Please enter the administrative passcode to unlock Planner Mode and access configuration features.
        </Text>
        
        <PasswordInput
          label="Passcode"
          placeholder="Enter passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.currentTarget.value)}
          error={error}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleVerify();
          }}
          autoFocus
        />

        <Group justify="flex-end" mt="md">
          <Button variant="light" color="gray" onClick={handleClose}>
            Cancel
          </Button>
          <Button color="indigo" onClick={handleVerify}>
            Verify
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
