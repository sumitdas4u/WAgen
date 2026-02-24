import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";

function HeroVector() {
  return (
    <svg viewBox="0 0 620 440" role="img" aria-label="WAgen hero placeholder vector">
      <rect x="42" y="58" width="300" height="52" rx="16" fill="#fff" stroke="#D9DEE8" />
      <circle cx="24" cy="84" r="16" fill="#E9EEF7" />
      <rect x="74" y="74" width="220" height="12" rx="6" fill="#515D7B" opacity="0.8" />

      <rect x="76" y="136" width="336" height="84" rx="16" fill="#EFF2F8" stroke="#D9DEE8" />
      <rect x="96" y="154" width="280" height="14" rx="7" fill="#414B63" opacity="0.82" />
      <rect x="96" y="176" width="202" height="12" rx="6" fill="#6F7891" opacity="0.7" />

      <rect x="30" y="244" width="170" height="42" rx="14" fill="#FFFFFF" stroke="#DFE4EE" />
      <circle cx="16" cy="264" r="13" fill="#E8EDF8" />
      <rect x="56" y="258" width="106" height="10" rx="5" fill="#7C86A1" />

      <path d="M318 344c0-54-44-98-98-98s-98 44-98 98" stroke="#262B36" strokeWidth="4" fill="none" />
      <circle cx="220" cy="216" r="38" fill="#FFFFFF" stroke="#262B36" strokeWidth="4" />
      <path d="M190 202c4-14 17-24 30-24s26 10 30 24" stroke="#262B36" strokeWidth="4" fill="none" />
      <path d="M186 292l-50 64m168-64l50 64" stroke="#262B36" strokeWidth="4" />
      <rect x="182" y="274" width="76" height="92" rx="22" fill="#FFFFFF" stroke="#262B36" strokeWidth="4" />
      <rect x="198" y="296" width="44" height="58" rx="10" fill="#EFF2F8" stroke="#262B36" strokeWidth="3" />

      <rect x="456" y="244" width="118" height="48" rx="14" fill="#DDF4E5" />
      <rect x="478" y="262" width="72" height="12" rx="6" fill="#47A36D" />
      <rect x="456" y="150" width="118" height="48" rx="14" fill="#E8ECF7" />
      <rect x="478" y="168" width="72" height="12" rx="6" fill="#717FA6" />
    </svg>
  );
}

function QrVector() {
  return (
    <svg viewBox="0 0 520 380" role="img" aria-label="QR onboarding placeholder vector">
      <rect x="110" y="16" width="300" height="344" rx="46" fill="#F7F8FC" stroke="#DCE1EA" strokeWidth="6" />
      <rect x="216" y="34" width="88" height="16" rx="8" fill="#222735" />
      <text x="260" y="96" textAnchor="middle" fill="#6A748E" fontSize="16" fontWeight="600">
        Scan QR to connect
      </text>

      <rect x="176" y="116" width="168" height="168" rx="16" fill="#ffffff" stroke="#CED5E3" strokeWidth="4" />
      <rect x="194" y="134" width="36" height="36" fill="#263045" />
      <rect x="294" y="134" width="36" height="36" fill="#263045" />
      <rect x="194" y="234" width="36" height="36" fill="#263045" />
      <rect x="248" y="162" width="28" height="28" fill="#263045" />
      <rect x="264" y="214" width="20" height="20" fill="#263045" />
      <rect x="236" y="220" width="14" height="14" fill="#263045" />

      <rect x="66" y="76" width="106" height="62" rx="14" fill="#FFFFFF" stroke="#DCE1EA" />
      <text x="119" y="112" textAnchor="middle" fill="#253049" fontSize="15" fontWeight="700">
        Instant
      </text>

      <rect x="366" y="260" width="106" height="62" rx="14" fill="#FFFFFF" stroke="#DCE1EA" />
      <text x="419" y="296" textAnchor="middle" fill="#253049" fontSize="15" fontWeight="700">
        Go Live
      </text>
    </svg>
  );
}

function ChatVector() {
  return (
    <svg viewBox="0 0 520 360" role="img" aria-label="Chat automation placeholder vector">
      <rect x="72" y="18" width="268" height="324" rx="34" fill="#F8F9FD" stroke="#DCE1EA" strokeWidth="6" />
      <rect x="142" y="36" width="128" height="12" rx="6" fill="#242A39" />

      <rect x="116" y="90" width="180" height="44" rx="14" fill="#EDEFF6" />
      <rect x="130" y="106" width="140" height="10" rx="5" fill="#656F8B" />
      <rect x="92" y="146" width="206" height="78" rx="16" fill="#FFFFFF" stroke="#DCE1EA" />
      <rect x="112" y="164" width="160" height="12" rx="6" fill="#37415C" opacity="0.9" />
      <rect x="112" y="184" width="120" height="10" rx="5" fill="#6A7491" opacity="0.8" />
      <rect x="196" y="238" width="118" height="42" rx="14" fill="#EDEFF6" />
      <rect x="214" y="254" width="76" height="10" rx="5" fill="#5D6785" />

      <rect x="20" y="208" width="110" height="62" rx="14" fill="#FFFFFF" stroke="#DCE1EA" />
      <text x="75" y="244" textAnchor="middle" fill="#253049" fontSize="14" fontWeight="700">
        Instant Reply
      </text>

      <rect x="318" y="40" width="112" height="62" rx="14" fill="#FFFFFF" stroke="#DCE1EA" />
      <text x="374" y="74" textAnchor="middle" fill="#253049" fontSize="14" fontWeight="700">
        24/7 Support
      </text>
    </svg>
  );
}

function CardsVector() {
  return (
    <svg viewBox="0 0 520 320" role="img" aria-label="Insights placeholder vector">
      <rect x="54" y="46" width="176" height="240" rx="18" transform="rotate(-8 54 46)" fill="#F4F6FC" stroke="#DEE4EE" />
      <rect x="168" y="28" width="206" height="258" rx="22" fill="#FFFFFF" stroke="#D5DCE8" strokeWidth="2" />
      <rect x="316" y="46" width="176" height="240" rx="18" transform="rotate(8 316 46)" fill="#F4F6FC" stroke="#DEE4EE" />

      <rect x="198" y="70" width="142" height="22" rx="11" fill="#EDEFF6" />
      <rect x="198" y="112" width="120" height="12" rx="6" fill="#37415C" />
      <rect x="198" y="132" width="150" height="10" rx="5" fill="#707B99" opacity="0.8" />
      <rect x="198" y="148" width="110" height="10" rx="5" fill="#707B99" opacity="0.8" />
      <rect x="198" y="182" width="132" height="44" rx="14" fill="#161C2B" />
      <text x="264" y="210" textAnchor="middle" fill="#FFFFFF" fontSize="14" fontWeight="700">
        Add answer
      </text>
    </svg>
  );
}

const WHAT_IF_CARDS = [
  "Your customers never have to wait for a reply.",
  "Every incoming query gets handled instantly and accurately based on your business information.",
  "Your support team stays focused without getting flooded by repetitive queries."
];

export function LandingPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate, token]);

  return (
    <main className="joy-home">
      <header className="joy-wrap joy-nav-shell">
        <div className="joy-nav">
          <Link className="joy-logo" to="/">
            WAgen
          </Link>

          <nav className="joy-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#resources">Resources</a>
            <a href="#industries">Industries</a>
          </nav>

          <div className="joy-nav-cta">
            <Link className="joy-btn joy-btn-ghost" to="/signup">
              Sign In
            </Link>
            <Link className="joy-btn joy-btn-primary" to="/signup">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <section className="joy-wrap joy-hero">
        <article className="joy-hero-copy">
          <h1>Engage and close faster with WhatsApp AI Chatbot</h1>
          <p>
            Instantly reply to every customer and reduce support load with a no-code WhatsApp AI chatbot.
          </p>

          <ul>
            <li>Works with WhatsApp groups.</li>
            <li>No API needed.</li>
          </ul>

          <Link className="joy-btn joy-btn-primary" to="/signup">
            Request a Demo
          </Link>
        </article>

        <div className="joy-vector-card">
          <HeroVector />
        </div>
      </section>

      <section className="joy-wrap joy-what" id="features">
        <h2>What is WhatsApp AI Chatbot?</h2>
        <p>A WhatsApp chatbot is an AI assistant that automatically replies to your customers on WhatsApp, at scale.</p>
        <strong>What if:</strong>
        <div className="joy-what-grid">
          {WHAT_IF_CARDS.map((text) => (
            <article key={text}>{text}</article>
          ))}
        </div>
        <small>This is exactly what WAgen helps you achieve.</small>
      </section>

      <section className="joy-wrap joy-diff" id="resources">
        <div className="joy-vector-card">
          <ChatVector />
        </div>
        <article>
          <h3>How WAgen WhatsApp chatbot is different</h3>
          <p>
            No need to design complex flow templates for every case. WAgen understands user queries and answers based
            on your business context.
          </p>
          <p>
            You get structured automation with natural conversation quality, while keeping full control over tone and
            intent handling.
          </p>
        </article>
      </section>

      <section className="joy-wrap joy-banner" id="pricing">
        <div>
          <h3>Resolve your customer queries</h3>
          <p>Let WAgen handle customer questions instantly and accurately.</p>
        </div>
        <div className="joy-banner-cta">
          <Link className="joy-btn joy-btn-dark" to="/signup">
            Get Started
          </Link>
          <Link className="joy-btn joy-btn-primary" to="/signup">
            Request a Demo
          </Link>
        </div>
      </section>

      <section className="joy-wrap joy-split" id="industries">
        <article>
          <h3>Instant WhatsApp integration</h3>
          <ul>
            <li>Works with WhatsApp groups.</li>
            <li>No API needed.</li>
          </ul>
          <Link className="joy-btn joy-btn-primary" to="/signup">
            Request a Demo
          </Link>
        </article>
        <div className="joy-vector-card">
          <QrVector />
        </div>
      </section>

      <section className="joy-wrap joy-grid-2">
        <div className="joy-vector-card">
          <ChatVector />
        </div>
        <article>
          <h3>Automatically answer queries 24/7</h3>
          <ul>
            <li>Give instant responses to all queries.</li>
            <li>Even when your team is sleeping.</li>
          </ul>
          <Link className="joy-btn joy-btn-primary" to="/signup">
            Request a Demo
          </Link>
        </article>
      </section>

      <section className="joy-wrap joy-grid-2 reverse">
        <article>
          <h3>Answer questions in the user's language</h3>
          <ul>
            <li>Detect user language automatically.</li>
            <li>Reply in simple language for better understanding.</li>
            <li>Reduce drop-offs caused by language barriers.</li>
          </ul>
          <Link className="joy-btn joy-btn-primary" to="/signup">
            Request a Demo
          </Link>
        </article>
        <div className="joy-vector-card">
          <CardsVector />
        </div>
      </section>

      <section className="joy-wrap joy-insights">
        <article>
          <h3>Insights to improve your support process</h3>
          <ul>
            <li>Know what your customers ask most frequently.</li>
            <li>Spot messages that go unanswered.</li>
            <li>Add new knowledge articles to improve chatbot effectiveness.</li>
          </ul>
          <Link className="joy-btn joy-btn-primary" to="/signup">
            Request a Demo
          </Link>
        </article>
        <div className="joy-vector-card">
          <CardsVector />
        </div>
      </section>
    </main>
  );
}

