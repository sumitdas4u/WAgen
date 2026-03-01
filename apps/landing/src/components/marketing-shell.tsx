import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type MarketingShellProps = {
  children: ReactNode;
};

export function MarketingShell({ children }: MarketingShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900">
      <nav className="sticky top-0 z-50 w-full border-b bg-white/85 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-1 text-2xl font-extrabold tracking-tight">
            <span className="text-emerald-600">Wagen</span>AI
          </Link>
          <div className="hidden items-center gap-6 text-sm font-medium md:flex">
            <Link href="/#features" className="transition-colors hover:text-emerald-600">
              Features
            </Link>
            <Link href="/#how-it-works" className="transition-colors hover:text-emerald-600">
              How It Works
            </Link>
            <Link href="/#pricing" className="transition-colors hover:text-emerald-600">
              Pricing
            </Link>
            <Link href="/#faq" className="transition-colors hover:text-emerald-600">
              FAQs
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/signup">Log In</Link>
            </Button>
            <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/signup">Start Free (QR Mode)</Link>
            </Button>
          </div>
        </div>
      </nav>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-zinc-200 bg-white py-10">
        <div className="container mx-auto flex flex-col gap-4 px-4 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="text-sm text-zinc-600">
            Copyright 2026 WagenAI. WhatsApp AI Automation Platform for Startups, SMBs and Enterprises.
          </p>
          <div className="flex gap-5 text-sm text-zinc-600">
            <Link href="/#features" className="hover:text-emerald-600">
              Features
            </Link>
            <Link href="/#pricing" className="hover:text-emerald-600">
              Pricing
            </Link>
            <Link href="/#faq" className="hover:text-emerald-600">
              FAQ
            </Link>
            <Link href="/privacy-policy" className="hover:text-emerald-600">
              Privacy Policy
            </Link>
            <Link href="/terms-of-service" className="hover:text-emerald-600">
              Terms of Service
            </Link>
            <Link href="/contact-us" className="hover:text-emerald-600">
              Contact Us
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
