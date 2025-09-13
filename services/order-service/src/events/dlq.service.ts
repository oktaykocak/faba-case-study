import { Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

export interface DLQMessage {
  messageId: string;
  originalQueue: string;
  retryCount: number;
  errorReason: string;
  timestamp: Date;
  payload: any;
  headers: any;
}

@Injectable()
export class DLQService {
  private readonly logger = new Logger(DLQService.name);

  async sendToDLQ(message: any, channel: any, error: Error, originalQueue: string): Promise<void> {
    try {
      const dlqMessage: DLQMessage = {
        messageId: message.properties.messageId || this.generateMessageId(),
        originalQueue,
        retryCount: this.getRetryCount(message.properties.headers),
        errorReason: error.message,
        timestamp: new Date(),
        payload: message.content,
        headers: {
          ...message.properties.headers,
          'x-dlq-timestamp': new Date().toISOString(),
          'x-dlq-reason': error.message,
          'x-dlq-stack': error.stack,
        },
      };

      this.logger.error('Message sent to DLQ:', {
        messageId: dlqMessage.messageId,
        originalQueue: dlqMessage.originalQueue,
        retryCount: dlqMessage.retryCount,
        errorReason: dlqMessage.errorReason,
      });

      // Reject message to send to DLQ
      channel.nack(message, false, false);

      // Store DLQ message for analysis (could be database, file, etc.)
      await this.storeDLQMessage(dlqMessage);
    } catch (dlqError) {
      this.logger.error('Failed to send message to DLQ:', dlqError.stack);
      // As last resort, reject without requeue
      channel.nack(message, false, false);
    }
  }

  async analyzeDLQMessages(queueName: string): Promise<DLQMessage[]> {
    // This would typically query a database or DLQ storage
    this.logger.log(`Analyzing DLQ messages for queue: ${queueName}`);

    // Return stored DLQ messages for analysis
    return this.getStoredDLQMessages(queueName);
  }

  async reprocessDLQMessage(
    messageId: string,
    targetQueue: string,
    client: ClientProxy,
  ): Promise<void> {
    try {
      const dlqMessage = await this.getDLQMessage(messageId);

      if (!dlqMessage) {
        throw new Error(`DLQ message with ID ${messageId} not found`);
      }

      this.logger.log(`Reprocessing DLQ message ${messageId} to queue ${targetQueue}`);

      // Remove DLQ headers and reset retry count
      const cleanHeaders = this.cleanDLQHeaders(dlqMessage.headers);

      // Republish message to original queue
      await client
        .emit(targetQueue, {
          ...dlqMessage.payload,
          headers: cleanHeaders,
        })
        .toPromise();

      // Mark as reprocessed
      await this.markDLQMessageAsReprocessed(messageId);

      this.logger.log(`Successfully reprocessed DLQ message ${messageId}`);
    } catch (error) {
      this.logger.error(`Failed to reprocess DLQ message ${messageId}:`, error.stack);
      throw error;
    }
  }

  private getRetryCount(headers: any): number {
    return parseInt(headers?.['x-retry-count'] || '0');
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async storeDLQMessage(dlqMessage: DLQMessage): Promise<void> {
    // In a real implementation, this would store to a database
    // For now, we'll just log it
    this.logger.warn('DLQ Message stored:', JSON.stringify(dlqMessage, null, 2));
  }

  private async getStoredDLQMessages(queueName: string): Promise<DLQMessage[]> {
    // In a real implementation, this would query from a database
    // For now, return empty array
    return [];
  }

  private async getDLQMessage(messageId: string): Promise<DLQMessage | null> {
    // In a real implementation, this would query from a database
    // For now, return null
    return null;
  }

  private cleanDLQHeaders(headers: any): any {
    const cleanHeaders = { ...headers };

    // Remove DLQ-specific headers
    delete cleanHeaders['x-dlq-timestamp'];
    delete cleanHeaders['x-dlq-reason'];
    delete cleanHeaders['x-dlq-stack'];

    // Reset retry count
    cleanHeaders['x-retry-count'] = '0';

    return cleanHeaders;
  }

  private async markDLQMessageAsReprocessed(messageId: string): Promise<void> {
    // In a real implementation, this would update the database
    this.logger.log(`Marked DLQ message ${messageId} as reprocessed`);
  }

  getDLQStats(queueName: string): Promise<{
    totalMessages: number;
    messagesByError: Record<string, number>;
    oldestMessage: Date | null;
    newestMessage: Date | null;
  }> {
    // In a real implementation, this would query DLQ statistics
    return Promise.resolve({
      totalMessages: 0,
      messagesByError: {},
      oldestMessage: null,
      newestMessage: null,
    });
  }
}
