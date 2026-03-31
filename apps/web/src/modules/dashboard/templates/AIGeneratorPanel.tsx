import { useState } from "react";
import type { GeneratedTemplate, TemplateStyle } from "../../../lib/api";
import { useGenerateTemplateMutation } from "./queries";

const STYLES: Array<{ value: TemplateStyle; label: string; emoji: string; desc: string }> = [
  { value: "normal", label: "Normal", emoji: "✏️", desc: "Clear and professional" },
  { value: "exciting", label: "Exciting", emoji: "🚀", desc: "Energetic with emojis" },
  { value: "poetic", label: "Poetic", emoji: "🌸", desc: "Warm and heartfelt" },
  { value: "funny", label: "Funny", emoji: "😄", desc: "Light-hearted and witty" }
];

interface Props {
  token: string;
  onClose: () => void;
  onUse: (generated: GeneratedTemplate) => void;
}

export function AIGeneratorPanel({ token, onClose, onUse }: Props) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<TemplateStyle>("normal");
  const generateMutation = useGenerateTemplateMutation(token);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#fff",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        padding: "24px",
        gap: "20px",
        overflowY: "auto"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>✨ AI Template Generator</h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#666" }}>
            Describe what you want to say and let AI build a ready-to-submit template in seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#666" }}
        >
          ×
        </button>
      </div>

      <div>
        <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
          What do you want to say?
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Remind customers about abandoned cart with a 10% discount offer"
          maxLength={500}
          rows={4}
          style={{
            width: "100%",
            borderRadius: "8px",
            border: "1.5px solid #e0e0e0",
            padding: "10px 12px",
            fontSize: "14px",
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit"
          }}
        />
        <div style={{ textAlign: "right", fontSize: "11px", color: "#aaa" }}>{prompt.length}/500</div>
      </div>

      <div>
        <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "10px" }}>
          Choose your style
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          {STYLES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStyle(s.value)}
              style={{
                padding: "12px",
                borderRadius: "10px",
                border: `2px solid ${style === s.value ? "#25d366" : "#e0e0e0"}`,
                background: style === s.value ? "#f0fdf4" : "#fff",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <div style={{ fontSize: "20px" }}>{s.emoji}</div>
              <div style={{ fontWeight: 700, fontSize: "13px", marginTop: "4px" }}>{s.label}</div>
              <div style={{ fontSize: "11px", color: "#666" }}>{s.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          generateMutation.mutate({ prompt, style }, {
            onSuccess: (data) => {
              if (data) onUse(data);
            }
          })
        }
        disabled={prompt.trim().length < 5 || generateMutation.isPending}
        style={{
          padding: "12px",
          borderRadius: "8px",
          background: "#25d366",
          color: "#fff",
          border: "none",
          fontWeight: 700,
          fontSize: "15px",
          cursor: "pointer",
          opacity: prompt.trim().length < 5 || generateMutation.isPending ? 0.6 : 1
        }}
      >
        {generateMutation.isPending ? "Generating..." : "Generate Template ✨"}
      </button>

      {generateMutation.isError && (
        <div
          style={{
            padding: "12px",
            borderRadius: "8px",
            background: "#fef2f2",
            color: "#dc2626",
            border: "1px solid #fecaca",
            fontSize: "13px"
          }}
        >
          {(generateMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}
