import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItem } from '../inventory/entities/inventory-item.entity';
import { InventoryHistory } from '../inventory/entities/inventory-history.entity';
import { EventSequenceEntity } from '../events/sequence.service';
import { InventoryStatus } from '../inventory/enums/inventory-status.enum';
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
        database: 'inventory_test_db',
        entities: [InventoryItem, InventoryHistory, EventSequenceEntity],
        synchronize: true,
        dropSchema: false,
        logging: false,
      }),
      TypeOrmModule.forFeature([InventoryItem, InventoryHistory, EventSequenceEntity]),
      ...imports,
    ],
    providers,
    controllers,
  });

  return moduleBuilder.compile();
}

/**
 * Create mock inventory item data for testing
 */
export function createMockInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    productId: 'test-product-' + Math.random().toString(36).substr(2, 9),
    productName: 'Test Product',
    description: 'Test product description',
    quantity: 100,
    reservedQuantity: 0,
    availableQuantity: 100,
    price: 29.99,
    status: InventoryStatus.ACTIVE,
    createdAt: new Date(),
    lastUpdated: new Date(),
    ...overrides,
  } as InventoryItem;
}

/**
 * Create mock inventory history data for testing
 */
export function createMockInventoryHistory(
  overrides: Partial<InventoryHistory> = {},
): InventoryHistory {
  return {
    id: 'test-history-' + Math.random().toString(36).substr(2, 9),
    productId: 'test-product-1',
    action: 'UPDATED' as any,
    previousQuantity: 50,
    newQuantity: 100,
    previousPrice: 19.99,
    newPrice: 29.99,
    notes: 'Test inventory update',
    adminId: 'test-admin-1',
    createdAt: new Date(),
    ...overrides,
  } as InventoryHistory;
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
 * Create mock inventory validation request
 */
export function createMockInventoryValidationRequest(overrides: any = {}) {
  return {
    items: [
      {
        productId: 'test-product-1',
        quantity: 2,
      },
    ],
    correlationId: 'test-correlation-' + Math.random().toString(36).substr(2, 9),
    ...overrides,
  };
}

/**
 * Create mock inventory reservation request
 */
export function createMockInventoryReservationRequest(overrides: any = {}) {
  return {
    items: [
      {
        productId: 'test-product-1',
        quantity: 5,
      },
    ],
    orderId: 'test-order-' + Math.random().toString(36).substr(2, 9),
    correlationId: 'test-correlation-' + Math.random().toString(36).substr(2, 9),
    ...overrides,
  };
}

/**
 * Test data cleanup utility
 */
export async function cleanupTestData(repository: any, entityIds: string[] = []) {
  if (entityIds.length > 0) {
    await repository.delete(entityIds);
  } else {
    await repository.clear();
  }
}
