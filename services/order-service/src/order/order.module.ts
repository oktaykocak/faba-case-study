import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { Order } from './entities/order.entity';
import { OrderHistory } from './entities/order-history.entity';
import { CustomerMiddleware } from './middleware/customer.middleware';
import { AdminMiddleware } from './middleware/admin.middleware';
import { InventoryValidationService } from './services/inventory-validation.service';
import { MockPaymentService } from './services/mock-payment.service';
import { EventPublisher } from '../events/event.publisher';
import { RetryService } from '../events/retry.service';
import { SequenceService, EventSequenceEntity } from '../events/sequence.service';
import { EventBufferService } from '../events/event-buffer.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Order, OrderHistory, EventSequenceEntity])],
  controllers: [OrderController],
  providers: [
    OrderService,
    CustomerMiddleware,
    AdminMiddleware,
    InventoryValidationService,
    MockPaymentService,
    EventPublisher,
    SequenceService,
    EventBufferService,
    RetryService,
  ],
  exports: [OrderService],
})
export class OrderModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomerMiddleware).forRoutes({ path: 'orders', method: RequestMethod.POST }); // Sadece create için customer middleware

    consumer
      .apply(AdminMiddleware)
      .forRoutes({ path: 'orders/*/status', method: RequestMethod.PATCH }); // Sadece status update için admin middleware
  }
}
