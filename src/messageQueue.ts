export type QueueProcessor<TMessage> = (jid: string, message: TMessage) => Promise<void>;

export class PerUserMessageQueue<TMessage> {
  // Required shape: Map<string, Array<Message>>
  private readonly queues = new Map<string, Array<TMessage>>();
  private readonly processingJids = new Set<string>();

  constructor(private readonly processor: QueueProcessor<TMessage>) {}

  enqueue(jid: string, message: TMessage): void {
    const existing = this.queues.get(jid) ?? [];
    existing.push(message);
    this.queues.set(jid, existing);

    if (!this.processingJids.has(jid)) {
      void this.processQueue(jid);
    }
  }

  getQueueSize(jid: string): number {
    return this.queues.get(jid)?.length ?? 0;
  }

  private async processQueue(jid: string): Promise<void> {
    if (this.processingJids.has(jid)) {
      return;
    }

    this.processingJids.add(jid);

    try {
      while (true) {
        const queue = this.queues.get(jid);
        if (!queue || queue.length === 0) {
          break;
        }

        const next = queue.shift();
        if (!next) {
          continue;
        }

        try {
          await this.processor(jid, next);
        } catch (error) {
          console.error(`[Queue] Failed to process message for ${jid}`, error);
        }
      }
    } finally {
      this.processingJids.delete(jid);

      const queue = this.queues.get(jid);
      if (!queue || queue.length === 0) {
        this.queues.delete(jid);
        return;
      }

      // In case new items were added during finalization window.
      void this.processQueue(jid);
    }
  }
}

