import { Navigate } from "react-router-dom";

export function Component() {
  return <Navigate to="/dashboard/account/ai-wallet" replace />;
}

export function prefetchData() {
  return undefined;
}
