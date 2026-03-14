import type {Metadata} from 'next';
import { ColorSchemeScript, MantineProvider, mantineHtmlProps, createTheme, virtualColor } from '@mantine/core';
import '@mantine/core/styles.css';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'My Google AI Studio App',
  description: 'My Google AI Studio App',
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

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
      </head>
      <body suppressHydrationWarning>
        <MantineProvider theme={theme}>
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
