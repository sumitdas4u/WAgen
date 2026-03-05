import { Link } from "react-router-dom";

export function OrchidsHeader() {
  return (
    <nav className="wl-nav">
      <Link to="/" className="logo">
        Wagen<span>AI</span>
      </Link>
      <ul className="nav-links">
        <li>
          <a href="/#features">Features</a>
        </li>
        <li>
          <a href="/#how">How it Works</a>
        </li>
        <li>
          <a href="/#industries">Industries</a>
        </li>
        <li>
          <a href="/#channels">Channels</a>
        </li>
      </ul>
      <div className="nav-right">
        <Link to="/signup" className="btn-login">
          Log In
        </Link>
        <Link to="/signup?plan=starter" className="btn-cta">
          Start Free (QR Mode)
        </Link>
      </div>
    </nav>
  );
}
