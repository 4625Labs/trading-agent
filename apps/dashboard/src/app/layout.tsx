import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Nav from "@/components/Nav";
import SW from "@/components/SW";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Trading Agent",
  description: "Control room for the autonomous crypto trading agent",
  applicationName: "Trading Agent",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Trading Agent", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { themeColor: "#070a1c", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Nav />
        <div className="shell"><main>{children}</main></div>
        <SW />
      </body>
    </html>
  );
}
