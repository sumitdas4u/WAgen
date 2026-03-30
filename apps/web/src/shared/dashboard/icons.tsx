import type { DashboardIconName } from "./module-contracts";

export function DashboardIcon({ name }: { name: DashboardIconName }) {
  switch (name) {
    case "brand":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <rect x="3" y="3" width="14" height="14" rx="3" />
          <path d="M7 13v-2m3 2V7m3 6V9" />
        </svg>
      );
    case "chats":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M5 5.5h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9l-3 2v-2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
        </svg>
      );
    case "leads":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M4 14.5V9.8m4 4.7V6.8m4 7.7v-3.7m4 3.7V5.5" />
        </svg>
      );
    case "billing":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <rect x="3.5" y="5" width="13" height="10" rx="2" />
          <path d="M3.5 8h13M7 12h2.5" />
        </svg>
      );
    case "flows":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <rect x="3.5" y="5" width="4" height="4" rx="1" />
          <rect x="12.5" y="3.5" width="4" height="4" rx="1" />
          <rect x="12.5" y="12.5" width="4" height="4" rx="1" />
          <path d="M7.5 7h3.4M10.9 7V5.5M10.9 7v7M10.9 14.5h1.6" />
        </svg>
      );
    case "knowledge":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M6 4.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5H7.5A2.5 2.5 0 0 0 5 17V6a1.5 1.5 0 0 1 1-1.5Z" />
          <path d="M7.5 14.5H15.5V17H7.5a2.5 2.5 0 0 1 0-5h8" />
        </svg>
      );
    case "test":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M5 4.5h10M7 4.5l1 11h4l1-11M8 9h4" />
        </svg>
      );
    case "agents":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <rect x="5" y="6.5" width="10" height="8" rx="2" />
          <path d="M8 6.5V5a2 2 0 0 1 4 0v1.5M7.5 10h5" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <circle cx="10" cy="10" r="2.2" />
          <path d="M10 4.2v1.7M10 14.1v1.7M15.8 10h-1.7M5.9 10H4.2M13.9 6.1l-1.2 1.2M7.3 12.7l-1.2 1.2M13.9 13.9l-1.2-1.2M7.3 7.3L6.1 6.1" />
        </svg>
      );
    case "personality":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <circle cx="10" cy="8" r="3" />
          <path d="M5 15.5a5 5 0 0 1 10 0" />
        </svg>
      );
    case "unanswered":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M7.2 7.5a2.8 2.8 0 1 1 4.6 2.1c-.9.7-1.8 1.2-1.8 2.4" />
          <circle cx="10" cy="14.5" r=".6" fill="currentColor" stroke="none" />
          <circle cx="10" cy="10" r="7" />
        </svg>
      );
    case "logout":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M8 5.5H5.5A1.5 1.5 0 0 0 4 7v6a1.5 1.5 0 0 0 1.5 1.5H8" />
          <path d="M11 7.5 14 10l-3 2.5M14 10H7" />
        </svg>
      );
    default:
      return null;
  }
}
