import "./../account.css";

export function Component() {
  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">Message Credits</h1>
      </div>
      <div className="acc-coming-soon">
        <span className="acc-coming-soon-icon">💬</span>
        <p className="acc-coming-soon-title">WhatsApp message credits</p>
        <p className="acc-coming-soon-body">Balance, usage history, and top-up options.</p>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}
