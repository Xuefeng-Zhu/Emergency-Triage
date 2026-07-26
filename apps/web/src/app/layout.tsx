import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Emergency Trial",
  description: "Private, local-first voice analysis workspace",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
