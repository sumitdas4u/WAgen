import { Navigate } from "react-router-dom";

export function Component() {
  return <Navigate to="/dashboard/account/credits" replace />;
}

export function prefetchData() {
  return undefined;
}
