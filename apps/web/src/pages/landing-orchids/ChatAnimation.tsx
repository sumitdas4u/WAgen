import { useEffect, useMemo, useState } from "react";

type ChatMessage = {
  id: number;
  text: string;
  sender: "user" | "ai";
};

const CHAT_MESSAGES: ChatMessage[] = [
  { id: 1, text: "Hi. Is your service available tomorrow?", sender: "user" },
  { id: 2, text: "Yes. We have slots at 10:00 AM and 3:00 PM.", sender: "ai" },
  { id: 3, text: "Please book 10:00 AM.", sender: "user" },
  { id: 4, text: "Booked. You will receive confirmation shortly.", sender: "ai" },
  { id: 5, text: "Do you support UPI payment?", sender: "user" },
  { id: 6, text: "Yes. Payment link sent. Need anything else?", sender: "ai" }
];

export function ChatAnimation() {
  const [index, setIndex] = useState(2);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current >= CHAT_MESSAGES.length ? 2 : current + 1));
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(() => CHAT_MESSAGES.slice(Math.max(0, index - 4), index), [index]);

  return (
    <div className="orch-chat-phone" aria-label="WhatsApp style chat preview">
      <div className="orch-chat-head">
        <div className="orch-chat-avatar">AI</div>
        <div>
          <strong>WagenAI Receptionist</strong>
          <small>Online now</small>
        </div>
      </div>
      <div className="orch-chat-body">
        {visible.map((message) => (
          <div key={message.id} className={message.sender === "user" ? "orch-bubble user" : "orch-bubble ai"}>
            {message.text}
          </div>
        ))}
      </div>
      <div className="orch-chat-input">
        <span>Type a message...</span>
        <button type="button" aria-label="Send">
          Send
        </button>
      </div>
    </div>
  );
}
