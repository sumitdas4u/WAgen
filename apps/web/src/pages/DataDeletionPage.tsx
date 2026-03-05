import { Link } from "react-router-dom";
import { OrchidsMarketingShell } from "./landing-orchids/OrchidsMarketingShell";

export function DataDeletionPage() {
  return (
    <OrchidsMarketingShell>
      <section className="orch-section orch-legal-section">
        <div className="policy-page">
          <article className="policy-card">
            <div className="policy-top">
              <Link to="/" className="policy-back">
                Back to Home
              </Link>
              <h1>Data Deletion Instructions</h1>
            </div>

            <p>
              WAgen AI respects user privacy and provides mechanisms for users to request deletion of their data in
              compliance with Meta Platform Policies and applicable data protection laws.
            </p>

            <h2>1. WHAT DATA WE STORE</h2>
            <p>When a business connects their WhatsApp Business Account via Meta Embedded Signup, WAgen AI may store:</p>
            <ul>
              <li>Business Manager ID</li>
              <li>WhatsApp Business Account ID (WABA)</li>
              <li>Phone Number ID</li>
              <li>Access tokens (encrypted)</li>
              <li>Message metadata required for platform functionality</li>
              <li>User account information (email, if provided)</li>
            </ul>
            <p>
              Message content is processed only to provide messaging functionality and is not sold or shared with third
              parties.
            </p>

            <h2>2. HOW TO REQUEST DATA DELETION</h2>
            <h3>Option 1: Email Request</h3>
            <p>
              Send an email to: <a href="mailto:support@wagenai.com">support@wagenai.com</a>
            </p>
            <p>Include:</p>
            <ul>
              <li>Your registered business name</li>
              <li>Your WhatsApp Business number</li>
              <li>Your Meta Business Manager ID</li>
            </ul>
            <p>We will process the request within 7 business days.</p>

            <h3>Option 2: Inside Platform</h3>
            <p>If you are a registered WAgen AI user:</p>
            <ul>
              <li>Log into your WAgen AI dashboard</li>
              <li>Navigate to Account Settings</li>
              <li>Select "Delete Account"</li>
              <li>Confirm deletion</li>
            </ul>
            <p>Upon confirmation:</p>
            <ul>
              <li>Your account will be permanently deleted</li>
              <li>Connected WhatsApp tokens will be revoked</li>
              <li>Associated business data will be removed</li>
            </ul>

            <h2>3. AUTOMATIC DATA DELETION</h2>
            <p>If a business disconnects WhatsApp integration:</p>
            <ul>
              <li>Access tokens are revoked immediately</li>
              <li>Webhook subscriptions are removed</li>
              <li>Associated account data is deleted from active systems</li>
            </ul>

            <h2>4. CONTACT INFORMATION</h2>
            <p>For any privacy-related questions, contact:</p>
            <p>
              WAgen AI
              <br />
              Email: <a href="mailto:support@wagenai.com">support@wagenai.com</a>
              <br />
              Website: <a href="https://wagenai.com">https://wagenai.com</a>
            </p>
          </article>
        </div>
      </section>
    </OrchidsMarketingShell>
  );
}
