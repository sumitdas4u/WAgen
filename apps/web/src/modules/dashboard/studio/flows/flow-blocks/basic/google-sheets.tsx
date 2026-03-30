import { useCallback, useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  disconnectGoogleSheets,
  fetchGoogleSheetColumns,
  fetchGoogleSheetsConfig,
  fetchGoogleSheetsStatus,
  fetchGoogleSpreadsheets,
  fetchGoogleSpreadsheetSheets,
  startGoogleSheetsConnect,
  type GoogleSheetSummary,
  type GoogleSheetsConfig,
  type GoogleSheetsStatus,
  type GoogleSpreadsheetSummary
} from "../../../../../../lib/api";
import { NodeHeader, uid, useFlowEditorToken, useNodePatch } from "../editor-shared";
import type {
  FlowKeyValueItem,
  GoogleSheetsAddRowData,
  GoogleSheetsData,
  GoogleSheetsFetchRowData,
  GoogleSheetsFetchRowsData,
  GoogleSheetsOperation,
  GoogleSheetsUpdateRowData,
  StudioFlowBlockDefinition
} from "../types";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(): FlowKeyValueItem {
  return { id: uid(), key: "", value: "" };
}

const OPERATIONS: { value: GoogleSheetsOperation; label: string; desc: string }[] = [
  { value: "addRow",    label: "Add New Row",        desc: "Append a new row to the sheet" },
  { value: "updateRow", label: "Update Row",          desc: "Find and update an existing row" },
  { value: "fetchRow",  label: "Fetch Row",           desc: "Find the first matching row" },
  { value: "fetchRows", label: "Fetch First 10 Rows", desc: "Fetch up to 10 matching rows" }
];

// ─── Shared hook ───────────────────────────────────────────────────────────────

interface GSConnection {
  config: GoogleSheetsConfig | null;
  status: GoogleSheetsStatus | null;
  spreadsheets: GoogleSpreadsheetSummary[];
  sheets: GoogleSheetSummary[];
  columns: string[];
  loading: boolean;
  catalogLoading: boolean;
  oauthLoading: boolean;
  disconnecting: boolean;
  statusMsg: string | null;
  reload: () => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function useGoogleSheetsConnection(
  spreadsheetId: string,
  sheetTitle: string,
  onDisconnect: () => void
): GSConnection {
  const token = useFlowEditorToken();
  const [config, setConfig]                 = useState<GoogleSheetsConfig | null>(null);
  const [status, setStatus]                 = useState<GoogleSheetsStatus | null>(null);
  const [spreadsheets, setSpreadsheets]     = useState<GoogleSpreadsheetSummary[]>([]);
  const [sheets, setSheets]                 = useState<GoogleSheetSummary[]>([]);
  const [columns, setColumns]               = useState<string[]>([]);
  const [loading, setLoading]               = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [oauthLoading, setOauthLoading]     = useState(false);
  const [disconnecting, setDisconnecting]   = useState(false);
  const [statusMsg, setStatusMsg]           = useState<string | null>(null);
  const [nonce, setNonce]                   = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // config + status
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void Promise.all([fetchGoogleSheetsConfig(token), fetchGoogleSheetsStatus(token)])
      .then(([cfg, st]) => { if (!cancelled) { setConfig(cfg); setStatus(st); setStatusMsg(null); } })
      .catch((e) => { if (!cancelled) setStatusMsg((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [nonce, token]);

  // spreadsheets
  useEffect(() => {
    if (!token || !config?.configured || !status?.connected) { setSpreadsheets([]); return; }
    let cancelled = false;
    setCatalogLoading(true);
    void fetchGoogleSpreadsheets(token, { connectionId: status.connection?.id ?? null })
      .then((r) => { if (!cancelled) setSpreadsheets(r.spreadsheets); })
      .catch((e) => { if (!cancelled) setStatusMsg((e as Error).message); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [config?.configured, status?.connected, status?.connection?.id, token, nonce]);

  // sheets
  useEffect(() => {
    if (!token || !status?.connected || !spreadsheetId) { setSheets([]); setColumns([]); return; }
    let cancelled = false;
    setCatalogLoading(true);
    void fetchGoogleSpreadsheetSheets(token, spreadsheetId, { connectionId: status.connection?.id ?? null })
      .then((r) => { if (!cancelled) setSheets(r.sheets); })
      .catch((e) => { if (!cancelled) setStatusMsg((e as Error).message); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [spreadsheetId, status?.connected, status?.connection?.id, token, nonce]);

  // columns
  useEffect(() => {
    if (!token || !status?.connected || !spreadsheetId || !sheetTitle) { setColumns([]); return; }
    let cancelled = false;
    setCatalogLoading(true);
    void fetchGoogleSheetColumns(token, spreadsheetId, sheetTitle, { connectionId: status.connection?.id ?? null })
      .then((r) => { if (!cancelled) setColumns(r.columns); })
      .catch((e) => { if (!cancelled) setStatusMsg((e as Error).message); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [sheetTitle, spreadsheetId, status?.connected, status?.connection?.id, token, nonce]);

  // OAuth popup result
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const p = e.data as { type?: string; message?: string };
      if (p?.type !== "wagen-google-sheets-oauth") return;
      setOauthLoading(false);
      setStatusMsg(p.message ?? null);
      reload();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [reload]);

  const connect = useCallback(async () => {
    if (!token) return;
    setOauthLoading(true); setStatusMsg(null);
    try {
      const r = await startGoogleSheetsConnect(token);
      const popup = window.open(r.url, "wagenGoogleSheetsOauth", "popup=yes,width=560,height=760");
      if (!popup) { setOauthLoading(false); setStatusMsg("Popup blocked — allow popups and try again."); }
    } catch (e) { setOauthLoading(false); setStatusMsg((e as Error).message); }
  }, [token]);

  const disconnect = useCallback(async () => {
    if (!token || !status?.connection?.id) return;
    setDisconnecting(true); setStatusMsg(null);
    try {
      await disconnectGoogleSheets(token, { connectionId: status.connection.id });
      onDisconnect();
      reload();
    } catch (e) { setStatusMsg((e as Error).message); }
    finally { setDisconnecting(false); }
  }, [token, status?.connection?.id, onDisconnect, reload]);

  return {
    config, status, spreadsheets, sheets, columns,
    loading, catalogLoading, oauthLoading, disconnecting,
    statusMsg, reload, connect, disconnect
  };
}

// ─── Shared sub-components ─────────────────────────────────────────────────────

function ConnectionBanner({ gs }: { gs: GSConnection }) {
  const { loading, config, status, oauthLoading, disconnecting, catalogLoading, statusMsg, connect, disconnect, reload } = gs;

  return (
    <div className="fn-google-connection">
      {loading ? (
        <div className="fn-google-banner">Loading Google Sheets connection...</div>
      ) : !config?.configured ? (
        <div className="fn-google-banner fn-google-banner-error">Google Sheets is not configured on the server yet.</div>
      ) : status?.connected && status.connection ? (
        <div className="fn-google-banner">
          <div>Connected as <strong>{status.connection.googleEmail}</strong></div>
          <div className="fn-google-actions">
            <button type="button" className="fn-btn nodrag" onClick={reload} disabled={catalogLoading}>Refresh</button>
            <button type="button" className="fn-btn nodrag" onClick={connect} disabled={oauthLoading}>{oauthLoading ? "Opening..." : "Reconnect"}</button>
            <button type="button" className="fn-btn fn-btn-danger nodrag" onClick={disconnect} disabled={disconnecting}>{disconnecting ? "..." : "Disconnect"}</button>
          </div>
        </div>
      ) : (
        <div className="fn-google-banner fn-google-banner-warning">
          <div>Connect your Google account to use this block.</div>
          <button type="button" className="fn-btn fn-btn-primary nodrag" onClick={connect} disabled={oauthLoading}>
            {oauthLoading ? "Opening..." : "Connect with Google"}
          </button>
        </div>
      )}
      {statusMsg ? <div className="fn-google-note">{statusMsg}</div> : null}
    </div>
  );
}

function SpreadsheetPicker(props: {
  gs: GSConnection;
  spreadsheetId: string;
  sheetTitle: string;
  onSpreadsheet: (id: string, name: string) => void;
  onSheet: (title: string) => void;
}) {
  const { gs, spreadsheetId, sheetTitle, onSpreadsheet, onSheet } = props;
  const { status, spreadsheets, sheets, catalogLoading } = gs;
  const selected = spreadsheets.find((s) => s.id === spreadsheetId);

  return (
    <>
      <div className="fn-node-field">
        <label className="fn-node-label">SPREADSHEET</label>
        <select className="fn-node-select nodrag" value={spreadsheetId}
          onChange={(e) => onSpreadsheet(e.target.value, spreadsheets.find((s) => s.id === e.target.value)?.name ?? "")}
          disabled={!status?.connected || catalogLoading}>
          <option value="">{catalogLoading ? "Loading..." : "Select a spreadsheet"}</option>
          {selected && !spreadsheets.some((s) => s.id === selected.id)
            ? <option value={selected.id}>{selected.name}</option> : null}
          {spreadsheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="fn-node-field">
        <label className="fn-node-label">SHEET</label>
        <select className="fn-node-select nodrag" value={sheetTitle}
          onChange={(e) => onSheet(e.target.value)}
          disabled={!status?.connected || !spreadsheetId || catalogLoading}>
          <option value="">{catalogLoading ? "Loading..." : "Select a sheet"}</option>
          {sheetTitle && !sheets.some((s) => s.title === sheetTitle)
            ? <option value={sheetTitle}>{sheetTitle}</option> : null}
          {sheets.map((s) => <option key={s.sheetId} value={s.title}>{s.title}</option>)}
        </select>
      </div>
    </>
  );
}

function ColumnField(props: {
  value: string;
  columns: string[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const { value, columns, placeholder, onChange } = props;
  if (columns.length === 0) {
    return <input className="fn-btn-row-input nodrag" value={value}
      onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
  }
  const hasCustom = value.trim() && !columns.includes(value.trim());
  return (
    <select className="fn-node-select nodrag" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {hasCustom ? <option value={value}>{value}</option> : null}
      {columns.map((col) => <option key={col} value={col}>{col}</option>)}
    </select>
  );
}

function RowValuesList(props: {
  items: FlowKeyValueItem[];
  columns: string[];
  onChange: (items: FlowKeyValueItem[]) => void;
}) {
  const { items, columns, onChange } = props;
  return (
    <div className="fn-btn-rows">
      {items.length > 0 && (
        <div className="fn-api-row" style={{ opacity: 0.45, pointerEvents: "none" }}>
          <span style={{ fontSize: "0.63rem", fontWeight: 700 }}>Column</span>
          <span style={{ fontSize: "0.63rem", fontWeight: 700 }}>Value</span>
          <span />
        </div>
      )}
      {items.map((item) => (
        <div key={item.id} className="fn-api-row">
          <ColumnField value={item.key} columns={columns} placeholder="Select column"
            onChange={(v) => onChange(items.map((r) => r.id === item.id ? { ...r, key: v } : r))} />
          <input className="fn-btn-row-input nodrag" value={item.value} placeholder="{{name}}"
            onChange={(e) => onChange(items.map((r) => r.id === item.id ? { ...r, value: e.target.value } : r))} />
          <button type="button" className="fn-icon-btn nodrag"
            onClick={() => onChange(items.filter((r) => r.id !== item.id))}>x</button>
        </div>
      ))}
      <button type="button" className="fn-add-btn nodrag" onClick={() => onChange([...items, makeItem()])}>
        + Add Column
      </button>
    </div>
  );
}

function OutputHandles() {
  return (
    <div className="fn-api-outputs">
      <div className="fn-api-branch">
        <span className="fn-cond-dot fn-cond-dot-true" /><span>Success</span>
        <Handle type="source" position={Position.Right} id="success"
          className="fn-handle-out fn-handle-success" style={{ position: "absolute", right: -7 }} />
      </div>
      <div className="fn-api-branch">
        <span className="fn-cond-dot fn-cond-dot-false" /><span>Fail</span>
        <Handle type="source" position={Position.Right} id="fail"
          className="fn-handle-out fn-handle-fail" style={{ position: "absolute", right: -7 }} />
      </div>
    </div>
  );
}

// ─── Unified Google Sheets Node ────────────────────────────────────────────────

function GoogleSheetsNode({ id, data, selected }: NodeProps<GoogleSheetsData>) {
  const { patch, del } = useNodePatch<GoogleSheetsData>(id);

  const gs = useGoogleSheetsConnection(
    data.spreadsheetId,
    data.sheetTitle,
    () => patch({ connectionId: "", spreadsheetId: "", spreadsheetName: "", sheetTitle: "", rowValues: [], fetchMappings: [] })
  );

  // Sync connection id
  useEffect(() => {
    const cid = gs.status?.connection?.id ?? "";
    if (cid && data.connectionId !== cid) patch({ connectionId: cid });
  }, [data.connectionId, gs.status?.connection?.id, patch]);

  const op = data.operation ?? "addRow";
  const needsRef       = op === "updateRow" || op === "fetchRow" || op === "fetchRows";
  const needsRowValues = op === "addRow"    || op === "updateRow";
  const needsMappings  = op === "fetchRow"  || op === "fetchRows";
  const opInfo = OPERATIONS.find((o) => o.value === op)!;
  const rowValues    = data.rowValues    ?? [];
  const fetchMappings = data.fetchMappings ?? [];

  return (
    <div className={`fn-node fn-node-googleSheets${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="📊" title="Google Sheets" onDelete={del} />
      <div className="fn-node-body">

        {/* Operation selector */}
        <div className="fn-node-field">
          <label className="fn-node-label">OPERATION</label>
          <div className="fn-gs-ops">
            {OPERATIONS.map((o) => (
              <button key={o.value} type="button"
                className={`fn-gs-op nodrag${op === o.value ? " fn-gs-op-active" : ""}`}
                onClick={() => patch({ operation: o.value })} title={o.desc}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="fn-api-hint" style={{ marginTop: "0.2rem" }}>{opInfo.desc}</div>
        </div>

        <ConnectionBanner gs={gs} />

        <SpreadsheetPicker gs={gs}
          spreadsheetId={data.spreadsheetId} sheetTitle={data.sheetTitle}
          onSpreadsheet={(id, name) => patch({ spreadsheetId: id, spreadsheetName: name, sheetTitle: "", rowValues: [], fetchMappings: [] })}
          onSheet={(t) => patch({ sheetTitle: t, rowValues: [], fetchMappings: [] })} />

        {/* Match column + value (Update / Fetch) */}
        {needsRef && (
          <div className="fn-two">
            <div className="fn-node-field">
              <label className="fn-node-label">MATCH COLUMN</label>
              <ColumnField value={data.referenceColumn} columns={gs.columns}
                placeholder="Select column" onChange={(v) => patch({ referenceColumn: v })} />
            </div>
            <div className="fn-node-field">
              <label className="fn-node-label">MATCH VALUE</label>
              <input className="fn-node-input nodrag" value={data.referenceValue} placeholder="{{phone}}"
                onChange={(e) => patch({ referenceValue: e.target.value })} />
            </div>
          </div>
        )}

        {/* Column values (Add / Update) */}
        {needsRowValues && (
          <div className="fn-node-field">
            <label className="fn-node-label">COLUMN VALUES</label>
            <RowValuesList items={rowValues} columns={gs.columns}
              onChange={(v) => patch({ rowValues: v })} />
          </div>
        )}

        {/* Fetch mappings (Fetch / Fetch Top 10) */}
        {needsMappings && (
          <div className="fn-node-field">
            <label className="fn-node-label">MAP COLUMNS TO VARIABLES</label>
            <div className="fn-api-hint" style={{ marginBottom: "0.3rem" }}>
              Map sheet columns to flow variable names for use later.
            </div>
            <div className="fn-btn-rows">
              {fetchMappings.length > 0 && (
                <div className="fn-gs-map-header">
                  <span>Sheet Column</span><span>Flow Variable</span><span />
                </div>
              )}
              {fetchMappings.map((item) => (
                <div key={item.id} className="fn-api-row">
                  <ColumnField value={item.key} columns={gs.columns} placeholder="Select column"
                    onChange={(v) => patch({ fetchMappings: fetchMappings.map((r) => r.id === item.id ? { ...r, key: v } : r) })} />
                  <input className="fn-btn-row-input nodrag" value={item.value} placeholder="customer_name"
                    onChange={(e) => patch({ fetchMappings: fetchMappings.map((r) => r.id === item.id ? { ...r, value: e.target.value } : r) })} />
                  <button type="button" className="fn-icon-btn nodrag"
                    onClick={() => patch({ fetchMappings: fetchMappings.filter((r) => r.id !== item.id) })}>x</button>
                </div>
              ))}
              <button type="button" className="fn-add-btn nodrag"
                onClick={() => patch({ fetchMappings: [...fetchMappings, makeItem()] })}>+ Add Mapping</button>
            </div>
          </div>
        )}

        {/* Save As */}
        <div className="fn-node-field">
          <label className="fn-node-label">SAVE AS</label>
          <input className="fn-node-input nodrag" value={data.saveAs} placeholder="sheet_result"
            onChange={(e) => patch({ saveAs: e.target.value })} />
          <div className="fn-api-hint" style={{ marginTop: "0.18rem" }}>
            Use <code style={{ fontSize: "0.65rem" }}>{`{{${data.saveAs || "sheet_result"}_status}}`}</code>
            {needsMappings && fetchMappings[0]?.value
              ? <> or <code style={{ fontSize: "0.65rem" }}>{`{{${fetchMappings[0].value}}}`}</code></> : null}
            {" "}in later blocks.
          </div>
        </div>

        <OutputHandles />
      </div>
    </div>
  );
}

// ─── Legacy node (backward compat, hidden from palette) ────────────────────────

type LegacyData = GoogleSheetsAddRowData | GoogleSheetsUpdateRowData | GoogleSheetsFetchRowData | GoogleSheetsFetchRowsData;

function LegacyGSNode({ id, data, selected, title, desc }: NodeProps<LegacyData> & { title: string; desc: string }) {
  const { patch, del } = useNodePatch<LegacyData>(id);

  const gs = useGoogleSheetsConnection(
    data.spreadsheetId,
    data.sheetTitle,
    () => patch({ connectionId: "", spreadsheetId: "", spreadsheetName: "", sheetTitle: "" } as Partial<LegacyData>)
  );

  useEffect(() => {
    const cid = gs.status?.connection?.id ?? "";
    if (cid && data.connectionId !== cid) patch({ connectionId: cid } as Partial<LegacyData>);
  }, [data.connectionId, gs.status?.connection?.id, patch]);

  const rowValues = Array.isArray((data as { rowValues?: FlowKeyValueItem[] }).rowValues)
    ? (data as { rowValues: FlowKeyValueItem[] }).rowValues : [];

  return (
    <div className={`fn-node fn-node-${data.kind}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" className="fn-handle-in" />
      <NodeHeader icon="📊" title={title} onDelete={del} />
      <div className="fn-node-body">
        <div className="fn-api-hint" style={{ marginBottom: "0.45rem" }}>{desc}</div>
        <ConnectionBanner gs={gs} />
        <SpreadsheetPicker gs={gs}
          spreadsheetId={data.spreadsheetId} sheetTitle={data.sheetTitle}
          onSpreadsheet={(sid, name) => patch({ spreadsheetId: sid, spreadsheetName: name, sheetTitle: "" } as Partial<LegacyData>)}
          onSheet={(t) => patch({ sheetTitle: t } as Partial<LegacyData>)} />

        {"referenceColumn" in data && (
          <div className="fn-two">
            <div className="fn-node-field">
              <label className="fn-node-label">MATCH COLUMN</label>
              <ColumnField value={data.referenceColumn} columns={gs.columns} placeholder="Select column"
                onChange={(v) => patch({ referenceColumn: v } as Partial<LegacyData>)} />
            </div>
            <div className="fn-node-field">
              <label className="fn-node-label">MATCH VALUE</label>
              <input className="fn-node-input nodrag" value={data.referenceValue} placeholder="{{phone}}"
                onChange={(e) => patch({ referenceValue: e.target.value } as Partial<LegacyData>)} />
            </div>
          </div>
        )}

        {"rowValues" in data && (
          <div className="fn-node-field">
            <label className="fn-node-label">COLUMN VALUES</label>
            <RowValuesList items={rowValues} columns={gs.columns}
              onChange={(v) => patch({ rowValues: v } as Partial<LegacyData>)} />
          </div>
        )}

        <div className="fn-node-field">
          <label className="fn-node-label">SAVE AS</label>
          <input className="fn-node-input nodrag" value={data.saveAs} placeholder="google_sheet_result"
            onChange={(e) => patch({ saveAs: e.target.value } as Partial<LegacyData>)} />
        </div>
        <OutputHandles />
      </div>
    </div>
  );
}

// ─── Block definitions ─────────────────────────────────────────────────────────

export const googleSheetsStudioBlock: StudioFlowBlockDefinition<GoogleSheetsData> = {
  kind: "googleSheets",
  channels: ["web", "qr", "api"],
  catalog: { kind: "googleSheets", icon: "📊", name: "Google Sheets", desc: "Add, update, or fetch rows", section: "Actions", availableInPalette: true, status: "active" },
  createDefaultData: () => ({
    kind: "googleSheets", operation: "addRow",
    connectionId: "", spreadsheetId: "", spreadsheetName: "", sheetTitle: "",
    saveAs: "sheet_result", referenceColumn: "", referenceValue: "",
    rowValues: [makeItem()], fetchMappings: []
  }),
  NodeComponent: GoogleSheetsNode
};

export const googleSheetsAddRowStudioBlock: StudioFlowBlockDefinition<GoogleSheetsAddRowData> = {
  kind: "googleSheetsAddRow", channels: ["web", "qr", "api"],
  catalog: { kind: "googleSheetsAddRow", icon: "📊", name: "GS Add Row", desc: "Append a row", section: "Actions", availableInPalette: false, status: "legacy" },
  createDefaultData: () => ({ kind: "googleSheetsAddRow", connectionId: "", spreadsheetId: "", spreadsheetName: "", sheetTitle: "", saveAs: "gs_add", rowValues: [makeItem()] }),
  NodeComponent: (p: NodeProps<GoogleSheetsAddRowData>) => <LegacyGSNode {...p} title="GS Add Row" desc="Append a new row." />
};

export const googleSheetsUpdateRowStudioBlock: StudioFlowBlockDefinition<GoogleSheetsUpdateRowData> = {
  kind: "googleSheetsUpdateRow", channels: ["web", "qr", "api"],
  catalog: { kind: "googleSheetsUpdateRow", icon: "📊", name: "GS Update Row", desc: "Update a matched row", section: "Actions", availableInPalette: false, status: "legacy" },
  createDefaultData: () => ({ kind: "googleSheetsUpdateRow", connectionId: "", spreadsheetId: "", spreadsheetName: "", sheetTitle: "", saveAs: "gs_update", referenceColumn: "", referenceValue: "", rowValues: [makeItem()] }),
  NodeComponent: (p: NodeProps<GoogleSheetsUpdateRowData>) => <LegacyGSNode {...p} title="GS Update Row" desc="Find and update the first matched row." />
};

export const googleSheetsFetchRowStudioBlock: StudioFlowBlockDefinition<GoogleSheetsFetchRowData> = {
  kind: "googleSheetsFetchRow", channels: ["web", "qr", "api"],
  catalog: { kind: "googleSheetsFetchRow", icon: "📊", name: "GS Fetch Row", desc: "Fetch the first matched row", section: "Actions", availableInPalette: false, status: "legacy" },
  createDefaultData: () => ({ kind: "googleSheetsFetchRow", connectionId: "", spreadsheetId: "", spreadsheetName: "", sheetTitle: "", saveAs: "gs_row", referenceColumn: "", referenceValue: "" }),
  NodeComponent: (p: NodeProps<GoogleSheetsFetchRowData>) => <LegacyGSNode {...p} title="GS Fetch Row" desc="Fetch the first matched row." />
};

export const googleSheetsFetchRowsStudioBlock: StudioFlowBlockDefinition<GoogleSheetsFetchRowsData> = {
  kind: "googleSheetsFetchRows", channels: ["web", "qr", "api"],
  catalog: { kind: "googleSheetsFetchRows", icon: "📊", name: "GS Fetch Top 10", desc: "Fetch up to 10 matched rows", section: "Actions", availableInPalette: false, status: "legacy" },
  createDefaultData: () => ({ kind: "googleSheetsFetchRows", connectionId: "", spreadsheetId: "", spreadsheetName: "", sheetTitle: "", saveAs: "gs_rows", referenceColumn: "", referenceValue: "" }),
  NodeComponent: (p: NodeProps<GoogleSheetsFetchRowsData>) => <LegacyGSNode {...p} title="GS Fetch Top 10" desc="Fetch up to 10 matched rows." />
};
