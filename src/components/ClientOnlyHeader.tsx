"use client"; // Mark this as a Client Component

import dynamic from 'next/dynamic';

// Dynamically import the actual Header component with SSR disabled
const DynamicHeader = dynamic(() => import('@/components/Header'), {
  ssr: false,
});

// This wrapper component simply renders the dynamically imported Header
export default function ClientOnlyHeader() {
  return <DynamicHeader />;
} 