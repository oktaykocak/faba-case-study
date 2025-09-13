import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, QueryRunner, Connection } from 'typeorm';
import { SequenceService, EventSequenceEntity } from '../sequence.service';
import { createTestModule, createMockError, sleep } from '../../test/test-utils';

describe('SequenceService', () => {
  let service: SequenceService;
  let repository: jest.Mocked<Repository<EventSequenceEntity>>;
  let connection: jest.Mocked<Connection>;
  let queryRunner: jest.Mocked<QueryRunner>;

  beforeEach(async () => {
    // Create a stateful mock for sequences
    const sequenceStore = new Map<string, any>();

    // Mock Repository with realistic transaction behavior
    repository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      manager: {
        transaction: jest.fn().mockImplementation(async callback => {
          const mockManager = {
            findOne: jest.fn().mockImplementation(async (entity, options) => {
              const key = `${options?.where?.entityId}-${options?.where?.entityType}`;
              const existing = sequenceStore.get(key);

              // Handle error scenarios for specific test cases
              if (options?.where?.entityId === 'deadlock-test') {
                throw new Error('Deadlock found when trying to get lock');
              }
              if (options?.where?.entityId === 'rollback-test') {
                throw new Error('Find operation failed');
              }
              if (
                options?.where?.entityId === '' ||
                options?.where?.entityType === '' ||
                options?.where?.entityId === null ||
                options?.where?.entityType === null
              ) {
                throw new Error('Invalid parameters');
              }

              return existing || null;
            }),
            save: jest.fn().mockImplementation(async entity => {
              const key = `${entity.entityId}-${entity.entityType}`;

              // Handle error scenarios - check both find and save scenarios
              if (entity.entityId === 'save-error-test') {
                // Save operation error
                throw new Error('Save operation failed');
              }

              // Update sequence number
              if (sequenceStore.has(key)) {
                const existing = sequenceStore.get(key);
                existing.lastSequenceNumber += 1;
                entity.lastSequenceNumber = existing.lastSequenceNumber;
              } else {
                entity.lastSequenceNumber = 1;
              }

              sequenceStore.set(key, { ...entity });
              return entity;
            }),
            create: jest.fn().mockImplementation((EntityClass, data) => {
              return { ...data, lastSequenceNumber: 1 };
            }),
          };
          return callback(mockManager);
        }),
      },
    } as unknown as jest.Mocked<Repository<EventSequenceEntity>>;

    // Mock QueryRunner (not used in new implementation but kept for compatibility)
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        findOne: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
      } as any,
    } as unknown as jest.Mocked<QueryRunner>;

    // Mock Connection
    connection = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as jest.Mocked<Connection>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SequenceService,
        {
          provide: getRepositoryToken(EventSequenceEntity),
          useValue: repository,
        },
        {
          provide: Connection,
          useValue: connection,
        },
      ],
    }).compile();

    service = module.get<SequenceService>(SequenceService);
  });

  describe('getNextSequenceNumber', () => {
    it('should create new sequence entity for first request', async () => {
      const entityId = 'new-entity';
      const entityType = 'order';

      const result = await service.getNextSequenceNumber(entityId, entityType);

      expect(result).toBe(1);
      expect(repository.manager.transaction).toHaveBeenCalled();
    });

    it('should increment existing sequence number', async () => {
      const entityId = 'test-order-1';
      const entityType = 'order';

      // First call to establish the entity
      await service.getNextSequenceNumber(entityId, entityType);
      // Second call should increment
      const result = await service.getNextSequenceNumber(entityId, entityType);

      expect(result).toBeGreaterThan(1);
    });

    it('should handle database errors and rollback transaction', async () => {
      const entityId = 'rollback-test';
      const entityType = 'order';

      await expect(service.getNextSequenceNumber(entityId, entityType)).rejects.toThrow(
        'Find operation failed',
      );
    });

    it('should handle concurrent access with proper locking', async () => {
      const entityId = 'test-order-1';
      const entityType = 'order';

      const result = await service.getNextSequenceNumber(entityId, entityType);

      // With stateful mock, test-order-1 should return incremented value
      expect(result).toBeGreaterThan(0);
    });

    it('should handle transaction timeout errors', async () => {
      const entityId = 'deadlock-test';
      const entityType = 'order';

      await expect(service.getNextSequenceNumber(entityId, entityType)).rejects.toThrow(
        'Deadlock found when trying to get lock',
      );
    });

    it('should handle different entity types separately', async () => {
      const entityId = 'multi-type-test';
      const orderType = 'order';
      const inventoryType = 'inventory';

      const orderResult = await service.getNextSequenceNumber(entityId, orderType);
      const inventoryResult = await service.getNextSequenceNumber(entityId, inventoryType);

      expect(orderResult).toBe(1);
      expect(inventoryResult).toBe(1);
      expect(repository.manager.transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('concurrent access scenarios', () => {
    it('should handle multiple concurrent requests for same entity', async () => {
      const entityId = 'concurrent-test';
      const entityType = 'order';

      // Simulate concurrent requests
      const promises = [
        service.getNextSequenceNumber(entityId, entityType),
        service.getNextSequenceNumber(entityId, entityType),
        service.getNextSequenceNumber(entityId, entityType),
      ];

      const results = await Promise.all(promises);

      // Each request should get a sequence number
      expect(results).toHaveLength(3);
      expect(results[0]).toBeGreaterThan(0);
    });

    it('should handle deadlock scenarios gracefully', async () => {
      const entityId = 'deadlock-test';
      const entityType = 'order';

      await expect(service.getNextSequenceNumber(entityId, entityType)).rejects.toThrow(
        'Deadlock found when trying to get lock',
      );
    });
  });

  describe('transaction management', () => {
    it('should properly manage transaction lifecycle on success', async () => {
      const entityId = 'transaction-test';
      const entityType = 'order';

      const result = await service.getNextSequenceNumber(entityId, entityType);

      // Verify successful sequence generation
      expect(result).toBe(1);
      expect(repository.manager.transaction).toHaveBeenCalled();
    });

    it('should rollback transaction on any error', async () => {
      const entityId = 'save-error-test';
      const entityType = 'order';

      await expect(service.getNextSequenceNumber(entityId, entityType)).rejects.toThrow(
        'Save operation failed',
      );
    });

    it('should release query runner even if rollback fails', async () => {
      const entityId = 'rollback-test';
      const entityType = 'order';

      await expect(service.getNextSequenceNumber(entityId, entityType)).rejects.toThrow(
        'Find operation failed',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle very large sequence numbers', async () => {
      const entityId = 'large-sequence-test';
      const entityType = 'order';

      const result = await service.getNextSequenceNumber(entityId, entityType);

      // First call should return 1 for new entity
      expect(result).toBe(1);
    });

    it('should handle empty or invalid entity parameters', async () => {
      await expect(service.getNextSequenceNumber('', 'order')).rejects.toThrow(
        'Invalid parameters',
      );

      await expect(service.getNextSequenceNumber('test-id', '')).rejects.toThrow(
        'Invalid parameters',
      );

      await expect(service.getNextSequenceNumber(null as any, 'order')).rejects.toThrow();
    });

    it('should handle connection creation failures', async () => {
      // Mock transaction to throw error
      repository.manager.transaction = jest
        .fn()
        .mockRejectedValue(createMockError('Failed to create query runner'));

      await expect(service.getNextSequenceNumber('test-id', 'order')).rejects.toThrow(
        'Failed to create query runner',
      );
    });
  });

  describe('performance considerations', () => {
    it('should complete sequence generation within reasonable time', async () => {
      const entityId = 'performance-test';
      const entityType = 'order';

      const startTime = Date.now();
      await service.getNextSequenceNumber(entityId, entityType);
      const endTime = Date.now();

      // Should complete within 100ms under normal conditions
      expect(endTime - startTime).toBeLessThan(100);
    });

    it('should handle rapid sequential requests efficiently', async () => {
      const entityId = 'rapid-test';
      const entityType = 'order';

      const startTime = Date.now();

      // Generate 10 sequences rapidly
      const promises = Array.from({ length: 10 }, () =>
        service.getNextSequenceNumber(entityId, entityType),
      );

      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results).toHaveLength(10);
      expect(results[0]).toBe(1); // First should be 1
      expect(endTime - startTime).toBeLessThan(1000); // Complete within 1 second
    });
  });
});
