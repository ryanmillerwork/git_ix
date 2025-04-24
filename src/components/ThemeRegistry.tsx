'use client';

import * as React from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// Create a dark theme instance (moved from layout.tsx)
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      // default: '#121212', // Default overall background (optional)
      paper: '#1d1f21', // Set paper background (used by Drawer, main content area)
    },
    // You can further customize other palette colors here if needed
  },
});

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={darkTheme}>
      {/* CssBaseline kickstarts an elegant, consistent, and simple baseline to build upon. */}
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
} 