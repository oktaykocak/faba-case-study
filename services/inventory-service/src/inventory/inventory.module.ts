import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryItem } from './entities/inventory-item.entity';
import { InventoryHistory } from './entities/inventory-history.entity';
import { AdminMiddleware } from './middleware/admin.middleware';
import { EventPublisher } from '../events/event.publisher';
import { InventorySeederService } from './services/inventory-seeder.service';
import { EventBufferService } from '../events/event-buffer.service';
import { RetryService } from '../events/retry.service';

import { SequenceService, EventSequenceEntity } from '../events/sequence.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([InventoryItem, InventoryHistory, EventSequenceEntity]),
  ],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    AdminMiddleware,
    InventorySeederService,
    EventPublisher,
    SequenceService,
    EventBufferService,
    RetryService,
  ],
  exports: [InventoryService],
})
export class InventoryModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AdminMiddleware).forRoutes(InventoryController);
  }
}
