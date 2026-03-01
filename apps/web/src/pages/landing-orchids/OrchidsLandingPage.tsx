import { Link } from "react-router-dom";
import { ChatAnimation } from "./ChatAnimation";
import "./orchids-landing.css";

const STARTER_POINTS = [
  "Setup in 2 minutes",
  "No approval required",
  "Train AI easily",
  "Affordable",
];

const SCALE_POINTS = [
  "Official WhatsApp Business API",
  "No ban risk",
  "High message volume",
  "Multi-agent support",
  "CRM integrations",
];

const COMPARISON_ROWS = [
  { feature: "Setup Time", qr: "2 Minutes", api: "1-2 Days" },
  { feature: "WhatsApp Approval", qr: "Not Required", api: "Required" },
  { feature: "Ban Risk", qr: "Medium", api: "Very Low" },
  { feature: "Bulk Messaging", qr: "Limited", api: "Full Support" },
  { feature: "Multi Agents", qr: "No", api: "Yes" },
  { feature: "Automation", qr: "Basic", api: "Advanced" },
  { feature: "Ideal For", qr: "Testing", api: "Growing Businesses" },
];

const USE_CASES = [
  "Restaurants",
  "E-commerce",
  "Coaching Institutes",
  "Clinics",
  "Real Estate",
  "Agencies",
];

const FAQ_ITEMS = [
  {
    q: "Is QR Mode safe?",
    a: "It is ideal for testing and small use.",
  },
  {
    q: "Is Official API better?",
    a: "Yes, for scaling and high message volume.",
  },
  {
    q: "Can I upgrade later?",
    a: "Yes, you can upgrade anytime.",
  },
];

export function OrchidsLandingPage() {
  return (
    <main className="orch-page">
      <header className="orch-nav-wrap">
        <div className="orch-nav">
          <Link to="/" className="orch-brand">
            <span>Wagen</span>AI
          </Link>
          <nav className="orch-links">
            <a href="#modes">Modes</a>
            <a href="#comparison">Comparison</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="orch-nav-actions">
            <Link to="/signup?plan=starter" className="orch-btn primary">
              Start Free
            </Link>
          </div>
        </div>
      </header>

      <section className="orch-hero">
        <div className="orch-hero-copy">
          <p className="orch-kicker">WhatsApp AI Automation Platform for Startups, SMBs and Enterprises</p>
          <h1>
            Automate Your WhatsApp with AI - From Instant Setup to <span>Official API Scale</span>
          </h1>
          <p className="orch-subtitle">
            Start instantly with QR mode. Upgrade anytime to official WhatsApp Business API for large-scale automation.
          </p>
          <div className="orch-hero-actions">
            <Link to="/signup?plan=starter" className="orch-btn primary big">
              Start Free (QR Mode)
            </Link>
            <Link to="/signup?plan=growth" className="orch-btn outline big">
              Get Official WhatsApp API
            </Link>
          </div>
        </div>
        <div className="orch-hero-chat">
          <ChatAnimation />
        </div>
      </section>

      <section id="modes" className="orch-section muted">
        <div className="orch-heading">
          <h2>Choose Your Mode</h2>
          <p>One platform, two paths: Instant start or official scale.</p>
        </div>
        <div className="orch-grid-2">
          <article className="orch-card">
            <h3>Mode 1 - Instant QR Setup (Starter)</h3>
            <p>Perfect for testing and small businesses.</p>
            <ul>
              {STARTER_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p className="orch-proof">Best for limited usage and testing.</p>
            <p className="orch-price">
              ₹99 <span>/ month</span>
            </p>
          </article>

          <article className="orch-card">
            <h3>Mode 2 - Official WhatsApp API (Scale)</h3>
            <p>For serious business automation.</p>
            <ul>
              {SCALE_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p className="orch-price">
              ₹249 <span>/ month</span>
            </p>
            <p className="orch-proof">or ₹2000/year</p>
          </article>
        </div>
      </section>

      <section className="orch-section green">
        <div className="orch-heading">
          <h2>Why Official API Is Important</h2>
          <p>
            Many tools only use QR connection. QR can disconnect, is not reliable for scale, and carries number restriction risk.
          </p>
        </div>
        <div className="orch-grid-2">
          <article className="orch-card">
            <h3>What WagenAI Offers</h3>
            <ul>
              <li>Instant QR for testing</li>
              <li>Official API for long-term growth</li>
            </ul>
            <p className="orch-proof">You choose what fits your business.</p>
          </article>
          <article className="orch-card">
            <h3>Transparent Recommendation</h3>
            <p>
              QR mode is ideal for testing and early-stage businesses. For long-term growth, we recommend upgrading to Official API mode.
            </p>
          </article>
        </div>
      </section>

      <section id="comparison" className="orch-section">
        <div className="orch-heading">
          <h2>Feature Comparison Table</h2>
          <p>QR Mode vs Official API Mode.</p>
        </div>
        <div className="orch-table-wrap">
          <table className="orch-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>QR Mode</th>
                <th>Official API Mode</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td>{row.qr}</td>
                  <td>{row.api}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="orch-section dark">
        <div className="orch-heading">
          <h2>Use Cases</h2>
          <p>Built for real businesses across industries.</p>
        </div>
        <div className="orch-grid-3">
          {USE_CASES.map((item) => (
            <article key={item} className="orch-dark-card">
              <h3>{item}</h3>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="orch-section muted">
        <div className="orch-heading">
          <h2>Pricing</h2>
        </div>
        <div className="orch-grid-2">
          <article className="orch-plan">
            <h3>Starter (QR Mode)</h3>
            <small>Instant AI Bot Setup</small>
            <p className="orch-price">
              ₹99 <span>/ month</span>
            </p>
            <Link className="orch-btn primary" to="/signup?plan=starter">
              Start Free (QR Mode)
            </Link>
          </article>

          <article className="orch-plan featured">
            <h3>Growth (API Mode)</h3>
            <small>Official WhatsApp API + AI Automation</small>
            <p className="orch-price">
              ₹249 <span>/ month</span>
            </p>
            <small>or ₹2000/year</small>
            <Link className="orch-btn outline" to="/signup?plan=growth">
              Get Official WhatsApp API
            </Link>
          </article>
        </div>
      </section>

      <section id="faq" className="orch-section">
        <div className="orch-heading">
          <h2>FAQ</h2>
        </div>
        <div className="orch-faq">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="orch-support">
        <h2>Need help choosing a mode?</h2>
        <p>Start with QR mode now and move to Official API when you scale.</p>
        <div className="orch-hero-actions">
          <a href="mailto:support@wagenai.com" className="orch-btn light">
            Email Support
          </a>
          <Link to="/signup" className="orch-btn dark">
            Start Setup
          </Link>
        </div>
      </section>

      <footer className="orch-footer">
        <div className="orch-footer-grid">
          <article>
            <h4>
              <span>Wagen</span>AI
            </h4>
            <p>WhatsApp AI Automation Platform with QR Setup and Official API Scale.</p>
          </article>
          <article>
            <h5>Product</h5>
            <a href="#modes">Modes</a>
            <a href="#comparison">Comparison</a>
            <a href="#pricing">Pricing</a>
          </article>
          <article>
            <h5>Support</h5>
            <a href="#faq">FAQ</a>
            <Link to="/privacy-policy">Privacy Policy</Link>
            <Link to="/terms-of-service">Terms of Service</Link>
            <Link to="/contact-us">Contact Us</Link>
            <a href="mailto:support@wagenai.com">support@wagenai.com</a>
          </article>
          <article>
            <h5>CTA</h5>
            <Link to="/signup?plan=starter">Start Free</Link>
            <Link to="/signup?plan=growth">Get Official API</Link>
          </article>
        </div>
        <p className="orch-copy">Copyright 2026 WagenAI. All rights reserved.</p>
      </footer>
    </main>
  );
}
