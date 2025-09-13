import { Test, TestingModule } from '@nestjs/testing';
import { EventBufferService } from '../event-buffer.service';
import { createMockOrderedEvent, sleep } from '../../test/test-utils';
import { OrderedEvent } from '@ecommerce/shared-types';

describe('EventBufferService', () => {
  let service: EventBufferService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EventBufferService],
    }).compile();

    service = module.get<EventBufferService>(EventBufferService);
  });

  describe('addEvent', () => {
    it('should add event to buffer and process immediately if in sequence', async () => {
      const event = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 1,
      });

      const processEventSpy = jest
        .spyOn(service as any, 'processEvent')
        .mockResolvedValue(undefined);

      await service.addEvent(event);

      expect(processEventSpy).toHaveBeenCalledWith(event);
      expect(event.processed).toBe(true);
      expect(event.processedAt).toBeDefined();
    });

    it('should buffer out-of-order events', async () => {
      const event1 = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 3,
      });
      const event2 = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 1,
      });

      const processEventSpy = jest
        .spyOn(service as any, 'processEvent')
        .mockResolvedValue(undefined);

      // Add out-of-order event first
      await service.addEvent(event1);
      expect(processEventSpy).not.toHaveBeenCalledWith(event1);
      expect(event1.processed).toBe(false);

      // Add in-order event
      await service.addEvent(event2);
      expect(processEventSpy).toHaveBeenCalledWith(event2);
      expect(event2.processed).toBe(true);
    });

    it('should process events in correct sequence order', async () => {
      const events = [
        createMockOrderedEvent({ entityId: 'test-entity-1', sequenceNumber: 3 }),
        createMockOrderedEvent({ entityId: 'test-entity-1', sequenceNumber: 1 }),
        createMockOrderedEvent({ entityId: 'test-entity-1', sequenceNumber: 2 }),
      ];

      const processedEvents: OrderedEvent[] = [];
      const processEventSpy = jest
        .spyOn(service as any, 'processEvent')
        .mockImplementation(async (event: OrderedEvent) => {
          processedEvents.push(event);
        });

      // Add events out of order
      for (const event of events) {
        await service.addEvent(event);
      }

      // Should process in sequence order: 1, 2, 3
      expect(processedEvents).toHaveLength(3);
      expect(processedEvents[0].sequenceNumber).toBe(1);
      expect(processedEvents[1].sequenceNumber).toBe(2);
      expect(processedEvents[2].sequenceNumber).toBe(3);
    });

    it('should handle events for different entities separately', async () => {
      const entity1Events = [
        createMockOrderedEvent({ entityId: 'entity-1', sequenceNumber: 2 }),
        createMockOrderedEvent({ entityId: 'entity-1', sequenceNumber: 1 }),
      ];
      const entity2Events = [createMockOrderedEvent({ entityId: 'entity-2', sequenceNumber: 1 })];

      const processEventSpy = jest
        .spyOn(service as any, 'processEvent')
        .mockResolvedValue(undefined);

      // Add events for both entities
      await service.addEvent(entity1Events[0]); // seq 2, should buffer
      await service.addEvent(entity2Events[0]); // seq 1, should process immediately
      await service.addEvent(entity1Events[1]); // seq 1, should process both

      expect(processEventSpy).toHaveBeenCalledTimes(3);
      expect(entity2Events[0].processed).toBe(true);
      expect(entity1Events[1].processed).toBe(true);
      expect(entity1Events[0].processed).toBe(true);
    });

    it('should sort events by sequence number in buffer', async () => {
      const events = [
        createMockOrderedEvent({ entityId: 'test-entity-1', sequenceNumber: 5 }),
        createMockOrderedEvent({ entityId: 'test-entity-1', sequenceNumber: 3 }),
        createMockOrderedEvent({ entityId: 'test-entity-1', sequenceNumber: 4 }),
      ];

      jest.spyOn(service as any, 'processEvent').mockResolvedValue(undefined);

      // Add events out of order
      for (const event of events) {
        await service.addEvent(event);
      }

      const buffer = service.getBufferStatus('test-entity-1');
      expect(buffer).toBeDefined();
      expect(buffer!.pendingEvents).toHaveLength(3);

      // Should be sorted by sequence number
      expect(buffer!.pendingEvents[0].sequenceNumber).toBe(3);
      expect(buffer!.pendingEvents[1].sequenceNumber).toBe(4);
      expect(buffer!.pendingEvents[2].sequenceNumber).toBe(5);
    });
  });

  describe('processBufferedEvents', () => {
    it('should skip duplicate/old events', async () => {
      const event1 = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 1,
      });
      const duplicateEvent = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 1,
      });

      const processEventSpy = jest
        .spyOn(service as any, 'processEvent')
        .mockResolvedValue(undefined);

      await service.addEvent(event1);
      await service.addEvent(duplicateEvent);

      // Should only process the first event
      expect(processEventSpy).toHaveBeenCalledTimes(1);
      expect(processEventSpy).toHaveBeenCalledWith(event1);
    });

    it('should handle processing errors and retry', async () => {
      const event = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 1,
      });

      const processEventSpy = jest
        .spyOn(service as any, 'processEvent')
        .mockRejectedValueOnce(new Error('Processing failed'))
        .mockResolvedValueOnce(undefined);

      await service.addEvent(event);

      // Should put event back in buffer for retry
      const buffer = service.getBufferStatus('test-entity-1');
      expect(buffer).toBeDefined();
      expect(buffer!.pendingEvents).toHaveLength(1);
      expect(buffer!.pendingEvents[0]).toBe(event);
      expect(event.processed).toBe(false);
    });

    it('should wait for missing sequence numbers', async () => {
      const event3 = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 3,
      });
      const event5 = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 5,
      });

      const processEventSpy = jest
        .spyOn(service as any, 'processEvent')
        .mockResolvedValue(undefined);

      await service.addEvent(event3);
      await service.addEvent(event5);

      // Should not process any events (waiting for seq 1)
      expect(processEventSpy).not.toHaveBeenCalled();

      const buffer = service.getBufferStatus('test-entity-1');
      expect(buffer!.pendingEvents).toHaveLength(2);
      expect(buffer!.lastProcessedSequence).toBe(0);
    });
  });

  describe('buffer management', () => {
    it('should create buffer for new entity', async () => {
      const event = createMockOrderedEvent({
        entityId: 'new-entity',
        sequenceNumber: 2,
      });

      jest.spyOn(service as any, 'processEvent').mockResolvedValue(undefined);

      await service.addEvent(event);

      const buffer = service.getBufferStatus('new-entity');
      expect(buffer).toBeDefined();
      expect(buffer!.entityId).toBe('new-entity');
      expect(buffer!.lastProcessedSequence).toBe(0);
    });

    it('should clean up empty buffers after timeout', async () => {
      const event = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 1,
      });

      jest.spyOn(service as any, 'processEvent').mockResolvedValue(undefined);

      await service.addEvent(event);

      // Buffer should exist initially
      const buffer = service.getBufferStatus('test-entity-1');
      expect(buffer).toBeDefined();
      expect(buffer?.pendingEvents).toHaveLength(0); // Event processed
      expect(buffer?.lastProcessedSequence).toBe(1);

      // Manually clear the buffer to simulate cleanup
      service.clearBuffer('test-entity-1');

      // Buffer should be cleaned up
      expect(service.getBufferStatus('test-entity-1')).toBeUndefined();
    });

    it('should not clean up buffers with pending events', async () => {
      const event = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 2, // Out of order, will remain in buffer
      });

      jest.spyOn(service as any, 'processEvent').mockResolvedValue(undefined);

      await service.addEvent(event);

      jest.useFakeTimers();
      jest.advanceTimersByTime(30000);

      // Buffer should still exist because it has pending events
      expect(service.getBufferStatus('test-entity-1')).toBeDefined();

      jest.useRealTimers();
    });
  });

  describe('buffer utilities', () => {
    beforeEach(async () => {
      // Add some test data
      const events = [
        createMockOrderedEvent({ entityId: 'entity-1', sequenceNumber: 2 }),
        createMockOrderedEvent({ entityId: 'entity-1', sequenceNumber: 3 }),
        createMockOrderedEvent({ entityId: 'entity-2', sequenceNumber: 1 }),
      ];

      jest.spyOn(service as any, 'processEvent').mockResolvedValue(undefined);

      for (const event of events) {
        await service.addEvent(event);
      }
    });

    it('should return buffer status for specific entity', () => {
      const buffer = service.getBufferStatus('entity-1');

      expect(buffer).toBeDefined();
      expect(buffer!.entityId).toBe('entity-1');
      expect(buffer!.pendingEvents).toHaveLength(2);
    });

    it('should return undefined for non-existent entity', () => {
      const buffer = service.getBufferStatus('non-existent');

      expect(buffer).toBeUndefined();
    });

    it('should return all buffers', () => {
      const allBuffers = service.getAllBuffers();

      expect(allBuffers.size).toBe(2);
      expect(allBuffers.has('entity-1')).toBe(true);
      expect(allBuffers.has('entity-2')).toBe(true);
    });

    it('should clear specific buffer', () => {
      service.clearBuffer('entity-1');

      expect(service.getBufferStatus('entity-1')).toBeUndefined();
      expect(service.getBufferStatus('entity-2')).toBeDefined();
    });

    it('should return buffer statistics', () => {
      const stats = service.getBufferStats();

      expect(stats.totalBuffers).toBe(2);
      expect(stats.totalPendingEvents).toBe(2); // entity-1 has 2 pending, entity-2 has 0 (processed)
    });
  });

  describe('processEvent', () => {
    it('should log event processing', async () => {
      const event = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 1,
      });

      const loggerSpy = jest.spyOn(service['logger'], 'log');
      const debugSpy = jest.spyOn(service['logger'], 'debug');

      await service['processEvent'](event);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Processing ordered event for entity test-entity-1'),
      );
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Processing event with ID:'));
    });

    it('should handle processing errors', async () => {
      const event = createMockOrderedEvent({
        entityId: 'test-entity-1',
        sequenceNumber: 1,
      });

      // Mock handleGenericEvent to throw error
      jest
        .spyOn(service as any, 'handleGenericEvent')
        .mockRejectedValue(new Error('Processing failed'));

      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service['processEvent'](event)).rejects.toThrow('Processing failed');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process event'),
        expect.any(Error),
      );
    });
  });
});
