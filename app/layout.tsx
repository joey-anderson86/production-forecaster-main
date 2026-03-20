import type { Metadata } from 'next';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps, createTheme, virtualColor } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { Notifications } from '@mantine/notifications';
import { ZoomManager } from '../components/ZoomManager';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'Production Forecaster',
  description: 'Production Forecaster',
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
          <ZoomManager />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
