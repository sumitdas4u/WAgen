import "./../account.css";

export function Component() {
  return (
    <div className="acc-page">
      <div className="acc-page-header">
        <h1 className="acc-page-title">AI Wallet</h1>
      </div>
      <div className="acc-coming-soon">
        <span className="acc-coming-soon-icon">🤖</span>
        <p className="acc-coming-soon-title">AI token usage</p>
        <p className="acc-coming-soon-body">Monthly AI credit balance, usage breakdown, and top-up packs.</p>
      </div>
    </div>
  );
}

export function prefetchData() {
  return undefined;
}
