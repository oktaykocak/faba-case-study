import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RetryService } from '../retry.service';
import {
  createMockError,
  createRabbitMQError,
  createDatabaseError,
  sleep,
} from '../../test/test-utils';

describe('RetryService', () => {
  let service: RetryService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
        const config = {
          RETRY_MAX_ATTEMPTS: 3,
          RETRY_INITIAL_DELAY: 1000,
          RETRY_MAX_DELAY: 30000,
          RETRY_BACKOFF_MULTIPLIER: 2,
          RETRY_JITTER_ENABLED: true,
        };
        return config[key] || defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RetryService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<RetryService>(RetryService);
    configService = module.get(ConfigService);
  });

  describe('executeWithRetry', () => {
    it('should execute operation successfully on first attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');

      const result = await service.executeWithRetry(mockOperation, {}, 'test-operation');

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(createRabbitMQError('connection'))
        .mockRejectedValueOnce(createRabbitMQError('timeout'))
        .mockResolvedValue('success');

      const result = await service.executeWithRetry(mockOperation, {}, 'test-operation');

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries exceeded', async () => {
      const error = createRabbitMQError('connection');
      const mockOperation = jest.fn().mockRejectedValue(error);

      await expect(
        service.executeWithRetry(mockOperation, { maxRetries: 2 }, 'test-operation'),
      ).rejects.toThrow('Operation failed after 3 attempts');

      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const error = createMockError('Validation error');
      const mockOperation = jest.fn().mockRejectedValue(error);

      await expect(service.executeWithRetry(mockOperation, {}, 'test-operation')).rejects.toThrow(
        'Validation error',
      );

      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff with jitter', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(createRabbitMQError('connection'))
        .mockRejectedValueOnce(createRabbitMQError('connection'))
        .mockResolvedValue('success');

      const startTime = Date.now();
      await service.executeWithRetry(mockOperation, { baseDelay: 100 }, 'test-operation');
      const endTime = Date.now();

      // Should have some delay due to retries
      expect(endTime - startTime).toBeGreaterThan(100);
      expect(mockOperation).toHaveBeenCalledTimes(3);
    });

    it('should use operation-specific configuration', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(createDatabaseError('connection'))
        .mockResolvedValue('success');

      const result = await service.executeWithRetry(
        mockOperation,
        { operationType: 'database' },
        'test-operation',
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should respect custom retry options', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(createRabbitMQError('connection'))
        .mockResolvedValue('success');

      const result = await service.executeWithRetry(
        mockOperation,
        {
          maxRetries: 1,
          baseDelay: 50,
          backoffMultiplier: 1.5,
          jitterEnabled: false,
        },
        'test-operation',
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable network errors', () => {
      const networkErrors = [
        createMockError('ECONNREFUSED'),
        createMockError('ETIMEDOUT'),
        createMockError('ECONNRESET'),
        createMockError('ENOTFOUND'),
      ];

      networkErrors.forEach(error => {
        expect(
          service['isRetryableError'](error, service['defaultRetryOptions'].retryableErrors),
        ).toBe(true);
      });
    });

    it('should identify retryable RabbitMQ errors', () => {
      const rabbitMQErrors = [
        createMockError('Connection closed'),
        createMockError('Channel closed'),
        createMockError('Connection lost'),
        createMockError('PRECONDITION_FAILED'),
      ];

      rabbitMQErrors.forEach(error => {
        expect(
          service['isRetryableError'](error, service['defaultRetryOptions'].retryableErrors),
        ).toBe(true);
      });
    });

    it('should identify non-retryable errors', () => {
      const nonRetryableErrors = [
        createMockError('Validation error'),
        createMockError('Authentication failed'),
        createMockError('Permission denied'),
        createMockError('Bad request'),
      ];

      nonRetryableErrors.forEach(error => {
        expect(
          service['isRetryableError'](error, service['defaultRetryOptions'].retryableErrors),
        ).toBe(false);
      });
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      const config = {
        baseDelay: 1000,
        backoffMultiplier: 2,
        maxDelay: 10000,
        jitterEnabled: false,
      } as any;

      const delay1 = service['calculateDelay'](0, config);
      const delay2 = service['calculateDelay'](1, config);
      const delay3 = service['calculateDelay'](2, config);

      expect(delay1).toBe(1000); // 1000 * 2^0
      expect(delay2).toBe(2000); // 1000 * 2^1
      expect(delay3).toBe(4000); // 1000 * 2^2
    });

    it('should respect max delay limit', () => {
      const config = {
        baseDelay: 1000,
        backoffMultiplier: 2,
        maxDelay: 3000,
        jitterEnabled: false,
      } as any;

      const delay = service['calculateDelay'](5, config);

      expect(delay).toBe(3000); // Should be capped at maxDelay
    });

    it('should add jitter when enabled', () => {
      const config = {
        baseDelay: 1000,
        backoffMultiplier: 2,
        maxDelay: 10000,
        jitterEnabled: true,
      } as any;

      const delay1 = service['calculateDelay'](1, config);
      const delay2 = service['calculateDelay'](1, config);

      // With jitter, delays should be different
      expect(delay1).not.toBe(delay2);
      expect(delay1).toBeGreaterThan(2000); // Base delay
      expect(delay1).toBeLessThan(2200); // Base delay + 10% jitter
    });
  });

  describe('getRetryConfig', () => {
    it('should return database-specific configuration', () => {
      const config = service['getRetryConfigByType']('database');

      expect(config.maxRetries).toBe(5);
      expect(config.baseDelay).toBe(500);
      expect(config.maxDelay).toBe(10000);
      expect(config.backoffMultiplier).toBe(1.5);
    });

    it('should return rabbitmq-specific configuration', () => {
      const config = service['getRetryConfigByType']('rabbitmq');

      expect(config.maxRetries).toBe(3);
      expect(config.baseDelay).toBe(1000);
      expect(config.maxDelay).toBe(15000);
      expect(config.backoffMultiplier).toBe(2);
    });

    it('should return http-specific configuration', () => {
      const config = service['getRetryConfigByType']('http');

      expect(config.maxRetries).toBe(3);
      expect(config.baseDelay).toBe(2000);
      expect(config.maxDelay).toBe(20000);
      expect(config.backoffMultiplier).toBe(2);
    });

    it('should return empty config for unknown operation type', () => {
      const config = service['getRetryConfigByType']('unknown');

      expect(config).toEqual({});
    });
  });
});
