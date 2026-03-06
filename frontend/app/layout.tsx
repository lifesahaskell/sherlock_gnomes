import "./globals.css";
import type { Metadata } from "next";
import TopNav from "@/components/top-nav";

export const metadata: Metadata = {
  title: "Sherlock Gnomes Explorer",
  description: "AI-assisted codebase explorer"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <div className="app-content">{children}</div>
      </body>
    </html>
  );
}
