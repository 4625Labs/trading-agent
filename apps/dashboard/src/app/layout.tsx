import type { Metadata, Viewport } from "next";
import Nav from "@/components/Nav";
import SW from "@/components/SW";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Agent",
  description: "Control room for the autonomous crypto trading agent",
  applicationName: "Trading Agent",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Trading Agent", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { themeColor: "#0b0f14", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell"><main>{children}</main></div>
        <Nav />
        <SW />
      </body>
    </html>
  );
}
