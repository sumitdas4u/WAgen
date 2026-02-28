import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { VisualEditsMessenger } from "orchids-visual-edits";

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
  title: "WhatsApp AI Bot Without API | 24/7 AI Receptionist – WagenAI",
  description:
    "Turn your WhatsApp number into a 24/7 AI receptionist in just 2 minutes. No API, no business approval, no coding required. Start free today.",
  keywords: [
    "whatsapp ai bot without api",
    "whatsapp ai receptionist",
    "whatsapp chatbot no api",
    "24/7 ai receptionist",
    "whatsapp chatbot without business api approval",
    "wagenai"
  ],
  openGraph: {
    title: "WhatsApp AI Bot Without API | 24/7 AI Receptionist – WagenAI",
    description:
      "Turn your WhatsApp number into a 24/7 AI receptionist in just 2 minutes. No API, no business approval, no coding required. Start free today.",
    url: "/",
    siteName: "WagenAI",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "WhatsApp AI Bot Without API | 24/7 AI Receptionist – WagenAI",
    description:
      "Turn your WhatsApp number into a 24/7 AI receptionist in just 2 minutes. No API, no business approval, no coding required. Start free today."
  },
  alternates: {
    canonical: "/"
  }
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
        <VisualEditsMessenger />
      </body>
    </html>
  );
}
