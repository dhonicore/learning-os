import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { AppShell } from "@/components/shell/AppShell";
import { ThemeProvider } from "@/lib/theme";
import { ActivityProvider } from "@/lib/activity-context";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-jetbrains",
});

export const metadata: Metadata = {
  title: {
    default: "Learning OS — SQL practice tutor",
    template: "%s · Learning OS",
  },
  description:
    "Practice SQL with a checker-backed AI tutor. Python decides correctness; the model only explains.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <ThemeProvider>
          <ActivityProvider>
            <AppShell>{children}</AppShell>
          </ActivityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}