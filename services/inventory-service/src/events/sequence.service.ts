import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';
import { EventSequence } from '@ecommerce/shared-types';

// TypeORM Entity for EventSequence
@Entity('event_sequences')
export class EventSequenceEntity implements EventSequence {
  @PrimaryColumn()
  entityId: string;

  @PrimaryColumn()
  entityType: string;

  @Column({ type: 'integer', default: 0 })
  lastSequenceNumber: number;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Injectable()
export class SequenceService {
  constructor(
    @InjectRepository(EventSequenceEntity)
    private readonly sequenceRepo: Repository<EventSequenceEntity>,
  ) {}

  async getNextSequenceNumber(entityId: string, entityType: string): Promise<number> {
    // Use database transaction for atomic increment
    return await this.sequenceRepo.manager.transaction(async manager => {
      let sequence = await manager.findOne(EventSequenceEntity, {
        where: { entityId, entityType },
        lock: { mode: 'pessimistic_write' }, // Prevent race conditions
      });

      if (!sequence) {
        // Create new sequence starting from 1
        sequence = manager.create(EventSequenceEntity, {
          entityId,
          entityType,
          lastSequenceNumber: 1,
          updatedAt: new Date(),
        });
        await manager.save(sequence);
        return 1;
      }

      // Increment sequence number
      sequence.lastSequenceNumber += 1;
      sequence.updatedAt = new Date();
      await manager.save(sequence);

      return sequence.lastSequenceNumber;
    });
  }

  async getCurrentSequence(entityId: string, entityType: string): Promise<number> {
    const sequence = await this.sequenceRepo.findOne({
      where: { entityId, entityType },
    });

    return sequence?.lastSequenceNumber || 0;
  }

  async resetSequence(entityId: string, entityType: string): Promise<void> {
    await this.sequenceRepo.delete({ entityId, entityType });
  }
}
