import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Box } from "@mui/material";
import ClientOnlyHeader from "@/components/ClientOnlyHeader";
import ClientOnlyDrawer from "@/components/ClientOnlyDrawer";
import { EditorProvider } from "@/contexts/EditorContext";
import ThemeRegistry from "@/components/ThemeRegistry";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Git Interaction",
  description: "A web interface for interacting with a Git repository",
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: '/favicon-128x128.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerHeight = '64px';

  return (
    <html lang="en">
      <ThemeRegistry>
        <body className={`${geistSans.variable} ${geistMono.variable}`}>
          <EditorProvider>
            <ClientOnlyHeader />
            <Box sx={{ display: 'flex', pt: headerHeight }}>
              <ClientOnlyDrawer />
              <Box
                component="main"
                sx={{
                  flexGrow: 1,
                  px: 3,
                  pb: 3,
                  pt: 1,
                  overflow: 'auto',
                  height: `calc(100vh - ${headerHeight})`,
                  backgroundColor: 'background.paper',
                }}
              >
                {children}
              </Box>
            </Box>
          </EditorProvider>
        </body>
      </ThemeRegistry>
    </html>
  );
}
