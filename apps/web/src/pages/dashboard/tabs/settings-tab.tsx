import type { ReactNode, RefObject } from "react";

type SettingsSubmenu = "setup_web" | "setup_qr" | "setup_api";

type WidgetSetupDraft = {
  chatbotLogoUrl: string;
  chatbotSize: "small" | "medium" | "large";
  deviceVisibility: "both" | "phone" | "desktop";
  initialQuestions: [string, string, string];
  initialGreetingEnabled: boolean;
  initialGreeting: string;
  disclaimer: string;
  backgroundColor: string;
  previewOpen: boolean;
};

type WhatsAppBusinessProfileDraft = {
  displayPictureUrl: string;
  address: string;
  businessDescription: string;
  email: string;
  vertical: string;
  websiteUrl: string;
  about: string;
};

interface SettingsTabProps {
  websiteChannelEnabled: boolean;
  qrChannelConnected: boolean;
  apiChannelConnected: boolean;
  busy: boolean;
  settingsSubmenu: SettingsSubmenu;
  widgetSetupDraft: WidgetSetupDraft;
  widgetThemeColor: string;
  widgetScriptSnippet: string;
  widgetSnippetCopied: "idle" | "copied" | "error";
  widgetPreviewSizeClass: string;
  companyLabel: string;
  widgetPreviewScrollRef: RefObject<HTMLDivElement>;
  qrStatus: string;
  qrPhoneNumber: string | null;
  qrHasQr: boolean;
  formatPhone: (value: string | null | undefined) => string;
  formatMetaStatusLabel: (value: string | null | undefined, fallback?: string) => string;
  apiBusinessVerificationStatus: string | null | undefined;
  apiBusinessVerificationPending: boolean;
  apiConnectionStatus: string | null | undefined;
  apiLinkedNumber: string | null | undefined;
  apiDisplayPhoneNumber: string | null | undefined;
  apiWabaId: string | null | undefined;
  apiQualityRating: string | null | undefined;
  apiMessagingLimitTier: string | null | undefined;
  apiCodeVerificationStatus: string | null | undefined;
  apiNameStatus: string | null | undefined;
  apiWabaReviewStatus: string | null | undefined;
  apiLastMetaSyncLabel: string | null;
  hasMetaConnection: boolean;
  apiSetupLoading: boolean;
  apiSetupLoadingText: string | null;
  whatsAppBusinessDraft: WhatsAppBusinessProfileDraft;
  deleteAccountConfirmText: string;
  deletingAccount: boolean;
  onPauseAgent: () => void;
  onToggleQrChannel: () => void;
  onToggleApiChannel: () => void;
  onSelectSetupWeb: () => void;
  onSelectSetupApi: () => void;
  onNavigateToQrSetup: () => void;
  onUpdateWidgetSetupDraft: (updater: (current: WidgetSetupDraft) => WidgetSetupDraft) => void;
  onWidgetQuestionChange: (index: 0 | 1 | 2, value: string) => void;
  onCopyWidgetSnippet: () => void;
  onSaveWidgetSetup: () => void;
  onOpenTestChatOverlay: () => void;
  onReconnectWhatsApp: () => void;
  onSaveWhatsAppBusinessProfile: () => void;
  onUpdateWhatsAppBusinessDraft: (
    updater: (current: WhatsAppBusinessProfileDraft) => WhatsAppBusinessProfileDraft
  ) => void;
  onResetWhatsAppBusinessDraft: () => void;
  onOpenBusinessApiSetup: () => void;
  onRefreshMetaApiStatus: () => void;
  onDeleteAccountConfirmTextChange: (value: string) => void;
  onDeleteAccount: () => void;
  onSelectSetupTemplates: () => void;
  renderNavIcon: (name: "knowledge" | "chats" | "settings" | "templates") => ReactNode;
}

export function SettingsTab(props: SettingsTabProps) {
  const {
    websiteChannelEnabled,
    qrChannelConnected,
    apiChannelConnected,
    busy,
    settingsSubmenu,
    widgetSetupDraft,
    widgetThemeColor,
    widgetScriptSnippet,
    widgetSnippetCopied,
    widgetPreviewSizeClass,
    companyLabel,
    widgetPreviewScrollRef,
    qrStatus,
    qrPhoneNumber,
    qrHasQr,
    formatPhone,
    formatMetaStatusLabel,
    apiBusinessVerificationStatus,
    apiBusinessVerificationPending,
    apiConnectionStatus,
    apiLinkedNumber,
    apiDisplayPhoneNumber,
    apiWabaId,
    apiQualityRating,
    apiMessagingLimitTier,
    apiCodeVerificationStatus,
    apiNameStatus,
    apiWabaReviewStatus,
    apiLastMetaSyncLabel,
    hasMetaConnection,
    apiSetupLoading,
    apiSetupLoadingText,
    whatsAppBusinessDraft,
    deleteAccountConfirmText,
    deletingAccount,
    onPauseAgent,
    onToggleQrChannel,
    onToggleApiChannel,
    onSelectSetupWeb,
    onSelectSetupApi,
    onNavigateToQrSetup,
    onUpdateWidgetSetupDraft,
    onWidgetQuestionChange,
    onCopyWidgetSnippet,
    onSaveWidgetSetup,
    onOpenTestChatOverlay,
    onReconnectWhatsApp,
    onSaveWhatsAppBusinessProfile,
    onUpdateWhatsAppBusinessDraft,
    onResetWhatsAppBusinessDraft,
    onOpenBusinessApiSetup,
    onRefreshMetaApiStatus,
    onDeleteAccountConfirmTextChange,
    onDeleteAccount,
    onSelectSetupTemplates,
    renderNavIcon
  } = props;

  return (
    <section className="clone-settings-view go-live-settings">
      <div className="clone-settings-top go-live-top">
        <h2>Go live</h2>
      </div>

      <div className="go-live-grid">
        <article className="go-live-card">
          <div className="go-live-card-body">
            <div className="go-live-card-head">
              <span className="go-live-icon">{renderNavIcon("knowledge")}</span>
              <button
                type="button"
                className={websiteChannelEnabled ? "go-live-switch on" : "go-live-switch"}
                disabled={busy}
                onClick={onPauseAgent}
                aria-label={websiteChannelEnabled ? "Deactivate website channel" : "Activate website channel"}
                title={websiteChannelEnabled ? "Deactivate website channel" : "Activate website channel"}
              >
                <span />
              </button>
            </div>
            <h3>Connect to Website</h3>
            <p>Customize your chatbot appearance, get integration code and go live.</p>
          </div>
          <footer className="go-live-card-footer">
            <button type="button" className="ghost-btn" onClick={onSelectSetupWeb}>
              Setup
            </button>
          </footer>
        </article>

        <article className="go-live-card">
          <div className="go-live-card-body">
            <div className="go-live-card-head">
              <span className="go-live-icon">{renderNavIcon("chats")}</span>
              <button
                type="button"
                className={qrChannelConnected ? "go-live-switch on" : "go-live-switch"}
                disabled={busy}
                onClick={onToggleQrChannel}
                aria-label={qrChannelConnected ? "Deactivate QR channel" : "Activate QR channel"}
                title={qrChannelConnected ? "Deactivate QR channel" : "Activate QR channel"}
              >
                <span />
              </button>
            </div>
            <h3>Connect to WhatsApp</h3>
            <p>Configure your chatbot settings, get login QR code and go live.</p>
          </div>
          <footer className="go-live-card-footer">
            <button type="button" className="ghost-btn" onClick={onNavigateToQrSetup}>
              Setup
            </button>
          </footer>
        </article>

        <article className="go-live-card">
          <div className="go-live-card-body">
            <div className="go-live-card-head">
              <span className="go-live-icon">{renderNavIcon("settings")}</span>
              <button
                type="button"
                className={apiChannelConnected ? "go-live-switch on" : "go-live-switch"}
                disabled={busy}
                onClick={onToggleApiChannel}
                aria-label={apiChannelConnected ? "Deactivate API channel" : "Activate API channel"}
                title={apiChannelConnected ? "Deactivate API channel" : "Activate API channel"}
              >
                <span />
              </button>
            </div>
            <h3>Connect to WACA</h3>
            <p>Configure your chatbot settings, login facebook and go live.</p>
          </div>
          <footer className="go-live-card-footer">
            <button type="button" className="ghost-btn" onClick={onSelectSetupApi}>
              Setup
            </button>
          </footer>
        </article>

        <article className="go-live-card">
          <div className="go-live-card-body">
            <div className="go-live-card-head">
              <span className="go-live-icon">{renderNavIcon("templates")}</span>
            </div>
            <h3>WhatsApp Templates</h3>
            <p>Create and manage pre-approved WhatsApp message templates for broadcasts.</p>
          </div>
          <footer className="go-live-card-footer">
            <button type="button" className="ghost-btn" onClick={onSelectSetupTemplates}>
              Manage
            </button>
          </footer>
        </article>
      </div>

      {settingsSubmenu === "setup_web" && (
        <article className="channel-setup-panel">
          <header>
            <h3>Customize your website chatbot</h3>
            <p>
              Website test chat and website widget use the same channel. Every new message appears in inbox in real time.
            </p>
          </header>
          <div className="web-widget-setup-layout">
            <section className="web-widget-form-section">
              <div className="web-widget-row">
                <label>
                  Chatbot logo
                  <input
                    value={widgetSetupDraft.chatbotLogoUrl}
                    onChange={(event) =>
                      onUpdateWidgetSetupDraft((current) => ({ ...current, chatbotLogoUrl: event.target.value }))
                    }
                    placeholder="Enter URL for chatbot icon"
                  />
                </label>
              </div>

              <div className="web-widget-row">
                <p className="web-widget-label">Chatbot size</p>
                <div className="web-widget-radio-row">
                  {(
                    [
                      { key: "small", label: "Small" },
                      { key: "medium", label: "Medium" },
                      { key: "large", label: "Large" }
                    ] as const
                  ).map((item) => (
                    <label key={item.key}>
                      <input
                        type="radio"
                        checked={widgetSetupDraft.chatbotSize === item.key}
                        onChange={() =>
                          onUpdateWidgetSetupDraft((current) => ({ ...current, chatbotSize: item.key }))
                        }
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="web-widget-row">
                <p className="web-widget-label">Device visibility</p>
                <div className="web-widget-radio-row">
                  {(
                    [
                      { key: "both", label: "Both" },
                      { key: "phone", label: "Phone" },
                      { key: "desktop", label: "Desktop" }
                    ] as const
                  ).map((item) => (
                    <label key={item.key}>
                      <input
                        type="radio"
                        checked={widgetSetupDraft.deviceVisibility === item.key}
                        onChange={() =>
                          onUpdateWidgetSetupDraft((current) => ({ ...current, deviceVisibility: item.key }))
                        }
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="web-widget-row">
                <p className="web-widget-label">Initial questions (up to 3)</p>
                <div className="web-widget-question-list">
                  {[0, 1, 2].map((idx) => (
                    <div key={idx} className="web-widget-question-item">
                      <input
                        value={widgetSetupDraft.initialQuestions[idx as 0 | 1 | 2]}
                        onChange={(event) => onWidgetQuestionChange(idx as 0 | 1 | 2, event.target.value)}
                        placeholder="Enter question"
                      />
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => onWidgetQuestionChange(idx as 0 | 1 | 2, "")}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="web-widget-row">
                <label className="web-widget-toggle-row">
                  <span className="web-widget-label">Initial greetings</span>
                  <button
                    type="button"
                    className={widgetSetupDraft.initialGreetingEnabled ? "go-live-switch on" : "go-live-switch"}
                    onClick={() =>
                      onUpdateWidgetSetupDraft((current) => ({
                        ...current,
                        initialGreetingEnabled: !current.initialGreetingEnabled
                      }))
                    }
                  >
                    <span />
                  </button>
                </label>
                <textarea
                  rows={2}
                  value={widgetSetupDraft.initialGreeting}
                  onChange={(event) =>
                    onUpdateWidgetSetupDraft((current) => ({ ...current, initialGreeting: event.target.value }))
                  }
                  placeholder="Enter greeting"
                />
              </div>

              <div className="web-widget-row">
                <label>
                  Disclaimer
                  <textarea
                    rows={2}
                    value={widgetSetupDraft.disclaimer}
                    onChange={(event) =>
                      onUpdateWidgetSetupDraft((current) => ({ ...current, disclaimer: event.target.value }))
                    }
                    placeholder="Enter fallback disclaimer"
                  />
                </label>
              </div>

              <div className="web-widget-row">
                <label>
                  Background colour
                  <div className="web-widget-color-row">
                    <input
                      type="color"
                      value={widgetThemeColor}
                      onChange={(event) =>
                        onUpdateWidgetSetupDraft((current) => ({ ...current, backgroundColor: event.target.value }))
                      }
                    />
                    <input
                      value={widgetSetupDraft.backgroundColor}
                      onChange={(event) =>
                        onUpdateWidgetSetupDraft((current) => ({ ...current, backgroundColor: event.target.value }))
                      }
                    />
                  </div>
                </label>
              </div>

              <div className="web-widget-row">
                <div className="web-widget-code-head">
                  <p className="web-widget-label">Integration code</p>
                  <button type="button" className="ghost-btn" onClick={onCopyWidgetSnippet}>
                    Copy
                  </button>
                </div>
                <pre className="widget-inline-code">
                  <code>{widgetScriptSnippet}</code>
                </pre>
                {widgetSnippetCopied === "copied" && <p className="tiny-note">Integration code copied.</p>}
                {widgetSnippetCopied === "error" && <p className="tiny-note">Copy failed. Copy from code block manually.</p>}
              </div>

              <div className="clone-hero-actions">
                <button type="button" className="primary-btn" onClick={onSaveWidgetSetup}>
                  Save
                </button>
              </div>
            </section>

            <aside className="web-widget-preview-section">
              <div className="web-widget-preview-top">
                <label>
                  Preview Widget
                  <select
                    value={widgetSetupDraft.previewOpen ? "open" : "closed"}
                    onChange={(event) =>
                      onUpdateWidgetSetupDraft((current) => ({
                        ...current,
                        previewOpen: event.target.value === "open"
                      }))
                    }
                  >
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <button type="button" className="ghost-btn" onClick={onOpenTestChatOverlay}>
                  Test
                </button>
              </div>

              <div className={`web-widget-preview-phone ${widgetPreviewSizeClass}`}>
                <header style={{ background: widgetThemeColor }}>
                  <strong>{companyLabel}</strong>
                </header>
                {widgetSetupDraft.previewOpen && (
                  <>
                    <div ref={widgetPreviewScrollRef} className="web-widget-preview-thread">
                      {widgetSetupDraft.initialGreetingEnabled && widgetSetupDraft.initialGreeting.trim() && (
                        <p>{widgetSetupDraft.initialGreeting.trim()}</p>
                      )}
                      {widgetSetupDraft.disclaimer.trim() && (
                        <small>{widgetSetupDraft.disclaimer.trim()}</small>
                      )}
                    </div>
                    <footer>
                      <input placeholder="Type here..." readOnly />
                      <button type="button">Send</button>
                    </footer>
                  </>
                )}
              </div>
              <button type="button" className="web-widget-preview-fab" style={{ background: widgetThemeColor }}>
                W
              </button>
            </aside>
          </div>
        </article>
      )}

      {settingsSubmenu === "setup_qr" && (
        <article className="channel-setup-panel">
          <header>
            <h3>Instant QR Mode Setup</h3>
            <p>Connect WhatsApp quickly for starter usage. Best for testing and small-scale automation.</p>
          </header>
          <div className="clone-channel-meta">
            <div>
              <h3>Status</h3>
              <p>{qrStatus}</p>
            </div>
            <div>
              <h3>Linked Number</h3>
              <p>{qrPhoneNumber ? formatPhone(qrPhoneNumber) : "Not linked"}</p>
            </div>
            <div>
              <h3>Session</h3>
              <p>{qrHasQr ? "QR generated" : "Not generated"}</p>
            </div>
          </div>
          <div className="clone-hero-actions">
            <button type="button" className="primary-btn" onClick={onNavigateToQrSetup}>
              Setup QR
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={onReconnectWhatsApp}>
              Reconnect
            </button>
          </div>
          <p className="tiny-note">
            QR mode is ideal for testing and early-stage businesses. For long-term growth, use Official API mode.
          </p>
        </article>
      )}

      {settingsSubmenu === "setup_api" && (
        <article className="channel-setup-panel">
          <header>
            <h3>Official WhatsApp API Setup</h3>
            <p>Connect Meta Embedded Signup for stable production messaging at scale, then configure business profile.</p>
          </header>
          {apiSetupLoading ? (
            <div className="dashboard-connection-loading api-setup-loading-card" role="status" aria-live="polite">
              <p className="dashboard-connection-loading-title">Syncing Meta channel...</p>
              <p className="dashboard-connection-loading-subtitle">
                {apiSetupLoadingText ?? "Fetching latest number and verification status."}
              </p>
              <div className="dashboard-connection-loading-track" aria-hidden="true">
                <span className="dashboard-connection-loading-value" />
              </div>
            </div>
          ) : null}
          <div className="api-setup-alert">
            <strong>
              Facebook Business Verification - {" "}
              {formatMetaStatusLabel(apiBusinessVerificationStatus, "Pending")}
            </strong>
            <p>
              {apiBusinessVerificationPending
                ? "Please complete Meta business verification to unlock higher messaging limits and stable deliverability."
                : "Business verification is in a healthy state. Keep profile and compliance details updated in Meta."}
            </p>
          </div>
          <div className="clone-channel-meta">
            <div>
              <h3>Status</h3>
              <p>{apiConnectionStatus ?? "disconnected"}</p>
            </div>
            <div>
              <h3>Linked Number</h3>
              <p>{apiLinkedNumber ? formatPhone(apiLinkedNumber) : (apiDisplayPhoneNumber ?? "Not linked")}</p>
            </div>
            <div>
              <h3>WABA ID</h3>
              <p>{apiWabaId ?? "Not connected"}</p>
            </div>
          </div>
          <div className="clone-channel-meta">
            <div>
              <h3>Quality Rating</h3>
              <p>{formatMetaStatusLabel(apiQualityRating)}</p>
            </div>
            <div>
              <h3>Message Limit</h3>
              <p>{formatMetaStatusLabel(apiMessagingLimitTier)}</p>
            </div>
            <div>
              <h3>Code Verification</h3>
              <p>{formatMetaStatusLabel(apiCodeVerificationStatus)}</p>
            </div>
          </div>
          <div className="clone-channel-meta">
            <div>
              <h3>Name Status</h3>
              <p>{formatMetaStatusLabel(apiNameStatus)}</p>
            </div>
            <div>
              <h3>Account Review</h3>
              <p>{formatMetaStatusLabel(apiWabaReviewStatus)}</p>
            </div>
            <div>
              <h3>Last Meta Sync</h3>
              <p>{apiLastMetaSyncLabel ?? "Not synced"}</p>
            </div>
          </div>
          <div className="api-profile-tabs">
            {["Profile", "Compliance Info", "Assignments", "Configuration", "Channel Logs"].map((tab) => (
              <button key={tab} type="button" className={tab === "Profile" ? "active" : ""}>
                {tab}
              </button>
            ))}
          </div>

          <form
            className="api-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveWhatsAppBusinessProfile();
            }}
          >
            <label>
              WhatsApp Display Picture URL
              <input
                value={whatsAppBusinessDraft.displayPictureUrl}
                onChange={(event) =>
                  onUpdateWhatsAppBusinessDraft((current) => ({ ...current, displayPictureUrl: event.target.value }))
                }
                placeholder="https://..."
              />
            </label>
            <label>
              Address
              <textarea
                rows={2}
                maxLength={256}
                value={whatsAppBusinessDraft.address}
                onChange={(event) =>
                  onUpdateWhatsAppBusinessDraft((current) => ({ ...current, address: event.target.value }))
                }
                placeholder="Enter address"
              />
            </label>
            <label>
              Business Description
              <textarea
                rows={3}
                maxLength={256}
                value={whatsAppBusinessDraft.businessDescription}
                onChange={(event) =>
                  onUpdateWhatsAppBusinessDraft((current) => ({ ...current, businessDescription: event.target.value }))
                }
                placeholder="Message not available now, leave a message"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                maxLength={128}
                value={whatsAppBusinessDraft.email}
                onChange={(event) =>
                  onUpdateWhatsAppBusinessDraft((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="Enter email"
              />
            </label>
            <label>
              Vertical
              <select
                value={whatsAppBusinessDraft.vertical}
                onChange={(event) =>
                  onUpdateWhatsAppBusinessDraft((current) => ({ ...current, vertical: event.target.value }))
                }
              >
                <option value="Restaurant">Restaurant</option>
                <option value="Retail">Retail</option>
                <option value="Education">Education</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Services">Services</option>
              </select>
            </label>
            <label>
              Website URL
              <input
                value={whatsAppBusinessDraft.websiteUrl}
                onChange={(event) =>
                  onUpdateWhatsAppBusinessDraft((current) => ({ ...current, websiteUrl: event.target.value }))
                }
                placeholder="https://your-website.com"
              />
            </label>
            <label>
              About
              <input
                maxLength={139}
                value={whatsAppBusinessDraft.about}
                onChange={(event) =>
                  onUpdateWhatsAppBusinessDraft((current) => ({ ...current, about: event.target.value }))
                }
                placeholder="Official WhatsApp Business Account"
              />
            </label>

            <div className="clone-hero-actions">
              <button type="submit" className="primary-btn">
                Apply
              </button>
              <button type="button" className="ghost-btn" onClick={onResetWhatsAppBusinessDraft}>
                Cancel
              </button>
            </div>
          </form>
          <div className="clone-hero-actions">
            <button type="button" className="primary-btn" disabled={busy} onClick={onOpenBusinessApiSetup}>
              {hasMetaConnection ? "Reconnect API" : "Connect API"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !hasMetaConnection}
              onClick={onRefreshMetaApiStatus}
            >
              Refresh status
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !hasMetaConnection}
              onClick={onToggleApiChannel}
            >
              Disconnect
            </button>
          </div>
          <p className="tiny-note">
            Official API channel is recommended for long-term growth and higher reliability.
          </p>
        </article>
      )}

      <article className="channel-setup-panel account-danger-panel">
        <header>
          <h3>Account Settings</h3>
          <p>
            Delete your account permanently. This revokes connected WhatsApp tokens, removes webhook subscriptions,
            and deletes associated business data from active systems.
          </p>
        </header>
        <div className="web-widget-row">
          <label>
            Type <strong>DELETE</strong> to confirm
            <input
              value={deleteAccountConfirmText}
              onChange={(event) => onDeleteAccountConfirmTextChange(event.target.value)}
              placeholder="DELETE"
            />
          </label>
        </div>
        <div className="clone-hero-actions">
          <button
            type="button"
            className="account-danger-btn"
            disabled={busy || deletingAccount || deleteAccountConfirmText.trim() !== "DELETE"}
            onClick={onDeleteAccount}
          >
            {deletingAccount ? "Deleting..." : "Delete Account"}
          </button>
        </div>
        <p className="tiny-note">This action is irreversible.</p>
      </article>
    </section>
  );
}
