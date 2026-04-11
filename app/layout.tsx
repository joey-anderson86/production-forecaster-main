import type { Metadata } from 'next';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps, createTheme, virtualColor } from '@mantine/core';
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
  colors: {
    tooltipBg: virtualColor({
      name: 'tooltipBg',
      light: 'gray.1',
      dark: 'dark.4',
    }),
  },
  components: {
    Tooltip: {
      defaultProps: {
        color: 'tooltipBg',
        autoContrast: true,
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
