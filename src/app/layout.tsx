import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { buildThemeInitScript } from "@/lib/theme/init-script";
import { THEME_STORAGE_KEY } from "@/lib/theme/types";

const geistSans = GeistSans;
const geistMono = GeistMono;

// Applies the persisted theme before first paint (no flash on reload).
const themeInitScript = buildThemeInitScript(THEME_STORAGE_KEY);

export const metadata: Metadata = {
  title: "AgentTeams Dashboard - AI 集群管理面板",
  description: "AgentTeams 控制器仪表盘，管理 Workers、Teams、Managers 和基础设施",
  icons: {
    icon: "/agentteams-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint (no FOUC). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
