import "./../account.css";

export function Component() {
  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">Subscription</h1>
      </div>
      <div className="acc-coming-soon">
        <span className="acc-coming-soon-icon">💳</span>
        <p className="acc-coming-soon-title">Plans &amp; billing</p>
        <p className="acc-coming-soon-body">Current plan, upgrade options, add-ons, and invoices.</p>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}
