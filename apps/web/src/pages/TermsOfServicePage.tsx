import { Link } from "react-router-dom";
import { LandingScaffold } from "./landing-orchids/LandingScaffold";

export function TermsOfServicePage() {
  return (
    <LandingScaffold>
      <section className="orch-section orch-legal-section">
        <div className="policy-page">
          <article className="policy-card">
            <div className="policy-top">
              <Link to="/" className="policy-back">
                Back to Home
              </Link>
              <h1>Terms of Service</h1>
              <p>
                <strong>Effective Date:</strong> 01/03/2026
              </p>
              <p>
                <strong>Last Updated:</strong> 01/03/2026
              </p>
            </div>

            <p>Welcome to WagenAI ("Company", "we", "our", or "us").</p>
            <p>
              These Terms of Service ("Terms") govern your access to and use of the WagenAI platform, including our
              website, dashboard, QR-based WhatsApp automation services, and Official WhatsApp Business API
              integrations.
            </p>
            <p>By accessing or using WagenAI, you agree to these Terms.</p>
            <p>If you do not agree, do not use our services.</p>

            <h2>1. DESCRIPTION OF SERVICE</h2>
            <p>WagenAI provides:</p>
            <ul>
              <li>AI-powered WhatsApp automation tools</li>
              <li>QR-based WhatsApp connection (Starter Mode)</li>
              <li>Official WhatsApp Business API integrations (Scale Mode)</li>
              <li>Automated message responses</li>
              <li>Subscription-based SaaS services</li>
            </ul>
            <p>WagenAI is a technology platform and is not affiliated with or endorsed by WhatsApp or Meta.</p>

            <h2>2. ELIGIBILITY</h2>
            <p>You must:</p>
            <ul>
              <li>Be at least 18 years old</li>
              <li>Have legal authority to operate a business</li>
              <li>Use the service in compliance with applicable laws</li>
              <li>Comply with WhatsApp Business Platform policies</li>
            </ul>

            <h2>3. ACCOUNT REGISTRATION</h2>
            <p>To use WagenAI:</p>
            <ul>
              <li>You must create an account</li>
              <li>Provide accurate information</li>
              <li>Maintain security of your login credentials</li>
            </ul>
            <p>You are responsible for all activity under your account.</p>

            <h2>4. WHATSAPP USAGE TERMS</h2>
            <h3>4.1 QR Mode (Starter Mode)</h3>
            <p>QR-based WhatsApp connection:</p>
            <ul>
              <li>Connects via WhatsApp Web session</li>
              <li>May disconnect at any time</li>
              <li>May be restricted by WhatsApp</li>
              <li>Is intended for testing or limited use</li>
            </ul>
            <p>WagenAI is not responsible for account bans or restrictions caused by misuse.</p>

            <h3>4.2 Official WhatsApp Business API Mode</h3>
            <p>For API-based integration:</p>
            <ul>
              <li>Users must comply with Meta&apos;s WhatsApp Business Platform Terms</li>
              <li>Users must obtain proper customer consent before messaging</li>
              <li>Template messages must follow WhatsApp guidelines</li>
              <li>Spam, unsolicited bulk messaging, or illegal content is strictly prohibited</li>
            </ul>
            <p>Failure to comply may result in suspension or termination.</p>

            <h2>5. PROHIBITED USE</h2>
            <p>You agree NOT to use WagenAI to:</p>
            <ul>
              <li>Send spam or unsolicited messages</li>
              <li>Distribute illegal content</li>
              <li>Harass or impersonate others</li>
              <li>Violate data protection laws</li>
              <li>Send phishing or scam messages</li>
              <li>Promote prohibited goods or services</li>
            </ul>
            <p>We reserve the right to suspend accounts violating these rules.</p>

            <h2>6. SUBSCRIPTIONS &amp; BILLING</h2>
            <h3>6.1 Subscription Plans</h3>
            <p>WagenAI offers:</p>
            <ul>
              <li>Starter (QR Mode)</li>
              <li>Growth / API Mode</li>
              <li>Other paid plans as published</li>
            </ul>
            <p>Pricing is subject to change with prior notice.</p>

            <h3>6.2 Recurring Billing</h3>
            <p>
              Subscriptions are billed monthly or annually via third-party payment processors (e.g., Razorpay).
            </p>
            <p>By subscribing, you authorize recurring charges.</p>
            <p>Failure to complete payment may result in service suspension.</p>

            <h3>6.3 Refund Policy</h3>
            <p>Unless otherwise stated:</p>
            <ul>
              <li>Subscription fees are non-refundable</li>
              <li>Partial usage does not qualify for refunds</li>
              <li>Refunds may be granted at our discretion</li>
            </ul>

            <h2>7. CANCELLATION</h2>
            <p>You may cancel your subscription anytime via dashboard.</p>
            <p>After cancellation:</p>
            <ul>
              <li>Access remains active until end of billing cycle</li>
              <li>No further charges will apply</li>
            </ul>
            <p>We reserve the right to suspend or terminate accounts for violation of Terms.</p>

            <h2>8. DATA RESPONSIBILITY</h2>
            <p>You are the data controller of customer data processed via WagenAI.</p>
            <p>You agree:</p>
            <ul>
              <li>To obtain proper consent from your customers</li>
              <li>To comply with applicable privacy laws</li>
              <li>Not to process unlawful data</li>
            </ul>
            <p>WagenAI acts as a technology service provider.</p>

            <h2>9. INTELLECTUAL PROPERTY</h2>
            <p>All platform content, including:</p>
            <ul>
              <li>Software</li>
              <li>Branding</li>
              <li>UI design</li>
              <li>AI automation systems</li>
            </ul>
            <p>Are property of WagenAI.</p>
            <p>You may not:</p>
            <ul>
              <li>Copy</li>
              <li>Reverse engineer</li>
              <li>Resell</li>
              <li>Redistribute</li>
            </ul>
            <p>Without written permission.</p>

            <h2>10. LIMITATION OF LIABILITY</h2>
            <p>WagenAI provides services "as is".</p>
            <p>We are not liable for:</p>
            <ul>
              <li>WhatsApp account bans</li>
              <li>Message delivery failures</li>
              <li>Business losses</li>
              <li>Indirect or consequential damages</li>
              <li>Third-party platform restrictions</li>
            </ul>
            <p>Use of the service is at your own risk.</p>

            <h2>11. THIRD-PARTY SERVICES</h2>
            <p>WagenAI integrates with:</p>
            <ul>
              <li>WhatsApp Business Platform (Meta)</li>
              <li>Razorpay (payments)</li>
              <li>Cloud hosting providers</li>
              <li>AI processing services</li>
            </ul>
            <p>We are not responsible for service disruptions caused by third-party providers.</p>

            <h2>12. TERMINATION</h2>
            <p>We may suspend or terminate your account if:</p>
            <ul>
              <li>You violate these Terms</li>
              <li>You misuse WhatsApp platform</li>
              <li>You engage in unlawful activities</li>
            </ul>
            <p>Termination may occur without prior notice in serious violations.</p>

            <h2>13. MODIFICATIONS</h2>
            <p>We may update these Terms at any time.</p>
            <p>Continued use after updates constitutes acceptance.</p>

            <h2>14. GOVERNING LAW</h2>
            <p>These Terms shall be governed by and interpreted under the laws of India.</p>
            <p>Any disputes shall be subject to the jurisdiction of courts located in [Your City, India].</p>

            <h2>15. CONTACT INFORMATION</h2>
            <p>
              WagenAI
              <br />
              Email: <a href="mailto:support@wagenai.com">support@wagenai.com</a>
              <br />
              Website: <a href="https://wagenai.com">https://wagenai.com</a>
            </p>
          </article>
        </div>
      </section>
    </LandingScaffold>
  );
}
