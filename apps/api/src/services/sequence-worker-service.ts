import { processDueSequenceEnrollments } from "./sequence-execution-service.js";

let timer: ReturnType<typeof setInterval> | null = null;

export function startSequenceWorker(): void {
  if (timer) return;

  const run = async () => {
    try {
      await processDueSequenceEnrollments(25);
    } catch (error) {
      console.error("[SequenceWorker] processing failed", error);
    }
  };

  void run();
  timer = setInterval(() => {
    void run();
  }, 60_000);
}

export function stopSequenceWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
