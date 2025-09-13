import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../order/entities/order.entity';
import { OrderHistory } from '../order/entities/order-history.entity';
import { EventSequenceEntity } from '../events/sequence.service';
import { OrderedEvent } from '@ecommerce/shared-types';

/**
 * Create a test module with common dependencies
 */
export async function createTestModule(options: {
  providers?: any[];
  imports?: any[];
  controllers?: any[];
}): Promise<TestingModule> {
  const { providers = [], imports = [], controllers = [] } = options;

  const moduleBuilder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: '.env.test',
      }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'postgres',
        database: 'order_test_db',
        entities: [Order, OrderHistory, EventSequenceEntity],
        synchronize: true,
        dropSchema: false,
        logging: false,
      }),
      TypeOrmModule.forFeature([Order, OrderHistory, EventSequenceEntity]),
      ...imports,
    ],
    providers: [
      ...providers,
      {
        provide: 'INVENTORY_CLIENT',
        useValue: {
          emit: jest.fn().mockReturnValue({ toPromise: jest.fn().mockResolvedValue(undefined) }),
          connect: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: 'NOTIFICATION_CLIENT',
        useValue: {
          emit: jest.fn().mockReturnValue({ toPromise: jest.fn().mockResolvedValue(undefined) }),
          connect: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined),
        },
      },
    ],
    controllers,
  });

  return moduleBuilder.compile();
}

/**
 * Create mock order data for testing
 */
export function createMockOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'test-order-' + Math.random().toString(36).substr(2, 9),
    customerId: 'test-customer-1',
    items: [
      {
        productId: 'test-product-1',
        quantity: 2,
        price: 29.99,
      },
    ],
    totalAmount: 59.98,
    status: 'PENDING' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Order;
}

/**
 * Create mock ordered event for testing
 */
export function createMockOrderedEvent(overrides: Partial<OrderedEvent> = {}): OrderedEvent {
  return {
    id: 'test-event-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date(),
    version: '1.0',
    sequenceNumber: Math.floor(Math.random() * 100) + 1,
    entityId: 'test-entity-1',
    correlationId: 'test-correlation-' + Math.random().toString(36).substr(2, 9),
    processed: false,
    ...overrides,
  };
}

/**
 * Wait for a specified amount of time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a mock function that can be used to spy on method calls
 */
export function createMockFunction<T extends (...args: any[]) => any>(
  implementation?: T,
): jest.MockedFunction<T> {
  return jest.fn(implementation) as unknown as jest.MockedFunction<T>;
}

/**
 * Assert that a function was called with specific arguments
 */
export function expectCalledWith<T extends (...args: any[]) => any>(
  mockFn: jest.MockedFunction<T>,
  ...expectedArgs: Parameters<T>
) {
  expect(mockFn).toHaveBeenCalledWith(...expectedArgs);
}

/**
 * Assert that a function was called a specific number of times
 */
export function expectCalledTimes<T extends (...args: any[]) => any>(
  mockFn: jest.MockedFunction<T>,
  times: number,
) {
  expect(mockFn).toHaveBeenCalledTimes(times);
}

/**
 * Create a mock error for testing error scenarios
 */
export function createMockError(message: string = 'Test error', code?: string): Error {
  const error = new Error(message);
  if (code) {
    (error as any).code = code;
  }
  return error;
}

/**
 * Mock RabbitMQ connection errors
 */
export function createRabbitMQError(
  type: 'connection' | 'channel' | 'timeout' = 'connection',
): Error {
  const errorMessages = {
    connection: 'ECONNREFUSED: Connection refused',
    channel: 'Channel closed',
    timeout: 'ETIMEDOUT: Connection timeout',
  };

  return createMockError(errorMessages[type]);
}

/**
 * Mock database connection errors
 */
export function createDatabaseError(
  type: 'connection' | 'timeout' | 'constraint' = 'connection',
): Error {
  const errorMessages = {
    connection: 'Connection terminated',
    timeout: 'Connection timeout',
    constraint: 'Unique constraint violation',
  };

  return createMockError(errorMessages[type]);
}

/**
 * Test data cleanup utility
 */
export async function cleanupTestData(repository: any, entityIds: string[] = []) {
  try {
    if (entityIds.length > 0) {
      await repository.delete(entityIds);
    } else {
      // Use DELETE instead of TRUNCATE to avoid foreign key constraint issues
      await repository.delete({});
    }
  } catch (error) {
    // If delete fails, try clearing with query builder
    await repository.createQueryBuilder().delete().execute();
  }
}
