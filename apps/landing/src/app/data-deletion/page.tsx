import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "Data Deletion Instructions | WAgen AI",
  description: "Data deletion instructions for WAgen AI users and WhatsApp Business API integrations.",
};

export default function DataDeletionPage() {
  return (
    <MarketingShell>
      <section className="bg-zinc-100 py-12 md:py-16">
        <div className="container mx-auto max-w-4xl px-4 md:px-6">
          <article className="rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm md:p-10">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Data Deletion Instructions</h1>
            <p className="mt-4 text-zinc-700">
              WAgen AI respects user privacy and provides mechanisms for users to request deletion of their data in
              compliance with Meta Platform Policies and applicable data protection laws.
            </p>

            <div className="mt-8 space-y-5 text-zinc-700">
              <h2 className="pt-2 text-xl font-bold text-zinc-900">1. What Data We Store</h2>
              <p>
                When a business connects their WhatsApp Business Account via Meta Embedded Signup, WAgen AI may
                store:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Business Manager ID</li>
                <li>WhatsApp Business Account ID (WABA)</li>
                <li>Phone Number ID</li>
                <li>Access tokens (encrypted)</li>
                <li>Message metadata required for platform functionality</li>
                <li>User account information (email, if provided)</li>
              </ul>
              <p>
                Message content is processed only to provide messaging functionality and is not sold or shared with
                third parties.
              </p>

              <h2 className="pt-2 text-xl font-bold text-zinc-900">2. How to Request Data Deletion</h2>
              <h3 className="text-lg font-semibold text-zinc-900">Option 1: Email Request</h3>
              <p>
                Send an email to{" "}
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="mailto:support@wagenai.com">
                  support@wagenai.com
                </a>
              </p>
              <p>Include:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Your registered business name</li>
                <li>Your WhatsApp Business number</li>
                <li>Your Meta Business Manager ID</li>
              </ul>
              <p>We will process the request within 7 business days.</p>

              <h3 className="text-lg font-semibold text-zinc-900">Option 2: Inside Platform</h3>
              <p>If you are a registered WAgen AI user:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Log into your WAgen AI dashboard</li>
                <li>Navigate to Account Settings</li>
                <li>Select "Delete Account"</li>
                <li>Confirm deletion</li>
              </ul>
              <p>Upon confirmation:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Your account will be permanently deleted</li>
                <li>Connected WhatsApp tokens will be revoked</li>
                <li>Associated business data will be removed</li>
              </ul>

              <h2 className="pt-2 text-xl font-bold text-zinc-900">3. Automatic Data Deletion</h2>
              <p>If a business disconnects WhatsApp integration:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Access tokens are revoked immediately</li>
                <li>Webhook subscriptions are removed</li>
                <li>Associated account data is deleted from active systems</li>
              </ul>

              <h2 className="pt-2 text-xl font-bold text-zinc-900">4. Contact Information</h2>
              <p>For any privacy-related questions, contact:</p>
              <p>
                WAgen AI
                <br />
                Email:{" "}
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="mailto:support@wagenai.com">
                  support@wagenai.com
                </a>
                <br />
                Website:{" "}
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="https://wagenai.com">
                  https://wagenai.com
                </a>
              </p>
            </div>
          </article>
        </div>
      </section>
    </MarketingShell>
  );
}
