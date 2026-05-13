import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MetaBusinessConnection, MetaBusinessProfile } from "../../../../lib/api";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import {
  saveSettingsMetaProfile,
  uploadSettingsMetaProfileLogo
} from "../api";
import { useSettingsMetaProfileQuery } from "../queries";

const META_VERTICAL_OPTIONS = [
  { value: "", label: "Not selected" },
  { value: "ALCOHOL", label: "Alcoholic Beverages" },
  { value: "APPAREL", label: "Clothing and Apparel" },
  { value: "AUTO", label: "Automotive" },
  { value: "BEAUTY", label: "Beauty, Spa and Salon" },
  { value: "EDU", label: "Education" },
  { value: "ENTERTAIN", label: "Entertainment" },
  { value: "EVENT_PLAN", label: "Event Planning and Service" },
  { value: "FINANCE", label: "Finance and Banking" },
  { value: "GOVT", label: "Public Service" },
  { value: "GROCERY", label: "Food and Grocery" },
  { value: "HEALTH", label: "Medical and Health" },
  { value: "HOTEL", label: "Hotel and Lodging" },
  { value: "NONPROFIT", label: "Non-profit" },
  { value: "ONLINE_GAMBLING", label: "Online Gambling & Gaming" },
  { value: "OTC_DRUGS", label: "Over-the-Counter Drugs" },
  { value: "OTHER", label: "Other" },
  { value: "PHYSICAL_GAMBLING", label: "Non-Online Gambling & Gaming" },
  { value: "PROF_SERVICES", label: "Professional Services" },
  { value: "RESTAURANT", label: "Restaurant" },
  { value: "RETAIL", label: "Shopping and Retail" },
  { value: "TRAVEL", label: "Travel and Transportation" }
] as const;

type ProfileDraft = {
  about: string;
  address: string;
  businessDescription: string;
  email: string;
  vertical: string;
  websites: [string, string];
};

type ValidationErrors = Partial<Record<keyof ProfileDraft | "website0" | "website1" | "image", string>>;

const EMPTY_DRAFT: ProfileDraft = {
  about: "",
  address: "",
  businessDescription: "",
  email: "",
  vertical: "",
  websites: ["", ""]
};

function getNestedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readMetaString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function formatPhone(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) {
    return value;
  }
  return `+${digits}`;
}

function formatMetaStatusLabel(value: string | null | undefined, fallback = "Not available"): string {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }
  if (/^TIER_/i.test(raw)) {
    return raw.toUpperCase();
  }
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getVerticalLabel(value: string | null | undefined): string {
  return META_VERTICAL_OPTIONS.find((option) => option.value === value)?.label ?? "Not selected";
}

function profileToDraft(profile: MetaBusinessProfile | null | undefined): ProfileDraft {
  if (!profile) {
    return EMPTY_DRAFT;
  }
  return {
    about: profile.about ?? "",
    address: profile.address ?? "",
    businessDescription: profile.businessDescription ?? "",
    email: profile.email ?? "",
    vertical: profile.vertical ?? "",
    websites: [profile.websites[0] ?? "", profile.websites[1] ?? ""]
  };
}

function validateUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validateDraft(draft: ProfileDraft, imageFile: File | null): ValidationErrors {
  const errors: ValidationErrors = {};
  const about = draft.about.trim();
  if (draft.about.length > 0 && about.length === 0) {
    errors.about = "About cannot be only spaces.";
  } else if (about.length > 139) {
    errors.about = "About must be 139 characters or fewer.";
  }

  if (draft.address.trim().length > 256) {
    errors.address = "Address must be 256 characters or fewer.";
  }
  if (draft.businessDescription.trim().length > 512) {
    errors.businessDescription = "Description must be 512 characters or fewer.";
  }

  const email = draft.email.trim();
  if (email.length > 128) {
    errors.email = "Email must be 128 characters or fewer.";
  } else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  draft.websites.forEach((website, index) => {
    const trimmed = website.trim();
    if (!trimmed) {
      return;
    }
    const key = index === 0 ? "website0" : "website1";
    if (trimmed.length > 256) {
      errors[key] = "Website must be 256 characters or fewer.";
    } else if (!validateUrl(trimmed)) {
      errors[key] = "Website must start with http:// or https:// and be valid.";
    }
  });

  if (imageFile && !["image/png", "image/jpeg", "image/jpg"].includes(imageFile.type.toLowerCase())) {
    errors.image = "Profile picture must be a PNG or JPG image.";
  } else if (imageFile && imageFile.size > 5 * 1024 * 1024) {
    errors.image = "Profile picture must be 5MB or smaller.";
  }

  return errors;
}

function buildProfilePayload(draft: ProfileDraft, profile: MetaBusinessProfile | null | undefined) {
  const payload: {
    connectionId: string;
    about?: string | null;
    address?: string | null;
    businessDescription?: string | null;
    email?: string | null;
    vertical?: string | null;
    websites?: string[] | null;
    profilePictureHandle?: string | null;
  } = {
    connectionId: profile?.connectionId ?? ""
  };

  const about = draft.about.trim();
  if (about) {
    payload.about = about;
  }

  const address = draft.address.trim();
  if (address) {
    payload.address = address;
  }

  const businessDescription = draft.businessDescription.trim();
  if (businessDescription) {
    payload.businessDescription = businessDescription;
  }

  const email = draft.email.trim();
  if (email) {
    payload.email = email;
  }

  if (draft.vertical || profile?.vertical) {
    payload.vertical = draft.vertical;
  }

  const websites = draft.websites.map((website) => website.trim()).filter((website) => website.length > 0);
  if (websites.length > 0) {
    payload.websites = websites;
  }

  return payload;
}

interface MetaBusinessProfileModalProps {
  token: string;
  connection: MetaBusinessConnection | null;
  onClose: () => void;
}

export function MetaBusinessProfileModal({ token, connection, onClose }: MetaBusinessProfileModalProps) {
  const queryClient = useQueryClient();
  const connectionId = connection?.id ?? null;
  const isOpen = Boolean(connectionId);
  const profileQuery = useSettingsMetaProfileQuery(token, connectionId, isOpen);
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setImageFile(null);
    setImagePreviewUrl(null);
    setSaveError(null);
    setSaveInfo(null);
  }, [connectionId, isOpen]);

  useEffect(() => {
    if (!isOpen || !profileQuery.data) {
      return;
    }
    setDraft(profileToDraft(profileQuery.data));
    setImageFile(null);
    setImagePreviewUrl(null);
  }, [isOpen, profileQuery.data]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, saving]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const metaHealthRecord = getNestedRecord(connection?.metadata?.metaHealth);
  const displayName = readMetaString(metaHealthRecord, "verifiedName") ?? "Not available";
  const phoneNumber = formatPhone(connection?.linkedNumber ?? connection?.displayPhoneNumber);
  const nameApproval = formatMetaStatusLabel(readMetaString(metaHealthRecord, "nameStatus"), "Pending");
  const qualityStatus = formatMetaStatusLabel(readMetaString(metaHealthRecord, "phoneQualityRating") ?? connection?.status, "Unknown");
  const messagingLimit = formatMetaStatusLabel(readMetaString(metaHealthRecord, "messagingLimitTier"), "Unknown");
  const officialBusinessRaw =
    readMetaString(metaHealthRecord, "officialBusinessAccount") ??
    readMetaString(metaHealthRecord, "official_business_account") ??
    readMetaString(getNestedRecord(connection?.metadata), "officialBusinessAccount") ??
    readMetaString(getNestedRecord(connection?.metadata), "official_business_account");
  const officialBusinessStatus = officialBusinessRaw
    ? formatMetaStatusLabel(officialBusinessRaw)
    : "Not confirmed";
  const profile = profileQuery.data ?? null;
  const profilePhotoUrl = imagePreviewUrl ?? profile?.displayPictureUrl ?? null;
  const validationErrors = useMemo(() => validateDraft(draft, imageFile), [draft, imageFile]);
  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  if (!connection) {
    return null;
  }

  const setWebsite = (index: 0 | 1, value: string) => {
    setDraft((current) => {
      const websites = [...current.websites] as [string, string];
      websites[index] = value;
      return { ...current, websites };
    });
  };

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (imagePreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImageFile(file);
    setImagePreviewUrl(file ? URL.createObjectURL(file) : null);
    setSaveInfo(null);
    setSaveError(null);
  };

  const resetToLastFetched = () => {
    setDraft(profileToDraft(profile));
    setImageFile(null);
    setImagePreviewUrl(null);
    setSaveError(null);
    setSaveInfo(null);
  };

  const refreshProfile = async () => {
    setSaveError(null);
    setSaveInfo(null);
    const result = await profileQuery.refetch();
    if (result.data) {
      setDraft(profileToDraft(result.data));
      setImageFile(null);
      setImagePreviewUrl(null);
      setSaveInfo("Profile refreshed from Meta.");
    }
  };

  const saveProfile = async () => {
    const errors = validateDraft(draft, imageFile);
    setSaveError(null);
    setSaveInfo(null);
    if (Object.keys(errors).length > 0 || !connectionId) {
      return;
    }

    setSaving(true);
    try {
      const payload = buildProfilePayload(draft, profile);
      payload.connectionId = connectionId;

      if (imageFile) {
        const upload = await uploadSettingsMetaProfileLogo(token, imageFile, connectionId);
        payload.profilePictureHandle = upload.handle;
      }

      const response = await saveSettingsMetaProfile(token, payload);
      queryClient.setQueryData(dashboardQueryKeys.settingsMetaProfile(connectionId), response.profile);
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaProfile(connectionId) });
      setDraft(profileToDraft(response.profile));
      setImageFile(null);
      setImagePreviewUrl(null);
      setSaveInfo("WhatsApp business profile saved.");
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="meta-profile-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section className="meta-profile-modal" role="dialog" aria-modal="true" aria-labelledby="meta-profile-modal-title">
        <header className="meta-profile-modal-header">
          <div>
            <h3 id="meta-profile-modal-title">Phone profile</h3>
            <p>{phoneNumber}</p>
          </div>
          <button type="button" className="meta-profile-icon-btn" onClick={onClose} disabled={saving} aria-label="Close profile editor">
            x
          </button>
        </header>

        {profileQuery.isLoading ? (
          <div className="meta-profile-loading" role="status">
            Loading profile from Meta...
          </div>
        ) : profileQuery.isError ? (
          <div className="api-setup-alert">
            <strong>Profile could not be loaded</strong>
            <p>{(profileQuery.error as Error).message}</p>
            <button type="button" className="ghost-btn" onClick={() => void refreshProfile()}>
              Retry
            </button>
          </div>
        ) : (
          <div className="meta-profile-modal-grid">
            <div className="meta-profile-modal-main">
              {(saveInfo || saveError) && (
                <div className={saveError ? "meta-profile-message error" : "meta-profile-message"}>
                  {saveError ?? saveInfo}
                </div>
              )}

              <section className="meta-profile-readonly">
                <h4>Meta status</h4>
                <div className="meta-profile-readonly-grid">
                  <div><span>Display name</span><strong>{displayName}</strong></div>
                  <div><span>Phone number</span><strong>{phoneNumber}</strong></div>
                  <div><span>Name approval</span><strong>{nameApproval}</strong></div>
                  <div><span>Quality/status</span><strong>{qualityStatus}</strong></div>
                  <div><span>Messaging limit</span><strong>{messagingLimit}</strong></div>
                  <div><span>Official business</span><strong>{officialBusinessStatus}</strong></div>
                </div>
              </section>

              <section className="meta-profile-form-section">
                <h4>Editable profile fields</h4>
                <div className="meta-profile-picture-row">
                  <div className="meta-profile-picture-preview">
                    {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" /> : <span>{displayName.charAt(0) || "W"}</span>}
                  </div>
                  <label>
                    Profile picture
                    <input
                      aria-label="Profile picture"
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={handleImageChange}
                    />
                    {validationErrors.image ? (
                      <small className="meta-profile-field-error">{validationErrors.image}</small>
                    ) : (
                      <small>PNG or JPG. Maximum 5MB.</small>
                    )}
                  </label>
                </div>

                <label>
                  About
                  <input
                    aria-label="About"
                    value={draft.about}
                    maxLength={139}
                    onChange={(event) => setDraft((current) => ({ ...current, about: event.target.value }))}
                    placeholder="Usually replies within minutes"
                  />
                  <span className="meta-profile-counter">{draft.about.trim().length}/139</span>
                  {validationErrors.about ? <small className="meta-profile-field-error">{validationErrors.about}</small> : null}
                </label>

                <label>
                  Description
                  <textarea
                    aria-label="Description"
                    rows={4}
                    maxLength={512}
                    value={draft.businessDescription}
                    onChange={(event) => setDraft((current) => ({ ...current, businessDescription: event.target.value }))}
                    placeholder="Describe your business"
                  />
                  <span className="meta-profile-counter">{draft.businessDescription.trim().length}/512</span>
                  {validationErrors.businessDescription ? (
                    <small className="meta-profile-field-error">{validationErrors.businessDescription}</small>
                  ) : null}
                </label>

                <label>
                  Address
                  <textarea
                    aria-label="Address"
                    rows={2}
                    maxLength={256}
                    value={draft.address}
                    onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))}
                    placeholder="Business address"
                  />
                  <span className="meta-profile-counter">{draft.address.trim().length}/256</span>
                  {validationErrors.address ? <small className="meta-profile-field-error">{validationErrors.address}</small> : null}
                </label>

                <div className="meta-profile-two-col">
                  <label>
                    Email
                    <input
                      aria-label="Email"
                      type="email"
                      maxLength={128}
                      value={draft.email}
                      onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                      placeholder="support@example.com"
                    />
                    <span className="meta-profile-counter">{draft.email.trim().length}/128</span>
                    {validationErrors.email ? <small className="meta-profile-field-error">{validationErrors.email}</small> : null}
                  </label>

                  <label>
                    Category
                    <select
                      aria-label="Category"
                      value={draft.vertical}
                      onChange={(event) => setDraft((current) => ({ ...current, vertical: event.target.value }))}
                    >
                      {META_VERTICAL_OPTIONS.map((option) => (
                        <option key={option.value || "empty"} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="meta-profile-two-col">
                  <label>
                    Website 1
                    <input
                      aria-label="Website 1"
                      value={draft.websites[0]}
                      maxLength={256}
                      onChange={(event) => setWebsite(0, event.target.value)}
                      placeholder="https://example.com"
                    />
                    <span className="meta-profile-counter">{draft.websites[0].trim().length}/256</span>
                    {validationErrors.website0 ? <small className="meta-profile-field-error">{validationErrors.website0}</small> : null}
                  </label>

                  <label>
                    Website 2
                    <input
                      aria-label="Website 2"
                      value={draft.websites[1]}
                      maxLength={256}
                      onChange={(event) => setWebsite(1, event.target.value)}
                      placeholder="https://instagram.com/brand"
                    />
                    <span className="meta-profile-counter">{draft.websites[1].trim().length}/256</span>
                    {validationErrors.website1 ? <small className="meta-profile-field-error">{validationErrors.website1}</small> : null}
                  </label>
                </div>
              </section>
            </div>

            <aside className="meta-profile-phone-preview" aria-label="Phone profile preview">
              <div className="meta-profile-phone-shell">
                <div className="meta-profile-phone-top">
                  <span aria-hidden="true">&lt;</span>
                  <span aria-hidden="true">...</span>
                </div>
                <div className="meta-profile-phone-avatar">
                  {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" /> : <span>{displayName.charAt(0) || "W"}</span>}
                </div>
                <strong>{displayName}</strong>
                <p>{phoneNumber}</p>
                {draft.about.trim() ? <small>{draft.about.trim()}</small> : null}
                <div className="meta-profile-phone-category">{getVerticalLabel(draft.vertical)}</div>
              </div>
            </aside>
          </div>
        )}

        <footer className="meta-profile-modal-actions">
          <button type="button" className="ghost-btn" onClick={() => void refreshProfile()} disabled={saving || profileQuery.isLoading}>
            Refresh from Meta
          </button>
          <button type="button" className="ghost-btn" onClick={resetToLastFetched} disabled={saving || profileQuery.isLoading}>
            Reset
          </button>
          <button type="button" className="primary-btn" onClick={() => void saveProfile()} disabled={saving || profileQuery.isLoading || hasValidationErrors}>
            {saving ? "Saving..." : "Save profile"}
          </button>
        </footer>
      </section>
    </div>
  );
}
