"use client"; // Mark this as a Client Component

import dynamic from 'next/dynamic';

// Dynamically import the actual Drawer component with SSR disabled
const DynamicDrawer = dynamic(() => import('@/components/Drawer'), {
  ssr: false,
});

// This wrapper component simply renders the dynamically imported Drawer
export default function ClientOnlyDrawer() {
  return <DynamicDrawer />;
} 