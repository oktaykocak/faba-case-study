import { Injectable, Logger } from '@nestjs/common';
import { OrderedEvent, EventBuffer } from '@ecommerce/shared-types';

@Injectable()
export class EventBufferService {
  private readonly logger = new Logger(EventBufferService.name);
  private readonly buffers = new Map<string, EventBuffer>();
  private readonly processingTimeout = 30000; // 30 seconds

  async addEvent(event: OrderedEvent): Promise<void> {
    const { entityId, sequenceNumber } = event;

    this.logger.log(
      `📥 [ADD_EVENT] Received event with sequence: ${sequenceNumber} for entity: ${entityId}`,
    );

    // Get or create buffer for entity
    let buffer = this.buffers.get(entityId);
    if (!buffer) {
      this.logger.log(`🆕 [NEW_BUFFER] Creating new buffer for entity: ${entityId}`);
      buffer = {
        entityId,
        pendingEvents: [],
        lastProcessedSequence: 0,
      };
      this.buffers.set(entityId, buffer);
    } else {
      this.logger.log(
        `📋 [EXISTING_BUFFER] Using existing buffer - lastProcessedSequence: ${buffer.lastProcessedSequence} for entity: ${entityId}`,
      );
    }

    // Add event to buffer
    buffer.pendingEvents.push(event);

    // Sort events by sequence number
    buffer.pendingEvents.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    this.logger.debug(`Added event with sequence ${sequenceNumber} for entity ${entityId}`);

    // Try to process events in order
    await this.processBufferedEvents(entityId);
  }

  private async processBufferedEvents(entityId: string): Promise<void> {
    const buffer = this.buffers.get(entityId);
    if (!buffer || buffer.pendingEvents.length === 0) {
      return;
    }

    // Debug logging for buffer state
    this.logger.log(`🔍 Processing buffer for entity: ${entityId}`);
    this.logger.log(
      `📊 Buffer state - lastProcessedSequence: ${buffer.lastProcessedSequence}, pendingEvents: ${buffer.pendingEvents.length}`,
    );
    if (buffer.pendingEvents.length > 0) {
      this.logger.log(
        `📋 Pending sequences: [${buffer.pendingEvents.map(e => e.sequenceNumber).join(', ')}]`,
      );
    }

    // Process events in sequence order
    while (buffer.pendingEvents.length > 0) {
      const nextEvent = buffer.pendingEvents[0];
      const expectedSequence = buffer.lastProcessedSequence + 1;

      this.logger.debug(
        `🔄 Processing: expected=${expectedSequence}, got=${nextEvent.sequenceNumber}`,
      );

      // Check if this is the next expected event
      if (nextEvent.sequenceNumber === expectedSequence) {
        // Remove from buffer
        buffer.pendingEvents.shift();

        // Process the event
        try {
          await this.processEvent(nextEvent);

          // Mark as processed
          nextEvent.processed = true;
          nextEvent.processedAt = new Date();
          buffer.lastProcessedSequence = nextEvent.sequenceNumber;

          this.logger.log(
            `✅ Processed event with sequence ${nextEvent.sequenceNumber} for entity ${entityId}`,
          );
        } catch (error) {
          this.logger.error(
            `❌ Failed to process event with sequence ${nextEvent.sequenceNumber}:`,
            error,
          );

          // Put event back at the beginning for retry
          buffer.pendingEvents.unshift(nextEvent);
          break;
        }
      } else if (nextEvent.sequenceNumber < expectedSequence) {
        // This event is already processed or out of order, skip it
        this.logger.warn(
          `⚠️ Skipping duplicate/old event with sequence ${nextEvent.sequenceNumber} (expected: ${expectedSequence})`,
        );
        buffer.pendingEvents.shift();
      } else {
        // Handle sequence gaps - check if we should force process or wait
        const sequenceGap = nextEvent.sequenceNumber - expectedSequence;

        if (sequenceGap === 1 && buffer.lastProcessedSequence === 0) {
          // Special case: first event is sequence 2, likely sequence 1 was processed elsewhere
          this.logger.warn(
            `🔧 Sequence gap detected: expected=${expectedSequence}, got=${nextEvent.sequenceNumber}. Force processing event.`,
          );

          // Remove from buffer and process immediately
          buffer.pendingEvents.shift();

          try {
            await this.processEvent(nextEvent);

            // Mark as processed
            nextEvent.processed = true;
            nextEvent.processedAt = new Date();
            buffer.lastProcessedSequence = nextEvent.sequenceNumber;

            this.logger.log(
              `✅ Force processed event with sequence ${nextEvent.sequenceNumber} for entity ${entityId}`,
            );
          } catch (error) {
            this.logger.error(
              `❌ Failed to force process event with sequence ${nextEvent.sequenceNumber}:`,
              error,
            );

            // Put event back at the beginning for retry
            buffer.pendingEvents.unshift(nextEvent);
            break;
          }
        } else if (sequenceGap > 5) {
          // Large gap - likely a different entity or reset needed
          this.logger.warn(
            `🚨 Large sequence gap (${sequenceGap}): expected=${expectedSequence}, got=${nextEvent.sequenceNumber}. Force processing.`,
          );

          // Remove from buffer and process immediately
          buffer.pendingEvents.shift();

          try {
            await this.processEvent(nextEvent);

            // Mark as processed
            nextEvent.processed = true;
            nextEvent.processedAt = new Date();
            buffer.lastProcessedSequence = nextEvent.sequenceNumber;

            this.logger.log(
              `✅ Force processed large gap event with sequence ${nextEvent.sequenceNumber} for entity ${entityId}`,
            );
          } catch (error) {
            this.logger.error(
              `❌ Failed to force process large gap event with sequence ${nextEvent.sequenceNumber}:`,
              error,
            );

            // Put event back at the beginning for retry
            buffer.pendingEvents.unshift(nextEvent);
            break;
          }
        } else {
          // Normal waiting for missing sequence
          this.logger.debug(
            `⏳ Waiting for sequence ${expectedSequence}, got ${nextEvent.sequenceNumber} (gap: ${sequenceGap})`,
          );
          break;
        }
      }
    }

    // Final buffer state logging
    this.logger.debug(
      `📊 Final buffer state - lastProcessedSequence: ${buffer.lastProcessedSequence}, pendingEvents: ${buffer.pendingEvents.length}`,
    );

    // Keep buffer with sequence state instead of deleting
    if (buffer.pendingEvents.length === 0) {
      this.logger.debug(
        `📊 Buffer empty but keeping sequence state: lastProcessedSequence=${buffer.lastProcessedSequence} for entity: ${entityId}`,
      );

      // Optional: Clean up very old buffers after much longer timeout
      setTimeout(() => {
        const currentBuffer = this.buffers.get(entityId);
        if (currentBuffer && currentBuffer.pendingEvents.length === 0) {
          // Only delete if no activity for a very long time (5 minutes)
          this.logger.debug(
            `🗑️ Cleaned up old buffer for entity: ${entityId} after extended timeout`,
          );
          this.buffers.delete(entityId);
        }
      }, this.processingTimeout * 10); // 5 minutes instead of 30 seconds
    }
  }

  private async processEvent(event: OrderedEvent): Promise<void> {
    this.logger.log(
      `Processing ordered event for entity ${event.entityId} (seq: ${event.sequenceNumber})`,
    );

    try {
      // Process event - OrderedEvent extends BaseEvent but doesn't have type property
      // We'll use a generic processing approach
      this.logger.debug(`Processing event with ID: ${event.id}`);

      // Generic event processing logic
      await this.handleGenericEvent(event);

      this.logger.log(`Successfully processed event (seq: ${event.sequenceNumber})`);
    } catch (error) {
      this.logger.error(`Failed to process event (seq: ${event.sequenceNumber})`, error);
      throw error;
    }
  }

  private async handleGenericEvent(event: OrderedEvent): Promise<void> {
    this.logger.debug(`Handling event for entity: ${event.entityId}`);

    // Generic event processing logic
    // This ensures events are processed in correct sequence order
    // The actual business logic would be implemented here

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 10));

    this.logger.debug(`Event processed successfully for entity: ${event.entityId}`);
  }

  getBufferStatus(entityId: string): EventBuffer | undefined {
    return this.buffers.get(entityId);
  }

  getAllBuffers(): Map<string, EventBuffer> {
    return new Map(this.buffers);
  }

  clearBuffer(entityId: string): void {
    this.buffers.delete(entityId);
  }

  getBufferStats(): { totalBuffers: number; totalPendingEvents: number } {
    let totalPendingEvents = 0;
    for (const buffer of this.buffers.values()) {
      totalPendingEvents += buffer.pendingEvents.length;
    }

    return {
      totalBuffers: this.buffers.size,
      totalPendingEvents,
    };
  }
}
