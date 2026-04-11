'use client';

import React, { useState, useEffect } from 'react';
import { ActionIcon, useMantineColorScheme, useComputedColorScheme, Tooltip } from '@mantine/core';
import { Sun, Moon } from 'lucide-react';

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === 'light' ? 'dark' : 'light');
  };

  // Prevent hydration mismatch by rendering a consistent placeholder until mounted
  if (!mounted) {
    return (
      <ActionIcon variant="outline" color="gray" size="lg" radius="md" aria-label="Toggle color scheme">
        <Moon size={20} strokeWidth={1.5} style={{ opacity: 0 }} />
      </ActionIcon>
    );
  }

  return (
    <Tooltip 
      label={`Switch to ${computedColorScheme === 'light' ? 'dark' : 'light'} mode`}
    >
      <ActionIcon
        onClick={toggleColorScheme}
        variant="outline"
        color={computedColorScheme === 'light' ? 'gray' : 'yellow'}
        size="lg"
        radius="md"
        aria-label="Toggle color scheme"
      >
        {computedColorScheme === 'light' ? (
          <Moon size={20} strokeWidth={1.5} />
        ) : (
          <Sun size={20} strokeWidth={1.5} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}
