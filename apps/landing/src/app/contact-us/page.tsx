import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "Contact Us | WagenAI",
  description: "Contact and support details for WagenAI.",
};

export default function ContactUsPage() {
  return (
    <MarketingShell>
      <section className="bg-zinc-100 py-12 md:py-16">
        <div className="container mx-auto max-w-4xl px-4 md:px-6">
          <article className="rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm md:p-10">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Contact Us</h1>

            <div className="mt-8 space-y-5 text-zinc-700">
              <p>WagenAI is a product of KEYLINE DIGITECH PVT. LTD.</p>
              <p>
                We are committed to providing secure and scalable WhatsApp automation solutions for businesses of all
                sizes.
              </p>
              <p>
                If you have any questions about our services, subscriptions, WhatsApp Business API setup, or technical
                support, please contact us using the details below.
              </p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">Parent Company</h2>
              <p>
                KEYLINE DIGITECH PVT. LTD.
                <br />
                36A, Chandi Ghosh Road
                <br />
                Kolkata – 700040
                <br />
                West Bengal, India
                <br />
                (Near Netaji Metro, Opposite Kolkata Movietone Studio)
              </p>
              <p>
                Website:{" "}
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="https://keylines.net/">
                  https://keylines.net/
                </a>
              </p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">Email Support</h2>
              <p>
                General Support:
                <br />
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="mailto:support@wagenai.com">
                  support@wagenai.com
                </a>
              </p>
              <p>
                Sales &amp; Business Inquiries:
                <br />
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="mailto:sales@wagenai.com">
                  sales@wagenai.com
                </a>
              </p>
              <p>
                Billing &amp; Subscription Queries:
                <br />
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="mailto:billing@wagenai.com">
                  billing@wagenai.com
                </a>
              </p>
              <p>
                Legal &amp; Compliance:
                <br />
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="mailto:legal@wagenai.com">
                  legal@wagenai.com
                </a>
              </p>
              <p>We aim to respond within 24–48 business hours.</p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">Phone Support</h2>
              <p>
                Phone:{" "}
                <a className="font-semibold text-emerald-700 hover:text-emerald-600" href="tel:+919804735837">
                  +91-9804735837
                </a>
                <br />
                (Monday to Friday, 10:00 AM – 6:00 PM IST)
              </p>

              <h2 className="pt-4 text-xl font-bold text-zinc-900">Official Website</h2>
              <p>
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
