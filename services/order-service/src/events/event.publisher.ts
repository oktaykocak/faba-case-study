import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import {
  DomainEvent,
  OrderCreatedEvent,
  OrderCancelledEvent,
  OrderDeliveredEvent,
  OrderedEvent,
} from '@ecommerce/shared-types';
import { v4 as uuidv4 } from 'uuid';
import { getRmqOptionsForPublisher } from './rmq-options.helper';
import { SequenceService } from './sequence.service';
import { RetryService } from './retry.service';
import { EventBufferService } from './event-buffer.service';

@Injectable()
export class EventPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventPublisher.name);

  private inventoryClient: ClientProxy;
  private notificationClient: ClientProxy;

  constructor(
    private readonly sequenceService: SequenceService,
    private readonly retryService: RetryService,
    private readonly eventBufferService: EventBufferService,
  ) {
    this.inventoryClient = ClientProxyFactory.create(
      getRmqOptionsForPublisher(
        process.env.RABBITMQ_INVENTORY_SERVICE ?? 'inventory_queue',
        3, // max retries
      ),
    );
    this.notificationClient = ClientProxyFactory.create(
      getRmqOptionsForPublisher(
        process.env.RABBITMQ_NOTIFICATION_SERVICE ?? 'notification_queue',
        3, // max retries
      ),
    );
  }

  async publishOrderCreated(order: any, correlationId?: string): Promise<void> {
    const sequenceNumber = await this.sequenceService.getNextSequenceNumber(order.id, 'order');

    this.logger.log(
      `📊 [ORDER_CREATED] Generated sequence number: ${sequenceNumber} for entity: ${order.id}`,
    );

    const event: OrderCreatedEvent = {
      id: uuidv4(),
      type: 'order.created',
      timestamp: new Date(),
      version: '1.0',
      sequenceNumber,
      entityId: order.id,
      correlationId: correlationId || uuidv4(),
      payload: { order },
    };

    // Create ordered event for buffer processing
    const orderedEvent: OrderedEvent = {
      id: event.id,
      timestamp: event.timestamp,
      version: event.version,
      sequenceNumber: event.sequenceNumber,
      entityId: event.entityId,
      correlationId: event.correlationId,
      processed: false,
    };

    // Add to event buffer for ordered processing
    await this.eventBufferService.addEvent(orderedEvent);

    // Send to inventory service for reservation
    await this.publishToInventory(event, 'order.created');

    // Send to notification service for customer notification
    await this.publishToNotification(
      {
        type: 'ORDER_CREATED',
        orderId: order.id,
        customerId: order.customerId,
        totalAmount: order.totalAmount,
        timestamp: new Date(),
      },
      'order.notification',
    );
  }

  async publishOrderCancelled(
    orderId: string,
    items: any[],
    reason: string,
    correlationId?: string,
  ): Promise<void> {
    const sequenceNumber = await this.sequenceService.getNextSequenceNumber(orderId, 'order');

    const event: OrderCancelledEvent = {
      id: uuidv4(),
      type: 'order.cancelled',
      timestamp: new Date(),
      version: '1.0',
      sequenceNumber,
      entityId: orderId,
      correlationId: correlationId || uuidv4(),
      payload: {
        orderId,
        items,
        reason,
      },
    };

    // Create ordered event for buffer processing
    const orderedEvent: OrderedEvent = {
      id: event.id,
      timestamp: event.timestamp,
      version: event.version,
      sequenceNumber: event.sequenceNumber,
      entityId: event.entityId,
      correlationId: event.correlationId,
      processed: false,
    };

    // Add to event buffer for ordered processing
    await this.eventBufferService.addEvent(orderedEvent);

    // Send to inventory service for reservation release
    await this.publishToInventory(event, 'order.cancelled');

    // Send to notification service for customer notification
    await this.publishToNotification(
      {
        type: 'ORDER_CANCELLED',
        orderId,
        items,
        reason,
        timestamp: new Date(),
      },
      'order.cancelled.notification',
    );
  }

  async publishOrderDelivered(
    orderId: string,
    items: any[],
    correlationId?: string,
  ): Promise<void> {
    const sequenceNumber = await this.sequenceService.getNextSequenceNumber(orderId, 'order');

    this.logger.log(
      `📊 [ORDER_DELIVERED] Generated sequence number: ${sequenceNumber} for entity: ${orderId}`,
    );

    const event: OrderDeliveredEvent = {
      id: uuidv4(),
      type: 'order.delivered',
      timestamp: new Date(),
      version: '1.0',
      sequenceNumber,
      entityId: orderId,
      correlationId: correlationId || uuidv4(),
      payload: {
        orderId,
        items,
      },
    };

    // Create ordered event for buffer processing
    const orderedEvent: OrderedEvent = {
      id: event.id,
      timestamp: event.timestamp,
      version: event.version,
      sequenceNumber: event.sequenceNumber,
      entityId: event.entityId,
      correlationId: event.correlationId,
      processed: false,
    };

    // Add to event buffer for ordered processing
    await this.eventBufferService.addEvent(orderedEvent);

    // Send to inventory service for delivery finalization
    await this.publishToInventory(event, 'order.delivered');

    // Send to notification service for customer notification
    await this.publishToNotification(
      {
        type: 'ORDER_DELIVERED',
        orderId,
        items,
        timestamp: new Date(),
      },
      'order.notification',
    );
  }

  private async publishToInventory(event: DomainEvent, routingKey: string): Promise<void> {
    try {
      this.logger.log(`Publishing to inventory: ${event.type} with ID: ${event.id}`);

      await this.retryService.executeWithRetry(
        () =>
          this.inventoryClient
            .emit(routingKey, {
              data: event,
              timestamp: new Date(),
              correlationId: event.correlationId,
              headers: {
                'x-message-id': event.id,
                'x-correlation-id': event.correlationId,
                'x-event-type': event.type,
                'x-retry-count': '0',
                'x-original-timestamp': new Date().toISOString(),
              },
            })
            .toPromise(),
        { operationType: 'rabbitmq' },
        `publish-inventory-event-${event.id}`,
      );

      this.logger.log(`Event published to inventory successfully: ${event.type}`);
    } catch (error) {
      this.logger.error(`Failed to publish event to inventory: ${event.type}`, error.stack);
      throw error;
    }
  }

  private async publishToNotification(notification: any, routingKey: string): Promise<void> {
    try {
      this.logger.log(`Publishing to notification: ${notification.type}`);

      await this.retryService.executeWithRetry(
        () =>
          this.notificationClient
            .emit(routingKey, {
              data: notification,
              timestamp: new Date(),
              correlationId: notification.correlationId || uuidv4(),
              headers: {
                'x-message-id': notification.id || uuidv4(),
                'x-correlation-id': notification.correlationId || uuidv4(),
                'x-notification-type': notification.type,
                'x-retry-count': '0',
                'x-original-timestamp': new Date().toISOString(),
              },
            })
            .toPromise(),
        { operationType: 'rabbitmq' },
        `publish-notification-event-${notification.id || uuidv4()}`,
      );

      this.logger.log(`Notification published successfully: ${notification.type}`);
    } catch (error) {
      this.logger.error(`Failed to publish notification: ${notification.type}`, error.stack);
      throw error;
    }
  }

  async onModuleInit() {
    await this.inventoryClient.connect();
    await this.notificationClient.connect();
    this.logger.log('EventPublisher clients connected successfully');
  }

  async onModuleDestroy() {
    await this.inventoryClient.close();
    await this.notificationClient.close();
    this.logger.log('EventPublisher clients disconnected');
  }

  // Public getter methods for other services to access clients
  getInventoryClient(): ClientProxy {
    return this.inventoryClient;
  }

  getNotificationClient(): ClientProxy {
    return this.notificationClient;
  }
}
