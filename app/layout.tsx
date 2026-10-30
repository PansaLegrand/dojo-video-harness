import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = {
  title: "Dojo Video Harness",
  description: "Local video editing with your own model providers",
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = (await headers()).get("x-harness-locale") ?? "en";
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
