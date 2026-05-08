interface ComingSoonProps {
  title: string;
  description?: string;
}

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div>
      <div className="sa-page-header" style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#122033", margin: 0 }}>{title}</h1>
      </div>
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #e2eaf4",
        textAlign: "center",
        gap: 12,
      }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.4rem",
          marginBottom: 4,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "#122033", margin: 0 }}>
          Coming Soon
        </p>
        <p style={{ fontSize: "0.82rem", color: "#64748b", margin: 0, maxWidth: 340 }}>
          {description ?? `${title} will be available in the next phase of the Super Admin rollout.`}
        </p>
      </div>
    </div>
  );
}
