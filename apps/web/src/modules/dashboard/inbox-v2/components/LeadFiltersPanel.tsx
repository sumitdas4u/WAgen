import { useConvStore } from "../store/convStore";

type NavView =
  | "mine" | "all" | "mentions" | "unattended"
  | "folder:hot" | "folder:pending"
  | "channel:api" | "channel:qr" | "channel:web";

function scoreToStage(score: number) {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function getActiveView(filters: import("../store/convStore").ConvFilters, folder: import("../store/convStore").ConvFolder): NavView {
  if (filters.channel === "api") return "channel:api";
  if (filters.channel === "qr") return "channel:qr";
  if (filters.channel === "web") return "channel:web";
  if (filters.score === "hot") return "folder:hot";
  if (folder === "pending") return "folder:pending";
  if (filters.assignment === "assigned") return "mine";
  if (filters.assignment === "unassigned") return "unattended";
  return "all";
}

interface Props {
  conversations: import("../store/convStore").Conversation[];
}

export function LeadFiltersPanel({ conversations }: Props) {
  const { filters, setFilters, folder, setFolder } = useConvStore();
  const active = getActiveView(filters, folder);

  const allCount = conversations.length;
  const mineCount = conversations.filter((c) => c.assigned_agent_profile_id).length;
  const hotCount = conversations.filter((c) => scoreToStage(c.score) === "hot").length;
  const pendingCount = conversations.filter((c) => c.status === "pending").length;

  function reset() {
    setFolder("all");
    setFilters({ stage: "all", channel: "all", score: "all", assignment: "all", dateRange: "all", aiMode: "all", kind: "all" });
  }

  function select(view: NavView) {
    reset();
    switch (view) {
      case "mine":         setFilters({ assignment: "assigned" }); break;
      case "all":          break;
      case "unattended":   setFilters({ assignment: "unassigned" }); break;
      case "folder:hot":   setFilters({ score: "hot" }); break;
      case "folder:pending": setFolder("pending"); break;
      case "channel:api":  setFilters({ channel: "api" }); break;
      case "channel:qr":   setFilters({ channel: "qr" }); break;
      case "channel:web":  setFilters({ channel: "web" }); break;
    }
  }

  const ni = (view: NavView, label: string, count?: number) => (
    <div
      className={`iv-nav-item${active === view ? " active" : ""}`}
      onClick={() => select(view)}
    >
      {label}
      {count !== undefined && <span className="iv-nav-badge">{count}</span>}
    </div>
  );

  const si = (view: NavView, label: string, dot?: string) => (
    <div
      className={`iv-nav-subitem${active === view ? " active" : ""}`}
      onClick={() => select(view)}
    >
      {dot && <span className="iv-nav-ch-dot" style={{ background: dot }} />}
      {label}
    </div>
  );

  return (
    <div className="iv-nav-tree">
      {ni("mine", "📥 My Inbox", mineCount)}

      <div className="iv-nav-section-label">Conversations</div>
      {ni("all", "💬 All Conversations", allCount)}
      {si("mentions" as NavView, "Mentions")}
      {si("unattended", "Unattended")}

      <div className="iv-nav-section-label">Folders</div>
      {si("folder:hot", "🔥 Hot Leads", undefined)}
      {si("folder:pending", "⚠️ Pending Review", undefined)}

      <div className="iv-nav-section-label">Teams</div>
      <div className="iv-nav-subitem">Sales</div>
      <div className="iv-nav-subitem">Support L1</div>
      <div className="iv-nav-subitem">Support L2</div>

      <div className="iv-nav-section-label">Channels</div>
      {si("channel:api", "WhatsApp API", "#25d366")}
      {si("channel:qr", "WhatsApp QR", "#25d366")}
      <div className="iv-nav-subitem"><span className="iv-nav-ch-dot" style={{ background: "#1877f2" }} />Facebook</div>
      <div className="iv-nav-subitem"><span className="iv-nav-ch-dot" style={{ background: "#f59e0b" }} />Email</div>
      {si("channel:web", "Web Widget", "#7c3aed")}
    </div>
  );
}
