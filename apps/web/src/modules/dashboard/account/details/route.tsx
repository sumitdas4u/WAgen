import "./../account.css";

export function Component() {
  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">Account Details</h1>
      </div>
      <div className="acc-coming-soon">
        <span className="acc-coming-soon-icon">🏢</span>
        <p className="acc-coming-soon-title">Workspace details</p>
        <p className="acc-coming-soon-body">Company name, timezone, and workspace preferences.</p>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}
