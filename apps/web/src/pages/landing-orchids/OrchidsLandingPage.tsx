import { Link } from "react-router-dom";
import { ChatAnimation } from "./ChatAnimation";
import "./orchids-landing.css";

const FEATURE_ROWS = [
  { feature: "QR Scan Onboarding", benefit: "Go live in minutes with your existing WhatsApp number" },
  { feature: "AI Training Module", benefit: "Tailor responses for your business tone and FAQs" },
  { feature: "24/7 Auto Reply", benefit: "Never miss incoming customer messages" },
  { feature: "Smart Context Replies", benefit: "Reply with intent-aware, human-like answers" },
  { feature: "Analytics Dashboard", benefit: "Track conversations, leads, and response quality" },
  { feature: "Fallback Templates", benefit: "Use ready templates for common customer requests" }
];

const COMPARE_ROWS = [
  { feature: "QR-Scan Onboarding", wagen: "Yes", joyz: "No", quickReply: "Yes", official: "No" },
  { feature: "Works with Regular Number", wagen: "Yes", joyz: "No", quickReply: "No", official: "No" },
  { feature: "Train Your AI", wagen: "Yes", joyz: "Yes", quickReply: "Yes", official: "Depends" },
  { feature: "No Business Approval", wagen: "Yes", joyz: "No", quickReply: "No", official: "No" },
  { feature: "2-Minute Setup", wagen: "Yes", joyz: "No", quickReply: "Partial", official: "No" },
  { feature: "No API Cost", wagen: "Yes", joyz: "No", quickReply: "No", official: "No" }
];

const PLANS = [
  {
    name: "Starter",
    price: "499",
    description: "1 number, basic AI",
    features: ["1 WhatsApp Number", "Basic AI training", "24/7 auto-replies", "Email support"],
    featured: false
  },
  {
    name: "Pro",
    price: "999",
    description: "Unlimited replies plus analytics",
    features: ["1 WhatsApp Number", "Advanced AI training", "Unlimited replies", "Analytics dashboard", "Lead collection"],
    featured: true
  },
  {
    name: "Business",
    price: "1,799",
    description: "Priority support and templates",
    features: ["Up to 3 numbers", "Custom AI voice and tone", "Premium templates", "Priority support", "Optional API access"],
    featured: false
  }
];

const FAQ_ITEMS = [
  {
    q: "Do I need a business number?",
    a: "No. You can connect a regular WhatsApp number or a WhatsApp Business number."
  },
  {
    q: "Can it answer 24/7?",
    a: "Yes. Replies run continuously from cloud sessions once your WhatsApp is connected."
  },
  {
    q: "Is training difficult?",
    a: "No. You can upload FAQs, URLs, or PDFs and update responses anytime."
  },
  {
    q: "Is it safe for my number?",
    a: "The system uses managed WhatsApp Web style sessions and is intended for normal support usage."
  }
];

function icon(value: string) {
  return value === "Yes" ? "check" : value === "No" ? "cross" : "dot";
}

export function OrchidsLandingPage() {
  return (
    <main className="orch-page">
      <header className="orch-nav-wrap">
        <div className="orch-nav">
          <Link to="/" className="orch-brand">
            <span>Wagen</span>AI
          </Link>
          <nav className="orch-links">
            <a href="#features">Why WagenAI</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQs</a>
          </nav>
          <div className="orch-nav-actions">
            <Link to="/signup" className="orch-btn ghost">
              Log In
            </Link>
            <Link to="/signup?plan=pro" className="orch-btn primary">
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      <section className="orch-hero">
        <div className="orch-hero-copy">
          <p className="orch-kicker">Now Live: AI Receptionist for Everyone</p>
          <h1>
            Turn Your WhatsApp Number Into a <span>24/7 AI Receptionist</span> in Minutes
          </h1>
          <p className="orch-subtitle">
            No API. No business approval. No coding. Scan QR, train AI, and go live.
          </p>
          <div className="orch-hero-actions">
            <Link to="/signup?plan=pro" className="orch-btn primary big">
              Start Free Trial
            </Link>
            <a href="#how-it-works" className="orch-btn outline big">
              Watch Demo
            </a>
          </div>
          <p className="orch-proof">Joined by 500+ business owners this week</p>
        </div>
        <div className="orch-hero-chat">
          <ChatAnimation />
        </div>
      </section>

      <section id="features" className="orch-section muted">
        <div className="orch-heading">
          <h2>Why WagenAI</h2>
          <p>Instant AI bot with no setup headaches.</p>
        </div>
        <div className="orch-grid-3">
          <article className="orch-card">
            <h3>Forget Business APIs</h3>
            <p>Connect through QR like WhatsApp Web and start automating support quickly.</p>
            <ul>
              <li>No API cost</li>
              <li>No Meta approval flow</li>
            </ul>
          </article>
          <article className="orch-card">
            <h3>Trainable to Your Brand</h3>
            <p>Teach replies using your FAQs, product details, and support style.</p>
            <ul>
              <li>Control tone and behavior</li>
              <li>Update knowledge anytime</li>
            </ul>
          </article>
          <article className="orch-card">
            <h3>24/7 Smart Replies</h3>
            <p>Handle common customer questions while your team focuses on high-value tasks.</p>
            <ul>
              <li>Instant FAQ responses</li>
              <li>Lead info capture</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="orch-section">
        <div className="orch-heading">
          <h2>Features</h2>
          <p>Simple, benefit-driven tools.</p>
        </div>
        <div className="orch-table-wrap">
          <table className="orch-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Benefit</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td>{row.benefit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="how-it-works" className="orch-section green">
        <div className="orch-heading">
          <h2>How It Works</h2>
          <p>Four steps to automate WhatsApp support.</p>
        </div>
        <div className="orch-how">
          <ol>
            <li>
              <strong>Scan QR</strong>
              <span>Connect your WhatsApp in one scan.</span>
            </li>
            <li>
              <strong>Train AI</strong>
              <span>Upload FAQs, URLs, or documents.</span>
            </li>
            <li>
              <strong>Go Live</strong>
              <span>Auto-replies start immediately.</span>
            </li>
            <li>
              <strong>Improve</strong>
              <span>Use analytics to refine responses.</span>
            </li>
          </ol>
          <img
            src="https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/render/image/public/project-uploads/8fdb0fa7-616c-4423-933c-f1527dd1b4b0/image-1772246784150.png?width=1600&height=1600&resize=contain"
            alt="WhatsApp onboarding QR step"
            loading="lazy"
          />
        </div>
      </section>

      <section className="orch-section">
        <div className="orch-heading">
          <h2>Compare with Others</h2>
          <p>See where WagenAI differs.</p>
        </div>
        <div className="orch-table-wrap">
          <table className="orch-table orch-compare">
            <thead>
              <tr>
                <th>Feature</th>
                <th>WagenAI</th>
                <th>Joyz.ai</th>
                <th>QuickReply.ai</th>
                <th>Official API Tools</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.feature}>
                  <td>{row.feature}</td>
                  <td className={icon(row.wagen)}>{row.wagen}</td>
                  <td className={icon(row.joyz)}>{row.joyz}</td>
                  <td className={icon(row.quickReply)}>{row.quickReply}</td>
                  <td className={icon(row.official)}>{row.official}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="orch-section dark">
        <div className="orch-heading">
          <h2>Use Cases</h2>
          <p>Built for real businesses.</p>
        </div>
        <div className="orch-grid-4">
          <article className="orch-dark-card">
            <h3>Shop Owners</h3>
            <p>Reply to product queries instantly.</p>
          </article>
          <article className="orch-dark-card">
            <h3>Restaurants</h3>
            <p>Confirm bookings and answer menu questions.</p>
          </article>
          <article className="orch-dark-card">
            <h3>Service Providers</h3>
            <p>Capture leads and schedule appointments.</p>
          </article>
          <article className="orch-dark-card">
            <h3>Freelancers</h3>
            <p>Handle client chats without missing messages.</p>
          </article>
        </div>
      </section>

      <section className="orch-section">
        <div className="orch-heading">
          <h2>Customer Testimonials</h2>
        </div>
        <div className="orch-grid-2">
          <article className="orch-quote">
            <p>WagenAI doubled my leads. I do not need to reply at midnight anymore.</p>
            <small>Priya, Boutique Owner</small>
          </article>
          <article className="orch-quote">
            <p>Setup was fast. My WhatsApp now works like a real receptionist.</p>
            <small>Rahul, Fitness Trainer</small>
          </article>
        </div>
      </section>

      <section id="pricing" className="orch-section muted">
        <div className="orch-heading">
          <h2>Pricing</h2>
          <p>Simple plans for every stage.</p>
        </div>
        <div className="orch-grid-3">
          {PLANS.map((plan) => (
            <article key={plan.name} className={plan.featured ? "orch-plan featured" : "orch-plan"}>
              <h3>{plan.name}</h3>
              <small>{plan.description}</small>
              <p className="orch-price">
                INR {plan.price} <span>/ month</span>
              </p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link
                className={plan.featured ? "orch-btn primary" : "orch-btn outline"}
                to={`/signup?plan=${plan.name.toLowerCase()}`}
              >
                Choose {plan.name}
              </Link>
            </article>
          ))}
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
        <h2>Need help setting up?</h2>
        <p>We can help you launch quickly on your existing WhatsApp number.</p>
        <div className="orch-hero-actions">
          <a href="mailto:support@wagenai.com" className="orch-btn light">
            Email Support
          </a>
          <Link to="/signup" className="orch-btn dark">
            Chat Support
          </Link>
        </div>
      </section>

      <footer className="orch-footer">
        <div className="orch-footer-grid">
          <article>
            <h4>
              <span>Wagen</span>AI
            </h4>
            <p>Turn your WhatsApp number into an AI receptionist.</p>
          </article>
          <article>
            <h5>Product</h5>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#how-it-works">How It Works</a>
          </article>
          <article>
            <h5>Company</h5>
            <a href="#">About</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </article>
          <article>
            <h5>Contact</h5>
            <a href="mailto:support@wagenai.com">support@wagenai.com</a>
          </article>
        </div>
        <p className="orch-copy">Copyright 2026 WagenAI. All rights reserved.</p>
      </footer>
    </main>
  );
}
