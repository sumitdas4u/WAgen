import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "Privacy Policy | WagenAI",
  description: "Privacy Policy for WagenAI WhatsApp AI automation platform.",
};

export default function PrivacyPolicyPage() {
  return (
    <MarketingShell>
      <section className="bg-zinc-100 py-12 md:py-16">
        <div className="container mx-auto max-w-4xl px-4 md:px-6">
          <article className="rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm md:p-10">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Privacy Policy</h1>
            <p className="mt-3 text-sm text-zinc-600">
              <strong>Effective Date:</strong> 01/03/2026
              <br />
              <strong>Last Updated:</strong> 01/03/2026
            </p>

            <div className="mt-8 space-y-5 text-zinc-700">
              <p>Welcome to WagenAI (“Company”, “we”, “our”, “us”).</p>
              <p>
                WagenAI provides AI-powered WhatsApp automation services including WhatsApp QR-based automation and
                Official WhatsApp Business API integrations.
              </p>
              <p>
                Your privacy is important to us. This Privacy Policy explains how we collect, use, store, and protect
                your information when you use our platform.
              </p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">1. INFORMATION WE COLLECT</h2>
              <h3 className="text-lg font-semibold text-zinc-900">1.1 Account Information</h3>
              <p>When you register on WagenAI, we may collect:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Name</li>
                <li>Email address</li>
                <li>Phone number</li>
                <li>Business name</li>
                <li>Billing information</li>
              </ul>
              <p>Authentication may be handled via third-party services such as Firebase Authentication.</p>

              <h3 className="text-lg font-semibold text-zinc-900">1.2 WhatsApp Data</h3>
              <p>When you connect your WhatsApp account (QR Mode or Official WhatsApp Business API), we may process:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Incoming and outgoing message content</li>
                <li>Customer phone numbers</li>
                <li>Message timestamps</li>
                <li>Media attachments</li>
                <li>Metadata related to conversations</li>
              </ul>
              <p>We do not claim ownership of your WhatsApp data.</p>
              <p>You remain the data controller of your customer conversations.</p>

              <h3 className="text-lg font-semibold text-zinc-900">1.3 Payment Information</h3>
              <p>Payments are processed through third-party payment processors such as Razorpay.</p>
              <p>We do not store:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Credit card numbers</li>
                <li>UPI details</li>
                <li>Bank account information</li>
              </ul>
              <p>Payment data is handled securely by the payment provider.</p>

              <h3 className="text-lg font-semibold text-zinc-900">1.4 Usage Data</h3>
              <p>We may automatically collect:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>IP address</li>
                <li>Browser type</li>
                <li>Device information</li>
                <li>Log data</li>
                <li>Feature usage statistics</li>
              </ul>
              <p>This helps us improve our service.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">2. HOW WE USE YOUR INFORMATION</h2>
              <p>We use collected information to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Provide WhatsApp automation services</li>
                <li>Enable AI-based message responses</li>
                <li>Improve platform performance</li>
                <li>Process subscriptions and billing</li>
                <li>Provide customer support</li>
                <li>Ensure compliance with WhatsApp Business policies</li>
                <li>Prevent fraud or misuse</li>
              </ul>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">3. WHATSAPP BUSINESS API DATA HANDLING</h2>
              <p>If you use Official WhatsApp Business API through WagenAI:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>We act as a technology service provider.</li>
                <li>Message data is processed to enable automation and AI responses.</li>
                <li>Data is transmitted through Meta’s WhatsApp Business Platform.</li>
                <li>We comply with WhatsApp Business Platform Terms and Policies.</li>
                <li>We do not sell WhatsApp conversation data.</li>
              </ul>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">4. QR MODE DISCLAIMER</h2>
              <p>If you use QR-based WhatsApp connection:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Connection is established via WhatsApp Web session.</li>
                <li>Sessions may disconnect.</li>
                <li>Usage must comply with WhatsApp’s terms of service.</li>
                <li>Users are responsible for ensuring compliance with WhatsApp policies.</li>
              </ul>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">5. AI PROCESSING</h2>
              <p>WagenAI uses AI technologies to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Analyze conversation context</li>
                <li>Generate automated replies</li>
                <li>Improve response accuracy</li>
              </ul>
              <p>AI processing may involve temporary storage of message content for generating responses.</p>
              <p>We do not use your conversation data to train public AI models without your consent.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">6. DATA STORAGE AND SECURITY</h2>
              <p>We implement industry-standard security measures including:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Encryption in transit (HTTPS/SSL)</li>
                <li>Secure authentication (JWT-based sessions)</li>
                <li>Access control systems</li>
                <li>Webhook signature verification</li>
                <li>Role-based access permissions</li>
              </ul>
              <p>However, no method of transmission over the internet is 100% secure.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">7. DATA RETENTION</h2>
              <p>We retain data:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>As long as your account is active</li>
                <li>As required for legal or compliance purposes</li>
                <li>Until you request deletion</li>
              </ul>
              <p>You may request account deletion at any time.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">8. DATA SHARING</h2>
              <p>We may share data with:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Meta (WhatsApp Business Platform)</li>
                <li>Payment processors (Razorpay)</li>
                <li>Hosting providers</li>
                <li>Legal authorities when required</li>
              </ul>
              <p>We do not sell personal data.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">9. USER RESPONSIBILITIES</h2>
              <p>As a WagenAI user, you agree to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Obtain consent from your customers before messaging them</li>
                <li>Comply with WhatsApp Business policies</li>
                <li>Not send spam or illegal content</li>
                <li>Use the platform lawfully</li>
              </ul>
              <p>You are responsible for the data you process via our platform.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">10. INTERNATIONAL DATA TRANSFERS</h2>
              <p>
                Your data may be processed in countries outside your jurisdiction where our service providers operate.
              </p>
              <p>We ensure reasonable safeguards are in place.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">11. YOUR RIGHTS</h2>
              <p>Depending on your jurisdiction, you may have the right to:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Access your data</li>
                <li>Correct inaccurate data</li>
                <li>Request deletion</li>
                <li>Withdraw consent</li>
                <li>Object to processing</li>
              </ul>
              <p>
                To exercise these rights, contact us at:{" "}
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="mailto:support@wagenai.com">
                  support@wagenai.com
                </a>
              </p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">12. CHILDREN’S PRIVACY</h2>
              <p>WagenAI is not intended for users under 18 years of age.</p>
              <p>We do not knowingly collect data from minors.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">13. CHANGES TO THIS POLICY</h2>
              <p>We may update this Privacy Policy periodically.</p>
              <p>Changes will be posted on this page with updated effective date.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">14. CONTACT US</h2>
              <p>
                WagenAI
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
