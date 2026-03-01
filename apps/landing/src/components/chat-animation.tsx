"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

const messages = [
  { id: 1, text: "Hi! I'm interested in your products.", sender: "user", delay: 1 },
  { id: 2, text: "Hello! I'm WagenAI, your 24/7 receptionist. How can I help you today?", sender: "ai", delay: 3 },
  { id: 3, text: "Do you have any availability tomorrow?", sender: "user", delay: 5 },
  { id: 4, text: "Yes! We have slots at 10 AM and 3 PM. Would you like to book one?", sender: "ai", delay: 7 },
  { id: 5, text: "10 AM works for me. What's the price?", sender: "user", delay: 9 },
  { id: 6, text: "Great! Booking confirmed for 10 AM. Our starter package is ₹499/mo.", sender: "ai", delay: 11 },
  { id: 7, text: "Can I pay via UPI?", sender: "user", delay: 13 },
  { id: 8, text: "Absolutely! I sent the payment link to your number. Anything else?", sender: "ai", delay: 15 },
  { id: 9, text: "Where is your shop located?", sender: "user", delay: 17 },
  { id: 10, text: "We are located at MG Road, Bangalore. Open 10 AM - 8 PM daily.", sender: "ai", delay: 19 },
  { id: 11, text: "Do you offer home delivery?", sender: "user", delay: 21 },
  { id: 12, text: "Yes, we do. Free delivery within 5km for orders above ₹1000.", sender: "ai", delay: 23 },
  { id: 13, text: "Perfect. I will visit tomorrow then.", sender: "user", delay: 25 },
  { id: 14, text: "We look forward to seeing you. Have a great day!", sender: "ai", delay: 27 },
  { id: 15, text: "Thanks!", sender: "user", delay: 29 },
] as const;

export function ChatAnimation() {
  const [visibleMessages, setVisibleMessages] = useState<number[]>([]);
  const [key, setKey] = useState(0);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    messages.forEach((msg) => {
      const timer = setTimeout(() => {
        setVisibleMessages((prev) => {
          const next = [...prev, msg.id];
          if (next.length > 6) {
            return next.slice(next.length - 6);
          }
          return next;
        });
      }, msg.delay * 1000);
      timers.push(timer);
    });

    const resetTimer = setTimeout(() => {
      setVisibleMessages([]);
      setKey((prev) => prev + 1);
    }, 35000);
    timers.push(resetTimer);

    return () => timers.forEach(clearTimeout);
  }, [key]);

  return (
    <div className="relative z-10 flex aspect-[4/5] w-full flex-col overflow-hidden rounded-[3rem] border-[12px] border-zinc-900 bg-zinc-50 shadow-2xl dark:bg-zinc-900">
      <div className="h-16 w-full shrink-0 bg-green-600 px-6">
        <div className="flex h-full items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white">
            AI
          </div>
          <div>
            <div className="mb-1 h-4 w-32 rounded bg-white/30" />
            <div className="h-2 w-16 rounded bg-white/20" />
          </div>
        </div>
      </div>

      <div className="relative flex-1 space-y-4 overflow-hidden bg-[#e5ddd5] p-6 pt-12 dark:bg-zinc-950/50">
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(#000 0.5px, transparent 0.5px)", backgroundSize: "10px 10px" }}
        />

        <AnimatePresence mode="popLayout">
          {messages.map((msg) =>
            visibleMessages.includes(msg.id) ? (
              <motion.div
                key={`${key}-${msg.id}`}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={`relative max-w-[85%] rounded-2xl p-3 text-sm shadow-sm ${
                  msg.sender === "user"
                    ? "mr-auto rounded-tl-none bg-white text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                    : "ml-auto rounded-tr-none bg-green-600 font-medium text-white"
                }`}
              >
                {msg.text}
                <div
                  className={`absolute top-0 h-3 w-3 ${
                    msg.sender === "user"
                      ? "left-[-6px] border-l-[12px] border-l-transparent border-t-[12px] border-t-white dark:border-t-zinc-800"
                      : "right-[-6px] border-r-[12px] border-r-transparent border-t-[12px] border-t-green-600"
                  }`}
                />
              </motion.div>
            ) : null,
          )}
        </AnimatePresence>
      </div>

      <div className="flex h-16 items-center gap-2 border-t bg-white p-3 dark:bg-zinc-900">
        <div className="flex h-full flex-1 items-center rounded-full bg-zinc-100 px-4 text-xs text-zinc-400 dark:bg-zinc-800">
          Type a message...
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-600 text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </div>
      </div>
    </div>
  );
}