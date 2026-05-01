import { NavLink } from "react-router-dom";

/**
 * Shown when a user navigates to a module their plan doesn't include.
 * Edit this one file to change the look/copy everywhere.
 */
export function ModuleNoPermission() {
  return (
    <div className="no-perm-shell">
      <div className="no-perm-card">
        <div className="no-perm-icon">🔒</div>
        <h2 className="no-perm-title">Upgrade your plan</h2>
        <p className="no-perm-body">
          This feature isn't included in your current plan.
          Upgrade to unlock it and get access to more AI credits,
          flows, and automation tools.
        </p>
        <NavLink className="no-perm-btn" to="/dashboard/account/subscription">
          View plans &amp; upgrade
        </NavLink>
      </div>
    </div>
  );
}
