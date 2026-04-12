import type { Metadata } from 'next';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps, createTheme, Tooltip } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { ZoomManager } from '../components/ZoomManager';
import { StoreInitializer } from '../components/StoreInitializer';
import { WeekProvider } from '@/components/WeekContext';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'Production Manager and Planner',
  description: 'Production Manager and Planner',
};

const theme = createTheme({
  components: {
    Tooltip: {
      styles: {
        tooltip: {
          backgroundColor: 'light-dark(var(--mantine-color-gray-9), var(--mantine-color-dark-4))',
          color: 'var(--mantine-color-white)',
        },
      },
    },
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
      </head>
      <body suppressHydrationWarning>
        <MantineProvider theme={theme}>
          <Notifications />
          <ModalsProvider>
            <ZoomManager />
            <StoreInitializer />
            <WeekProvider>
              {children}
            </WeekProvider>
          </ModalsProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
