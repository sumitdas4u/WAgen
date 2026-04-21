import { env } from "../config/env.js";

export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  html: string;
  sender?: { email: string; name: string };
}): Promise<void> {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not configured");
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: input.sender ?? { email: "reports@wagenai.com", name: "WAgen AI" },
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo email failed (${response.status}): ${body}`);
  }
}
