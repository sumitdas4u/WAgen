import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../../lib/auth-context";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { isMetaConnectionActive } from "../../../../shared/dashboard/meta-connection-selector";
import { createOutboundConversation, listInboxContacts, type InboxContact } from "../api";

interface Props {
  onClose: () => void;
  onCreated: (convId: string) => void;
}

type ChannelChoice = "api" | "qr";

function getContactName(contact: InboxContact): string {
  return contact.display_name?.trim() || contact.phone_number;
}

function getInitials(contact: InboxContact): string {
  const name = getContactName(contact);
  const initials = name.split(" ").map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
  return initials || "C";
}

function formatContactMeta(contact: InboxContact): string {
  return [contact.phone_number, contact.email].filter(Boolean).join(" · ");
}

export function NewConvModal({ onClose, onCreated }: Props) {
  const { token } = useAuth();
  const { bootstrap } = useDashboardShell();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [channelType, setChannelType] = useState<ChannelChoice | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const apiConnections = bootstrap?.channelSummary.metaApi.connections ?? [];
  const activeApiConnections = useMemo(() => apiConnections.filter(isMetaConnectionActive), [apiConnections]);
  const selectedApiConnection = activeApiConnections[0] ?? null;
  const qrActive = bootstrap?.channelSummary.whatsapp.status === "connected";
  const apiActive = activeApiConnections.length > 0;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (channelType && ((channelType === "api" && apiActive) || (channelType === "qr" && qrActive))) return;
    setChannelType(apiActive ? "api" : qrActive ? "qr" : null);
  }, [apiActive, channelType, qrActive]);

  const contactsQuery = useQuery({
    queryKey: ["iv2-new-conv-contacts", debouncedSearch],
    queryFn: () => listInboxContacts(token!, { q: debouncedSearch, limit: 80 }),
    enabled: Boolean(token),
    staleTime: 30_000
  });

  const contacts = contactsQuery.data?.contacts ?? [];
  const selectedContact = contacts.find((contact) => contact.id === selectedContactId) ?? null;
  const canCreate = Boolean(selectedContact && channelType && (channelType !== "api" || selectedApiConnection));

  const handleCreate = async () => {
    if (!selectedContact) {
      setError("Select a contact to start a conversation.");
      return;
    }
    if (!channelType) {
      setError("Connect WhatsApp API or QR before starting a conversation.");
      return;
    }
    if (channelType === "api" && !selectedApiConnection) {
      setError("No active WhatsApp API number is available.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await createOutboundConversation(token!, {
        contactId: selectedContact.id,
        channelType,
        connectionId: channelType === "api" ? selectedApiConnection?.id ?? null : null
      });
      onCreated(result.conversationId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="iv-modal-overlay" onClick={onClose}>
      <div className="iv-modal iv-modal-lg iv-newconv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="iv-tvd-head">
          <strong>New Conversation</strong>
          <button className="iv-tvd-close" onClick={onClose}>✕</button>
        </div>

        <div className="iv-newconv-body">
          <section className="iv-newconv-section">
            <div className="iv-newconv-section-head">
              <span>Select Contact</span>
              {selectedContact && <strong>{getContactName(selectedContact)}</strong>}
            </div>
            <input
              className="iv-tvd-input iv-newconv-search"
              placeholder="Search contacts by name, phone, or email..."
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="iv-newconv-contact-list">
              {contactsQuery.isLoading ? (
                <div className="iv-newconv-empty">Loading contacts...</div>
              ) : contacts.length === 0 ? (
                <div className="iv-newconv-empty">No contacts found.</div>
              ) : contacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  className={`iv-newconv-contact${selectedContactId === contact.id ? " selected" : ""}`}
                  onClick={() => setSelectedContactId(contact.id)}
                >
                  <span className="iv-newconv-avatar">{getInitials(contact)}</span>
                  <span className="iv-newconv-contact-main">
                    <strong>{getContactName(contact)}</strong>
                    <small>{formatContactMeta(contact)}</small>
                  </span>
                  <span className="iv-newconv-source">{contact.source_type}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="iv-newconv-section">
            <div className="iv-newconv-section-head">
              <span>Channel</span>
              <strong>{channelType ? (channelType === "api" ? "WhatsApp API" : "WhatsApp QR") : "No active channel"}</strong>
            </div>
            <div className="iv-newconv-channel-grid">
              <button
                type="button"
                className={`iv-newconv-channel${channelType === "api" ? " selected" : ""}`}
                disabled={!apiActive}
                onClick={() => setChannelType("api")}
              >
                <strong>WhatsApp API</strong>
                <span>{apiActive ? selectedApiConnection?.displayPhoneNumber ?? selectedApiConnection?.linkedNumber ?? "Active API number" : "Not active"}</span>
              </button>
              <button
                type="button"
                className={`iv-newconv-channel${channelType === "qr" ? " selected" : ""}`}
                disabled={!qrActive}
                onClick={() => setChannelType("qr")}
              >
                <strong>WhatsApp QR</strong>
                <span>{qrActive ? bootstrap?.channelSummary.whatsapp.phoneNumber ?? "Active QR session" : "Not active"}</span>
              </button>
            </div>
          </section>

          {error && <div className="iv-newconv-error">{error}</div>}
        </div>

        <div className="iv-tvd-footer">
          <button className="iv-tvd-cancel" onClick={onClose}>Cancel</button>
          <button className="iv-tvd-send" disabled={loading || !canCreate} onClick={() => void handleCreate()}>
            {loading ? "Opening..." : "Open Conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}
