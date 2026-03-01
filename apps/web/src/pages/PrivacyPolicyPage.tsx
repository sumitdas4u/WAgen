import { Link } from "react-router-dom";
import { LandingScaffold } from "./landing-orchids/LandingScaffold";

export function PrivacyPolicyPage() {
  return (
    <LandingScaffold>
      <section className="orch-section orch-legal-section">
        <div className="policy-page">
          <article className="policy-card">
            <div className="policy-top">
              <Link to="/" className="policy-back">
                Back to Home
              </Link>
              <h1>Privacy Policy</h1>
              <p>
                <strong>Effective Date:</strong> 01/03/2026
              </p>
              <p>
                <strong>Last Updated:</strong> 01/03/2026
              </p>
            </div>

            <p>Welcome to WagenAI ("Company", "we", "our", "us").</p>
            <p>
              WagenAI provides AI-powered WhatsApp automation services including WhatsApp QR-based automation and
              Official WhatsApp Business API integrations.
            </p>
            <p>
              Your privacy is important to us. This Privacy Policy explains how we collect, use, store, and protect your
              information when you use our platform.
            </p>

            <h2>1. INFORMATION WE COLLECT</h2>
            <h3>1.1 Account Information</h3>
            <p>When you register on WagenAI, we may collect:</p>
            <ul>
              <li>Name</li>
              <li>Email address</li>
              <li>Phone number</li>
              <li>Business name</li>
              <li>Billing information</li>
            </ul>
            <p>Authentication may be handled via third-party services such as Firebase Authentication.</p>

            <h3>1.2 WhatsApp Data</h3>
            <p>
              When you connect your WhatsApp account (QR Mode or Official WhatsApp Business API), we may process:
            </p>
            <ul>
              <li>Incoming and outgoing message content</li>
              <li>Customer phone numbers</li>
              <li>Message timestamps</li>
              <li>Media attachments</li>
              <li>Metadata related to conversations</li>
            </ul>
            <p>We do not claim ownership of your WhatsApp data.</p>
            <p>You remain the data controller of your customer conversations.</p>

            <h3>1.3 Payment Information</h3>
            <p>Payments are processed through third-party payment processors such as Razorpay.</p>
            <p>We do not store:</p>
            <ul>
              <li>Credit card numbers</li>
              <li>UPI details</li>
              <li>Bank account information</li>
            </ul>
            <p>Payment data is handled securely by the payment provider.</p>

            <h3>1.4 Usage Data</h3>
            <p>We may automatically collect:</p>
            <ul>
              <li>IP address</li>
              <li>Browser type</li>
              <li>Device information</li>
              <li>Log data</li>
              <li>Feature usage statistics</li>
            </ul>
            <p>This helps us improve our service.</p>

            <h2>2. HOW WE USE YOUR INFORMATION</h2>
            <p>We use collected information to:</p>
            <ul>
              <li>Provide WhatsApp automation services</li>
              <li>Enable AI-based message responses</li>
              <li>Improve platform performance</li>
              <li>Process subscriptions and billing</li>
              <li>Provide customer support</li>
              <li>Ensure compliance with WhatsApp Business policies</li>
              <li>Prevent fraud or misuse</li>
            </ul>

            <h2>3. WHATSAPP BUSINESS API DATA HANDLING</h2>
            <p>If you use Official WhatsApp Business API through WagenAI:</p>
            <ul>
              <li>We act as a technology service provider.</li>
              <li>Message data is processed to enable automation and AI responses.</li>
              <li>Data is transmitted through Meta&apos;s WhatsApp Business Platform.</li>
              <li>We comply with WhatsApp Business Platform Terms and Policies.</li>
              <li>We do not sell WhatsApp conversation data.</li>
            </ul>

            <h2>4. QR MODE DISCLAIMER</h2>
            <p>If you use QR-based WhatsApp connection:</p>
            <ul>
              <li>Connection is established via WhatsApp Web session.</li>
              <li>Sessions may disconnect.</li>
              <li>Usage must comply with WhatsApp&apos;s terms of service.</li>
              <li>Users are responsible for ensuring compliance with WhatsApp policies.</li>
            </ul>

            <h2>5. AI PROCESSING</h2>
            <p>WagenAI uses AI technologies to:</p>
            <ul>
              <li>Analyze conversation context</li>
              <li>Generate automated replies</li>
              <li>Improve response accuracy</li>
            </ul>
            <p>AI processing may involve temporary storage of message content for generating responses.</p>
            <p>We do not use your conversation data to train public AI models without your consent.</p>

            <h2>6. DATA STORAGE AND SECURITY</h2>
            <p>We implement industry-standard security measures including:</p>
            <ul>
              <li>Encryption in transit (HTTPS/SSL)</li>
              <li>Secure authentication (JWT-based sessions)</li>
              <li>Access control systems</li>
              <li>Webhook signature verification</li>
              <li>Role-based access permissions</li>
            </ul>
            <p>However, no method of transmission over the internet is 100% secure.</p>

            <h2>7. DATA RETENTION</h2>
            <p>We retain data:</p>
            <ul>
              <li>As long as your account is active</li>
              <li>As required for legal or compliance purposes</li>
              <li>Until you request deletion</li>
            </ul>
            <p>You may request account deletion at any time.</p>

            <h2>8. DATA SHARING</h2>
            <p>We may share data with:</p>
            <ul>
              <li>Meta (WhatsApp Business Platform)</li>
              <li>Payment processors (Razorpay)</li>
              <li>Hosting providers</li>
              <li>Legal authorities when required</li>
            </ul>
            <p>We do not sell personal data.</p>

            <h2>9. USER RESPONSIBILITIES</h2>
            <p>As a WagenAI user, you agree to:</p>
            <ul>
              <li>Obtain consent from your customers before messaging them</li>
              <li>Comply with WhatsApp Business policies</li>
              <li>Not send spam or illegal content</li>
              <li>Use the platform lawfully</li>
            </ul>
            <p>You are responsible for the data you process via our platform.</p>

            <h2>10. INTERNATIONAL DATA TRANSFERS</h2>
            <p>Your data may be processed in countries outside your jurisdiction where our service providers operate.</p>
            <p>We ensure reasonable safeguards are in place.</p>

            <h2>11. YOUR RIGHTS</h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul>
              <li>Access your data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion</li>
              <li>Withdraw consent</li>
              <li>Object to processing</li>
            </ul>
            <p>To exercise these rights, contact us at:</p>
            <p>
              <a href="mailto:support@wagenai.com">support@wagenai.com</a>
            </p>

            <h2>12. CHILDREN&apos;S PRIVACY</h2>
            <p>WagenAI is not intended for users under 18 years of age.</p>
            <p>We do not knowingly collect data from minors.</p>

            <h2>13. CHANGES TO THIS POLICY</h2>
            <p>We may update this Privacy Policy periodically.</p>
            <p>Changes will be posted on this page with updated effective date.</p>

            <h2>14. CONTACT US</h2>
            <p>If you have questions about this Privacy Policy, contact:</p>
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
