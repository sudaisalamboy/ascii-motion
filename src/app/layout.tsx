import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ASCII Motion — Video to Text-Art Video Converter",
  description:
    "Turn any short video clip into a playable ASCII text-art video. Upload a clip and the server samples it at 30 FPS, redraws each frame as monospace characters, and compiles them back into a real downloadable video.",
  keywords: [
    "ASCII art",
    "text art",
    "video to ASCII",
    "video converter",
    "ASCII video",
    "Next.js",
    "TypeScript",
  ],
  authors: [{ name: "sudaisalamboy" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "ASCII Motion",
    description: "Upload a short video and get back a playable text-art video, processed server-side.",
    url: "https://github.com/sudaisalamboy/ascii-motion",
    siteName: "ASCII Motion",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ASCII Motion",
    description: "Upload a short video and get back a playable text-art video, processed server-side.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
