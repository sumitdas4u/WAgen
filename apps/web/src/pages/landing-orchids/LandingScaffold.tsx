import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./orchids-landing.css";

type LandingScaffoldProps = {
  children: ReactNode;
};

export function LandingScaffold({ children }: LandingScaffoldProps) {
  return (
    <main className="orch-page">
      <header className="orch-nav-wrap">
        <div className="orch-nav">
          <Link to="/" className="orch-brand">
            <span>Wagen</span>AI
          </Link>
          <nav className="orch-links">
            <a href="/#modes">Modes</a>
            <a href="/#comparison">Comparison</a>
            <a href="/#pricing">Pricing</a>
            <a href="/#faq">FAQ</a>
          </nav>
          <div className="orch-nav-actions">
            <Link to="/signup?plan=starter" className="orch-btn primary">
              Start Free
            </Link>
          </div>
        </div>
      </header>

      {children}

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
            <a href="/#modes">Modes</a>
            <a href="/#comparison">Comparison</a>
            <a href="/#pricing">Pricing</a>
          </article>
          <article>
            <h5>Support</h5>
            <a href="/#faq">FAQ</a>
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
