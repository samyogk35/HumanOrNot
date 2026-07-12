import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageBatcher } from '../src/kafka-consumer'; // Claude needs to implement

describe('Kafka Message Batcher (Unit Tests)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should flush when the batch size threshold is reached', async () => {
    let flushCount = 0;
    let lastFlushedBatch: any[] = [];
    
    const batcher = new MessageBatcher({
      maxSize: 3,
      flushIntervalMs: 5000,
      onFlush: async (batch) => {
        flushCount++;
        lastFlushedBatch = batch;
      }
    });

    batcher.add({ id: 1 });
    batcher.add({ id: 2 });
    expect(flushCount).toBe(0); // Not flushed yet

    batcher.add({ id: 3 }); // Hits max size (3)
    
    // We need to await promises if onFlush is async
    await vi.runAllTimersAsync();
    
    expect(flushCount).toBe(1);
    expect(lastFlushedBatch.length).toBe(3);
    
    // Ensure the batch was cleared after flush
    batcher.add({ id: 4 });
    expect(batcher.getCurrentSize()).toBe(1);
  });

  it('should flush a partial batch when the timer fires', async () => {
    let flushCount = 0;
    let lastFlushedBatch: any[] = [];
    
    const batcher = new MessageBatcher({
      maxSize: 100, // Very large, won't hit by size
      flushIntervalMs: 1000,
      onFlush: async (batch) => {
        flushCount++;
        lastFlushedBatch = batch;
      }
    });

    batcher.add({ id: 1 });
    batcher.add({ id: 2 });
    
    expect(flushCount).toBe(0);
    
    // Fast-forward time by 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    
    expect(flushCount).toBe(1);
    expect(lastFlushedBatch.length).toBe(2); // Flushed the partial batch
  });
});
