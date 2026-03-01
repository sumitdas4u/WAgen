import { Link } from "react-router-dom";
import { LandingScaffold } from "./landing-orchids/LandingScaffold";

export function ContactUsPage() {
  return (
    <LandingScaffold>
      <section className="orch-section orch-legal-section">
        <div className="policy-page">
          <article className="policy-card">
            <div className="policy-top">
              <Link to="/" className="policy-back">
                Back to Home
              </Link>
              <h1>Contact Us</h1>
            </div>

            <p>WagenAI is a product of KEYLINE DIGITECH PVT. LTD.</p>
            <p>
              We are committed to providing secure and scalable WhatsApp automation solutions for businesses of all
              sizes.
            </p>
            <p>
              If you have any questions about our services, subscriptions, WhatsApp Business API setup, or technical
              support, please contact us using the details below.
            </p>

            <h2>Parent Company</h2>
            <p>
              KEYLINE DIGITECH PVT. LTD.
              <br />
              36A, Chandi Ghosh Road
              <br />
              Kolkata - 700040
              <br />
              West Bengal, India
              <br />
              (Near Netaji Metro, Opposite Kolkata Movietone Studio)
            </p>
            <p>
              Website: <a href="https://keylines.net/">https://keylines.net/</a>
            </p>

            <h2>Email Support</h2>
            <p>
              General Support:
              <br />
              <a href="mailto:support@wagenai.com">support@wagenai.com</a>
            </p>
            <p>
              Sales &amp; Business Inquiries:
              <br />
              <a href="mailto:sales@wagenai.com">sales@wagenai.com</a>
            </p>
            <p>
              Billing &amp; Subscription Queries:
              <br />
              <a href="mailto:billing@wagenai.com">billing@wagenai.com</a>
            </p>
            <p>
              Legal &amp; Compliance:
              <br />
              <a href="mailto:legal@wagenai.com">legal@wagenai.com</a>
            </p>
            <p>We aim to respond within 24-48 business hours.</p>

            <h2>Phone Support</h2>
            <p>
              Phone: <a href="tel:+919804735837">+91-9804735837</a>
              <br />
              (Monday to Friday, 10:00 AM - 6:00 PM IST)
            </p>

            <h2>Official Website</h2>
            <p>
              <a href="https://wagenai.com">https://wagenai.com</a>
            </p>
          </article>
        </div>
      </section>
    </LandingScaffold>
  );
}
