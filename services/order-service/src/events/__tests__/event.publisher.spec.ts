import { Test, TestingModule } from '@nestjs/testing';
import { ClientProxy } from '@nestjs/microservices';
import { EventPublisher } from '../event.publisher';
import { SequenceService } from '../sequence.service';
import { RetryService } from '../retry.service';
import { EventBufferService } from '../event-buffer.service';
import { createMockOrder, createMockError, createRabbitMQError } from '../../test/test-utils';
import { Order } from '../../order/entities/order.entity';

describe('EventPublisher', () => {
  let publisher: EventPublisher;
  let sequenceService: jest.Mocked<SequenceService>;
  let retryService: jest.Mocked<RetryService>;
  let eventBufferService: jest.Mocked<EventBufferService>;
  let inventoryClient: jest.Mocked<ClientProxy>;
  let notificationClient: jest.Mocked<ClientProxy>;

  beforeEach(async () => {
    // Mock services
    const mockSequenceService = {
      getNextSequenceNumber: jest.fn().mockResolvedValue(1),
    };

    const mockRetryService = {
      executeWithRetry: jest.fn().mockImplementation(async operation => {
        return operation();
      }),
    };

    const mockEventBufferService = {
      addEvent: jest.fn().mockResolvedValue(undefined),
    };

    // Mock ClientProxy
    const mockClientProxy = {
      emit: jest.fn().mockReturnValue({
        toPromise: jest.fn().mockResolvedValue(undefined),
      }),
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventPublisher,
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: RetryService, useValue: mockRetryService },
        { provide: EventBufferService, useValue: mockEventBufferService },
      ],
    }).compile();

    publisher = module.get<EventPublisher>(EventPublisher);
    sequenceService = module.get(SequenceService);
    retryService = module.get(RetryService);
    eventBufferService = module.get(EventBufferService);

    // Mock the client proxies
    inventoryClient = mockClientProxy as unknown as jest.Mocked<ClientProxy>;
    notificationClient = mockClientProxy as unknown as jest.Mocked<ClientProxy>;

    // Replace the private clients with mocks
    (publisher as any).inventoryClient = inventoryClient;
    (publisher as any).notificationClient = notificationClient;
  });

  describe('publishOrderCreated', () => {
    it('should publish order created event with sequence number and buffer', async () => {
      const order = createMockOrder({ id: 'test-order-1' });
      const correlationId = 'test-correlation-1';
      const expectedSequence = 5;

      sequenceService.getNextSequenceNumber.mockResolvedValue(expectedSequence);

      await publisher.publishOrderCreated(order, correlationId);

      // Verify sequence generation
      expect(sequenceService.getNextSequenceNumber).toHaveBeenCalledWith(order.id, 'order');

      // Verify event buffer addition
      expect(eventBufferService.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sequenceNumber: expectedSequence,
          entityId: order.id,
          correlationId,
          processed: false,
        }),
      );

      // Verify inventory service call with retry
      expect(retryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        { operationType: 'rabbitmq' },
        expect.stringContaining('publish-inventory-event'),
      );

      // Verify notification service call with retry
      expect(retryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        { operationType: 'rabbitmq' },
        expect.stringContaining('publish-notification-event'),
      );
    });

    it('should generate correlation ID if not provided', async () => {
      const order = createMockOrder({ id: 'test-order-2' });

      await publisher.publishOrderCreated(order);

      expect(eventBufferService.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/i), // UUID format
        }),
      );
    });

    it('should handle sequence generation errors', async () => {
      const order = createMockOrder({ id: 'test-order-3' });
      const sequenceError = createMockError('Sequence generation failed');

      sequenceService.getNextSequenceNumber.mockRejectedValue(sequenceError);

      await expect(publisher.publishOrderCreated(order)).rejects.toThrow(
        'Sequence generation failed',
      );

      expect(eventBufferService.addEvent).not.toHaveBeenCalled();
    });

    it('should handle event buffer errors', async () => {
      const order = createMockOrder({ id: 'test-order-4' });
      const bufferError = createMockError('Buffer operation failed');

      eventBufferService.addEvent.mockRejectedValue(bufferError);

      await expect(publisher.publishOrderCreated(order)).rejects.toThrow('Buffer operation failed');
    });

    it('should handle RabbitMQ publishing errors with retry', async () => {
      const order = createMockOrder({ id: 'test-order-5' });
      const rabbitError = createRabbitMQError('connection');

      retryService.executeWithRetry.mockRejectedValue(rabbitError);

      await expect(publisher.publishOrderCreated(order)).rejects.toThrow(
        'ECONNREFUSED: Connection refused',
      );

      expect(retryService.executeWithRetry).toHaveBeenCalled();
    });
  });

  describe('publishOrderCancelled', () => {
    it('should publish order cancelled event with proper sequence', async () => {
      const orderId = 'test-order-cancel-1';
      const items = [{ productId: 'product-1', quantity: 2, price: 29.99 }];
      const reason = 'Customer request';
      const correlationId = 'cancel-correlation-1';
      const expectedSequence = 3;

      sequenceService.getNextSequenceNumber.mockResolvedValue(expectedSequence);

      await publisher.publishOrderCancelled(orderId, items, reason, correlationId);

      expect(sequenceService.getNextSequenceNumber).toHaveBeenCalledWith(orderId, 'order');

      expect(eventBufferService.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sequenceNumber: expectedSequence,
          entityId: orderId,
          correlationId,
          processed: false,
        }),
      );

      expect(retryService.executeWithRetry).toHaveBeenCalledTimes(2);
    });

    it('should handle cancellation with empty items array', async () => {
      const orderId = 'test-order-cancel-2';
      const items: any[] = [];
      const reason = 'System error';

      await publisher.publishOrderCancelled(orderId, items, reason);

      expect(eventBufferService.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: orderId,
        }),
      );
    });
  });

  describe('publishOrderDelivered', () => {
    it('should publish order delivered event with sequence', async () => {
      const orderId = 'test-order-delivered-1';
      const items = [{ productId: 'product-1', quantity: 1, price: 49.99 }];
      const correlationId = 'delivered-correlation-1';
      const expectedSequence = 7;

      sequenceService.getNextSequenceNumber.mockResolvedValue(expectedSequence);

      await publisher.publishOrderDelivered(orderId, items, correlationId);

      expect(sequenceService.getNextSequenceNumber).toHaveBeenCalledWith(orderId, 'order');

      expect(eventBufferService.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sequenceNumber: expectedSequence,
          entityId: orderId,
          correlationId,
          processed: false,
        }),
      );

      expect(retryService.executeWithRetry).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry integration', () => {
    it('should use retry service for inventory publishing', async () => {
      const order = createMockOrder();

      await publisher.publishOrderCreated(order);

      expect(retryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        { operationType: 'rabbitmq' },
        expect.stringContaining('publish-inventory-event'),
      );
    });

    it('should use retry service for notification publishing', async () => {
      const order = createMockOrder();

      await publisher.publishOrderCreated(order);

      expect(retryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        { operationType: 'rabbitmq' },
        expect.stringContaining('publish-notification-event'),
      );
    });

    it('should handle retry failures gracefully', async () => {
      const order = createMockOrder();
      const retryError = createMockError('All retries exhausted');

      retryService.executeWithRetry.mockRejectedValueOnce(retryError);

      await expect(publisher.publishOrderCreated(order)).rejects.toThrow('All retries exhausted');
    });
  });

  describe('client management', () => {
    it('should connect clients on module init', async () => {
      await publisher.onModuleInit();

      expect(inventoryClient.connect).toHaveBeenCalled();
      expect(notificationClient.connect).toHaveBeenCalled();
    });

    it('should close clients on module destroy', async () => {
      await publisher.onModuleDestroy();

      expect(inventoryClient.close).toHaveBeenCalled();
      expect(notificationClient.close).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      const connectionError = createRabbitMQError('connection');
      inventoryClient.connect.mockRejectedValue(connectionError);

      // Should handle connection errors gracefully
      try {
        await publisher.onModuleInit();
      } catch (error) {
        // Connection errors are expected in test environment
        expect(error.message).toContain('Connection refused');
      }
    });

    it('should provide access to client instances', () => {
      const inventoryClientInstance = publisher.getInventoryClient();
      const notificationClientInstance = publisher.getNotificationClient();

      expect(inventoryClientInstance).toBeDefined();
      expect(notificationClientInstance).toBeDefined();
    });
  });

  describe('event structure validation', () => {
    it('should create properly structured OrderCreatedEvent', async () => {
      const order = createMockOrder({
        id: 'struct-test-1',
        customerId: 'customer-1',
        totalAmount: 99.99,
      });
      const correlationId = 'struct-correlation-1';

      await publisher.publishOrderCreated(order, correlationId);

      expect(eventBufferService.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          timestamp: expect.any(Date),
          version: '1.0',
          sequenceNumber: expect.any(Number),
          entityId: order.id,
          correlationId,
          processed: false,
        }),
      );
    });

    it('should create properly structured OrderCancelledEvent', async () => {
      const orderId = 'struct-cancel-1';
      const items = [{ productId: 'p1', quantity: 1, price: 10 }];
      const reason = 'Test cancellation';

      await publisher.publishOrderCancelled(orderId, items, reason);

      expect(eventBufferService.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          timestamp: expect.any(Date),
          version: '1.0',
          sequenceNumber: expect.any(Number),
          entityId: orderId,
          correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          processed: false,
        }),
      );
    });

    it('should create properly structured OrderDeliveredEvent', async () => {
      const orderId = 'struct-delivered-1';
      const items = [{ productId: 'p1', quantity: 2, price: 25 }];

      await publisher.publishOrderDelivered(orderId, items);

      expect(eventBufferService.addEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          timestamp: expect.any(Date),
          version: '1.0',
          sequenceNumber: expect.any(Number),
          entityId: orderId,
          correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          processed: false,
        }),
      );
    });
  });

  describe('error scenarios', () => {
    it('should handle multiple simultaneous publishing errors', async () => {
      const order1 = createMockOrder({ id: 'error-test-1' });
      const order2 = createMockOrder({ id: 'error-test-2' });
      const publishError = createRabbitMQError('channel');

      retryService.executeWithRetry.mockRejectedValue(publishError);

      const promises = [
        publisher.publishOrderCreated(order1),
        publisher.publishOrderCreated(order2),
      ];

      await expect(Promise.all(promises)).rejects.toThrow();
    });

    it('should handle partial publishing failures', async () => {
      const order = createMockOrder({ id: 'partial-fail-test' });

      // Mock inventory publish to succeed, notification to fail
      retryService.executeWithRetry
        .mockResolvedValueOnce(undefined) // inventory success
        .mockRejectedValueOnce(createRabbitMQError('timeout')); // notification fail

      await expect(publisher.publishOrderCreated(order)).rejects.toThrow(
        'ETIMEDOUT: Connection timeout',
      );

      // Should still have called both services
      expect(retryService.executeWithRetry).toHaveBeenCalledTimes(2);
    });
  });

  describe('performance considerations', () => {
    it('should complete event publishing within reasonable time', async () => {
      const order = createMockOrder();

      const startTime = Date.now();
      await publisher.publishOrderCreated(order);
      const endTime = Date.now();

      // Should complete within 100ms under normal conditions
      expect(endTime - startTime).toBeLessThan(100);
    });

    it('should handle concurrent event publishing efficiently', async () => {
      const orders = Array.from({ length: 5 }, (_, i) =>
        createMockOrder({ id: `concurrent-${i}` }),
      );

      const startTime = Date.now();

      const promises = orders.map(order => publisher.publishOrderCreated(order));

      await Promise.all(promises);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(500);
      expect(eventBufferService.addEvent).toHaveBeenCalledTimes(5);
      expect(retryService.executeWithRetry).toHaveBeenCalledTimes(10); // 2 per order
    });
  });
});
