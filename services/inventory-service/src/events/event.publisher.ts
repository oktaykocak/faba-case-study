import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import { v4 as uuidv4 } from 'uuid';
import { getRmqOptionsForPublisher } from './rmq-options.helper';
import { SequenceService } from './sequence.service';
import { EventBufferService } from './event-buffer.service';
import { RetryService } from './retry.service';
import { OrderedEvent } from '@ecommerce/shared-types';

@Injectable()
export class EventPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventPublisher.name);

  private orderClient: ClientProxy;
  private notificationClient: ClientProxy;

  constructor(
    private readonly sequenceService: SequenceService,
    private readonly retryService: RetryService,
    private readonly eventBufferService: EventBufferService,
  ) {
    this.orderClient = ClientProxyFactory.create(
      getRmqOptionsForPublisher(process.env.RABBITMQ_ORDER_SERVICE ?? 'order_queue', 3),
    );
    this.notificationClient = ClientProxyFactory.create(
      getRmqOptionsForPublisher(
        process.env.RABBITMQ_NOTIFICATION_SERVICE ?? 'notification_queue',
        3,
      ),
    );
  }

  async publishLowStockAlert(alertData: any): Promise<void> {
    await this.publishToNotification(
      {
        type: 'LOW_STOCK_ALERT',
        ...alertData,
        timestamp: new Date(),
      },
      'inventory.low_stock',
    );
  }

  async publishBackInStockAlert(alertData: any): Promise<void> {
    await this.publishToNotification(
      {
        type: 'BACK_IN_STOCK_ALERT',
        ...alertData,
        timestamp: new Date(),
      },
      'inventory.back_in_stock',
    );
  }

  async publishInventoryReserved(orderId: string, items: any[]): Promise<void> {
    const sequenceNumber = await this.sequenceService.getNextSequenceNumber(orderId, 'inventory');

    const event = {
      id: uuidv4(),
      type: 'inventory.reserved',
      timestamp: new Date(),
      version: '1.0',
      sequenceNumber,
      entityId: orderId,
      correlationId: uuidv4(),
      payload: { orderId, items },
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

    // Send to order service
    await this.publishToOrder(event, 'inventory.reserved');

    // Send to notification service
    await this.publishToNotification(
      {
        type: 'INVENTORY_RESERVED',
        orderId,
        items,
        timestamp: new Date(),
      },
      'inventory.notification',
    );
  }

  async publishInventoryReservationFailed(
    orderId: string,
    items: any[],
    reason: string,
  ): Promise<void> {
    const sequenceNumber = await this.sequenceService.getNextSequenceNumber(orderId, 'inventory');

    const event = {
      id: uuidv4(),
      type: 'inventory.reservation.failed',
      timestamp: new Date(),
      version: '1.0',
      sequenceNumber,
      entityId: orderId,
      correlationId: uuidv4(),
      payload: { orderId, items, reason },
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

    // Send to order service
    await this.publishToOrder(event, 'inventory.reservation.failed');

    // Send to notification service
    await this.publishToNotification(
      {
        type: 'INVENTORY_RESERVATION_FAILED',
        orderId,
        items,
        reason,
        timestamp: new Date(),
      },
      'inventory.notification',
    );
  }

  private async publishToOrder(event: any, routingKey: string): Promise<void> {
    await this.retryService.executeWithRetry(async () => {
      await this.orderClient.emit(routingKey, event).toPromise();
      this.logger.log(`Event published to order service: ${routingKey}`);
    });
  }

  private async publishToNotification(notification: any, routingKey: string): Promise<void> {
    await this.retryService.executeWithRetry(async () => {
      await this.notificationClient.emit(routingKey, notification).toPromise();
      this.logger.log(`Notification published: ${notification.type}`);
    });
  }

  async onModuleInit() {
    await this.orderClient.connect();
    await this.notificationClient.connect();
    this.logger.log('EventPublisher clients connected successfully');
  }

  async onModuleDestroy() {
    await this.orderClient.close();
    await this.notificationClient.close();
  }

  getOrderClient(): ClientProxy {
    return this.orderClient;
  }

  getNotificationClient(): ClientProxy {
    return this.notificationClient;
  }
}
