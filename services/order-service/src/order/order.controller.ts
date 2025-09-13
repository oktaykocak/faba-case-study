import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Logger,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { MessagePattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { Request } from 'express';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus } from '@ecommerce/shared-types';
import { UuidValidationPipe } from './pipes/uuid-validation.pipe';

@Controller('orders')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(private readonly orderService: OrderService) {}

  @Post()
  async create(@Body() createOrderDto: CreateOrderDto, @Req() req: Request) {
    this.logger.log('Creating new order');
    return this.orderService.create(createOrderDto, req.customerId);
  }

  @Get()
  async findAll() {
    return this.orderService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', new UuidValidationPipe('order')) id: string) {
    return this.orderService.findOneWithHistory(id);
  }

  @Get('customer/:customerId')
  async findByCustomerId(
    @Param('customerId', new UuidValidationPipe('customer')) customerId: string,
  ) {
    return this.orderService.findByCustomerId(customerId);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', new UuidValidationPipe('order')) id: string,
    @Body() body: { status: OrderStatus; reason?: string },
    @Req() req: Request,
  ) {
    const { status, reason } = body;

    // CANCELLED status için reason zorunlu
    if (status === OrderStatus.CANCELLED && !reason) {
      throw new BadRequestException('Reason is required when cancelling an order');
    }

    // Admin middleware'den gelen random adminId kullan
    return this.orderService.updateStatus(id, status, req.adminId, reason);
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id', new UuidValidationPipe('order')) id: string,
    @Body('reason') reason: string,
  ) {
    // JWT sistemi olmadığı için şimdilik herhangi bir order iptal edilebilir
    return this.orderService.cancel(id, reason);
  }

  // Delete endpoint kaldırıldı - Order cancel etmek aynı işlevi görüyor

  // Message Queue Handlers
  @MessagePattern('inventory.reserved')
  async handleInventoryReserved(@Payload() data: any, @Ctx() context: RmqContext) {
    this.logger.log('Received inventory.reserved event', data);

    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      const orderId = data.payload?.orderId || data.orderId;
      this.logger.log(`✅ Inventory successfully reserved for order: ${orderId}`);
      // Order zaten CONFIRMED durumunda, sadece log tutuyoruz

      const result = { success: true, orderId };

      // Manual ACK on success
      channel.ack(originalMsg);
      this.logger.log('✅ [ACK] inventory.reserved message acknowledged successfully');

      return result;
    } catch (error) {
      this.logger.error('❌ Failed to process inventory.reserved event:', error);

      // Manual NACK on error
      channel.nack(originalMsg, false, false);
      this.logger.log('❌ [NACK] inventory.reserved message rejected (not requeued)');

      throw error;
    }
  }

  @MessagePattern('inventory.reservation.failed')
  async handleInventoryReservationFailed(@Payload() data: any, @Ctx() context: RmqContext) {
    this.logger.log('Received inventory.reservation.failed event', data);

    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      const { orderId, reason } = data;
      const result = await this.orderService.cancel(orderId, reason);

      // Manual ACK on success
      channel.ack(originalMsg);
      this.logger.log('✅ [ACK] inventory.reservation.failed message acknowledged successfully');

      return result;
    } catch (error) {
      this.logger.error('❌ Failed to process inventory.reservation.failed event:', error);

      // Manual NACK on error
      channel.nack(originalMsg, false, false);
      this.logger.log('❌ [NACK] inventory.reservation.failed message rejected (not requeued)');

      throw error;
    }
  }
}
