// Legacy redirect — super admin UI has moved to pages/super-admin/
import { Navigate } from "react-router-dom";
export function SuperAdminPage() {
  return <Navigate to="/super-admin" replace />;
}
