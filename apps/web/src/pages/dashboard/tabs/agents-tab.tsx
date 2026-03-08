import type { AgentProfile } from "../../../lib/api";

type AgentObjectiveType = "lead" | "feedback" | "complaint" | "hybrid";

interface AgentsTabProps {
  busy: boolean;
  selectedAgentProfile: AgentProfile | null;
  agentActive: boolean;
  agentName: string;
  agentObjectiveType: AgentObjectiveType;
  agentTaskDescription: string;
  onToggleAgentActive: () => void;
  onAgentNameChange: (value: string) => void;
  onAgentObjectiveTypeChange: (value: AgentObjectiveType) => void;
  onAgentTaskDescriptionChange: (value: string) => void;
  onSubmit: () => void;
}

export function AgentsTab(props: AgentsTabProps) {
  const {
    busy,
    selectedAgentProfile,
    agentActive,
    agentName,
    agentObjectiveType,
    agentTaskDescription,
    onToggleAgentActive,
    onAgentNameChange,
    onAgentObjectiveTypeChange,
    onAgentTaskDescriptionChange,
    onSubmit
  } = props;

  const statusClassName = !selectedAgentProfile
    ? "agent-status-pill disabled"
    : agentActive
      ? "agent-status-pill live"
      : "agent-status-pill paused";
  const statusLabel = !selectedAgentProfile ? "NOT CONFIGURED" : agentActive ? "LIVE" : "PAUSED";

  return (
    <section className="clone-settings-view agent-manager-shell">
      <div className="agent-manager-head">
        <div className="agent-manager-title">
          <h3>Agent Workflow</h3>
          <p>One shared AI workflow runs across Web chat, WhatsApp QR, and WhatsApp API channels.</p>
        </div>
        <div className="clone-hero-actions">
          <span className={statusClassName}>{statusLabel}</span>
          <button type="button" className="ghost-btn" disabled={busy} onClick={onToggleAgentActive}>
            {agentActive ? "Pause Agent" : "Activate Agent"}
          </button>
        </div>
      </div>

      <form
        className="stack-form clone-settings-form agent-workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h3>{selectedAgentProfile ? "Update Workflow" : "Create Workflow"}</h3>
        <div className="train-grid two-col simple-agent-grid">
          <label>
            Name of the AI agent
            <input required value={agentName} onChange={(event) => onAgentNameChange(event.target.value)} />
          </label>
          <label>
            Agent Nature
            <select
              value={agentObjectiveType}
              onChange={(event) => onAgentObjectiveTypeChange(event.target.value as AgentObjectiveType)}
            >
              <option value="lead">Lead Capture Agent</option>
              <option value="feedback">Feedback Agent</option>
              <option value="complaint">Complaint Agent</option>
              <option value="hybrid">Hybrid Agent</option>
            </select>
          </label>
          <label className="agent-task-field">
            Define the task you want to achieve using this agent.
            <textarea
              required
              value={agentTaskDescription}
              onChange={(event) => onAgentTaskDescriptionChange(event.target.value)}
              placeholder="Ex - Capture qualified leads and ask one clear next-step question. Or handle complaints and collect order ID before escalation."
            />
          </label>
        </div>
        <p className="tiny-note">
          This single workflow is applied across all channels. No separate per-channel agent setup is required.
        </p>
        {selectedAgentProfile && (
          <p className="tiny-note">
            Last updated: {new Date(selectedAgentProfile.updatedAt).toLocaleString()}
          </p>
        )}
        <div className="clone-hero-actions">
          <button className="primary-btn" type="submit" disabled={busy}>
            {selectedAgentProfile ? "Save Workflow" : "Create Workflow"}
          </button>
        </div>
      </form>
    </section>
  );
}
