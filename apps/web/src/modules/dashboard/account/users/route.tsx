import "./../account.css";

export function Component() {
  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">Users &amp; Teams</h1>
      </div>
      <div className="acc-coming-soon">
        <span className="acc-coming-soon-icon">👥</span>
        <p className="acc-coming-soon-title">Team members</p>
        <p className="acc-coming-soon-body">Invite members, manage roles, and team permissions.</p>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}
