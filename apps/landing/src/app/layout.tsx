import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { VisualEditsMessenger } from "orchids-visual-edits";

const shouldEnableVisualEdits =
  process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITS === "true";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://wagenai.com"),
  title: "WhatsApp AI Platform | QR Setup & Official API - WagenAI",
  description:
    "WagenAI is a WhatsApp AI automation platform with Instant QR Mode for quick starts and Official WhatsApp API Mode for reliable scale.",
  keywords: [
    "whatsapp ai automation platform",
    "whatsapp qr setup",
    "official whatsapp api",
    "whatsapp ai for startups",
    "whatsapp ai for smb",
    "wagenai",
  ],
  openGraph: {
    title: "WhatsApp AI Platform | QR Setup & Official API - WagenAI",
    description:
      "Start with instant QR setup and upgrade anytime to Official WhatsApp API mode for high-volume business automation.",
    url: "/",
    siteName: "WagenAI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "WhatsApp AI Platform | QR Setup & Official API - WagenAI",
    description:
      "Start with instant QR setup and upgrade anytime to Official WhatsApp API mode for high-volume business automation.",
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        {shouldEnableVisualEdits ? <VisualEditsMessenger /> : null}
      </body>
    </html>
  );
}

