import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getConnection } from 'typeorm';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_HOST = 'localhost';
process.env.DATABASE_PORT = '5432';
process.env.DATABASE_NAME = 'inventory_test_db';
process.env.DATABASE_USER = 'postgres';
process.env.DATABASE_PASSWORD = 'postgres';
process.env.RABBITMQ_URL = 'amqp://localhost:5672';
process.env.RETRY_MAX_ATTEMPTS = '3';
process.env.RETRY_INITIAL_DELAY = '1000';
process.env.RETRY_MAX_DELAY = '30000';
process.env.RETRY_BACKOFF_MULTIPLIER = '2';
process.env.RETRY_JITTER_ENABLED = 'true';

// Global test utilities
global.createTestModule = async (providers: any[] = [], imports: any[] = []) => {
  const moduleBuilder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: '.env.test',
      }),
      ...imports,
    ],
    providers,
  });

  return moduleBuilder.compile();
};

// Mock RabbitMQ ClientProxy
global.mockClientProxy = {
  emit: jest.fn().mockReturnValue({
    toPromise: jest.fn().mockResolvedValue(undefined),
  }),
  send: jest.fn().mockReturnValue({
    toPromise: jest.fn().mockResolvedValue(undefined),
  }),
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

// Mock SequenceService
global.mockSequenceService = {
  getNextSequenceNumber: jest.fn().mockImplementation((entityId: string, entityType: string) => {
    return Promise.resolve(Math.floor(Math.random() * 1000) + 1);
  }),
};

// Mock EventBufferService
global.mockEventBufferService = {
  addEvent: jest.fn().mockResolvedValue(undefined),
  getBufferStatus: jest.fn().mockReturnValue(undefined),
  getAllBuffers: jest.fn().mockReturnValue(new Map()),
  clearBuffer: jest.fn().mockReturnValue(undefined),
  getBufferStats: jest.fn().mockReturnValue({ totalBuffers: 0, totalPendingEvents: 0 }),
};

// Mock RetryService
global.mockRetryService = {
  executeWithRetry: jest.fn().mockImplementation(async (operation: () => Promise<any>) => {
    return operation();
  }),
};

// Mock EventPublisher
global.mockEventPublisher = {
  publishLowStockAlert: jest.fn().mockResolvedValue(undefined),
  publishBackInStockAlert: jest.fn().mockResolvedValue(undefined),
  publishInventoryReserved: jest.fn().mockResolvedValue(undefined),
  publishInventoryReservationFailed: jest.fn().mockResolvedValue(undefined),
};

// Test database cleanup utility
global.cleanupDatabase = async () => {
  try {
    const connection = getConnection();
    if (connection.isConnected) {
      await connection.synchronize(true); // Drop and recreate schema
    }
  } catch (error) {
    // Connection might not exist, ignore
  }
};

// Jest setup
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  // Clean up any test data if needed
});
