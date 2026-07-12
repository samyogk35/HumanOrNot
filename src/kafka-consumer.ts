import { Kafka, Consumer } from 'kafkajs';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { messages } from './schema';

export const CHAT_TOPIC = 'chat-messages';
export const CONSUMER_GROUP = 'chat-writer';

export interface MessageBatcherOptions<T> {
  maxSize: number;
  flushIntervalMs: number;
  onFlush: (batch: T[]) => Promise<void>;
}

/**
 * Buffers items and flushes them either when the batch reaches maxSize
 * or when flushIntervalMs elapses since the batch's first item — whichever
 * comes first.
 */
export class MessageBatcher<T = any> {
  private batch: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: MessageBatcherOptions<T>;

  constructor(opts: MessageBatcherOptions<T>) {
    this.opts = opts;
  }

  add(item: T): void {
    this.batch.push(item);
    // Start the flush timer on the first item of a new batch window.
    if (!this.timer) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.opts.flushIntervalMs);
    }
    if (this.batch.length >= this.opts.maxSize) {
      void this.flush();
    }
  }

  getCurrentSize(): number {
    return this.batch.length;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.batch.length === 0) return;
    // Capture + clear synchronously so new adds start a fresh batch.
    const batch = this.batch;
    this.batch = [];
    await this.opts.onFlush(batch);
  }
}

interface ChatRecord {
  roomId: string;
  content: string;
  senderId: number;
}

let consumer: Consumer | undefined;
let consumerPool: Pool | undefined;
let batcher: MessageBatcher<ChatRecord> | undefined;

export async function startKafkaConsumer(): Promise<void> {
  const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean);
  const kafka = new Kafka({ clientId: 'chat-consumer', brokers });

  consumerPool = new Pool({ connectionString: process.env.DATABASE_URL });
  consumerPool.on('error', () => {});
  const db: NodePgDatabase = drizzle(consumerPool);

  batcher = new MessageBatcher<ChatRecord>({
    maxSize: 50,
    flushIntervalMs: 500,
    onFlush: async (records) => {
      // Bulk insert the whole batch in a single statement.
      await db.insert(messages).values(
        records.map((r) => ({
          roomId: r.roomId,
          content: r.content,
          senderId: r.senderId,
        }))
      );
    },
  });

  consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: CHAT_TOPIC, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const record = JSON.parse(message.value.toString()) as ChatRecord;
      batcher!.add(record);
    },
  });
}

export async function stopKafkaConsumer(): Promise<void> {
  // Flush anything still buffered before shutting down.
  if (batcher) {
    await batcher.flush();
    batcher = undefined;
  }
  if (consumer) {
    await consumer.disconnect().catch(() => {});
    consumer = undefined;
  }
  if (consumerPool) {
    await consumerPool.end().catch(() => {});
    consumerPool = undefined;
  }
}
