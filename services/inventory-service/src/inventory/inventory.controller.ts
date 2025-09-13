import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Logger,
  UseGuards,
  Req,
} from '@nestjs/common';
import { MessagePattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { Request } from 'express';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { EventPublisher } from '../events/event.publisher';
import { UuidValidationPipe } from './pipes/uuid-validation.pipe';

@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly eventPublisher: EventPublisher,
  ) {
    this.logger.log('InventoryController initialized');
  }

  @Post()
  async create(@Body() createInventoryItemDto: CreateInventoryItemDto, @Req() req: Request) {
    this.logger.log('Creating new inventory item');
    return this.inventoryService.create(createInventoryItemDto, req.adminId);
  }

  @Get()
  async findAll() {
    return this.inventoryService.findAll();
  }

  @Get(':productId')
  async findOne(@Param('productId', UuidValidationPipe) productId: string) {
    return this.inventoryService.findOneWithHistory(productId);
  }

  @Patch(':productId')
  async update(
    @Param('productId', UuidValidationPipe) productId: string,
    @Body() updateInventoryItemDto: UpdateInventoryItemDto,
    @Req() req: Request,
  ) {
    return this.inventoryService.update(productId, updateInventoryItemDto, req.adminId);
  }

  @Delete(':productId')
  async remove(@Param('productId', UuidValidationPipe) productId: string) {
    return this.inventoryService.remove(productId);
  }

  // Message Queue Handlers
  @MessagePattern('order.created')
  async handleOrderCreated(@Payload() message: any, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      this.logger.log('🔥 [EVENT_HANDLER] order.created event received!');
      this.logger.log('🔍 [DEBUG] Raw message received:', JSON.stringify(message, null, 2));

      // Handle different message wrapper formats
      const order =
        message.data?.payload?.order || message.payload?.order || message.order || message;

      this.logger.log('Extracted order:', JSON.stringify(order, null, 2));

      if (!order || !order.id) {
        this.logger.error('Invalid order data - order:', order);
        this.logger.error('Invalid order data - full message:', JSON.stringify(message, null, 2));
        throw new Error('Invalid order data: missing order or order.id');
      }

      this.logger.log(`Handling order.created event for order: ${order.id}`);

      // Reserve inventory for the order
      await this.inventoryService.reserveItems(order.items);
      this.logger.log(`Inventory reserved for order: ${order.id}`);

      // Publish inventory.reserved event
      await this.eventPublisher.publishInventoryReserved(order.id, order.items);

      this.logger.log(`Successfully processed order.created event: ${order.id}`);

      // Manual ACK on success
      channel.ack(originalMsg);
      this.logger.log('✅ [ACK] Message acknowledged successfully');
    } catch (error) {
      this.logger.error('❌ [EVENT_HANDLER] CRITICAL ERROR in handleOrderCreated!');
      this.logger.error('❌ [ERROR_DETAILS]:', error.message);
      this.logger.error('❌ [ERROR_STACK]:', error.stack);
      this.logger.error('❌ [MESSAGE_DATA]:', JSON.stringify(message, null, 2));

      // Publish inventory.reservation.failed event
      const order =
        message.data?.payload?.order || message.payload?.order || message.order || message;
      if (order && order.id) {
        this.logger.log('🔄 [RECOVERY] Publishing inventory.reservation.failed event');
        await this.eventPublisher.publishInventoryReservationFailed(
          order.id,
          order.items,
          error.message,
        );
      }

      // Manual NACK on error (don't requeue to avoid infinite loop)
      channel.nack(originalMsg, false, false);
      this.logger.log('❌ [NACK] Message rejected (not requeued)');

      throw error;
    }
  }

  @MessagePattern('order.cancelled')
  async handleOrderCancelled(@Payload() message: any, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      // Handle different message formats
      const orderId = message.data?.payload?.orderId || message.payload?.orderId || message.orderId;
      const items = message.data?.payload?.items || message.payload?.items || message.items;

      if (!orderId || !items) {
        this.logger.error(
          'Invalid order cancelled data received:',
          JSON.stringify(message, null, 2),
        );
        throw new Error('Invalid order cancelled data: missing orderId or items');
      }

      this.logger.log(`Handling order.cancelled event: ${orderId}`);

      // Release inventory reservation
      await this.inventoryService.releaseReservation(items);
      this.logger.log(`Inventory reservation released for order: ${orderId}`);

      this.logger.log(`Successfully processed order.cancelled event: ${orderId}`);

      // Manual ACK on success
      channel.ack(originalMsg);
      this.logger.log('✅ [ACK] order.cancelled message acknowledged successfully');
    } catch (error) {
      this.logger.error(`Failed to handle order.cancelled event`, error.stack);

      // Manual NACK on error
      channel.nack(originalMsg, false, false);
      this.logger.log('❌ [NACK] order.cancelled message rejected (not requeued)');

      throw error;
    }
  }

  @MessagePattern('order.delivered')
  async handleOrderDelivered(@Payload() message: any, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      // Handle different message formats
      const orderId = message.data?.payload?.orderId || message.payload?.orderId || message.orderId;
      const items = message.data?.payload?.items || message.payload?.items || message.items;

      if (!orderId || !items) {
        this.logger.error(
          'Invalid order delivered data received:',
          JSON.stringify(message, null, 2),
        );
        throw new Error('Invalid order delivered data: missing orderId or items');
      }

      this.logger.log(`Processing order.delivered: ${orderId}`);

      // Finalize inventory - remove from reserved and update total quantity
      await this.inventoryService.finalizeDelivery(items);

      this.logger.log(`Order delivered processed: ${orderId}`);

      // Manual ACK on success
      channel.ack(originalMsg);
      this.logger.log('✅ [ACK] order.delivered message acknowledged successfully');
    } catch (error) {
      this.logger.error(`Failed to handle order.delivered event`, error.stack);

      // Manual NACK on error
      channel.nack(originalMsg, false, false);
      this.logger.log('❌ [NACK] order.delivered message rejected (not requeued)');

      throw error;
    }
  }

  @MessagePattern('inventory.validate')
  async handleInventoryValidation(@Payload() data: any, @Ctx() context: RmqContext) {
    this.logger.log('Received inventory.validate request', data);
    const { items, correlationId } = data;

    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      const validatedItems = [];

      for (const item of items) {
        const inventoryItem = await this.inventoryService.findOne(item.productId);

        // Stok kontrolü
        if (inventoryItem.availableQuantity < item.quantity) {
          const result = {
            success: false,
            error: `Insufficient stock for product ${item.productId}. Available: ${inventoryItem.availableQuantity}, Requested: ${item.quantity}`,
            correlationId,
          };

          // Manual ACK on validation failure
          channel.ack(originalMsg);
          this.logger.log(
            '✅ [ACK] Inventory validation message acknowledged (insufficient stock)',
          );

          return result;
        }

        validatedItems.push({
          productId: item.productId,
          quantity: item.quantity,
          price: inventoryItem.price,
        });
      }

      this.logger.log(`Inventory validation successful: ${correlationId}`);
      const result = {
        success: true,
        validatedItems,
        correlationId,
      };

      // Manual ACK on success
      channel.ack(originalMsg);
      this.logger.log('✅ [ACK] Inventory validation message acknowledged successfully');

      return result;
    } catch (error) {
      this.logger.error(`Inventory validation failed: ${correlationId}`, error.stack);

      const result = {
        success: false,
        error: error.message,
        correlationId,
      };

      // Manual NACK on error
      channel.nack(originalMsg, false, false);
      this.logger.log('❌ [NACK] Inventory validation message rejected (error occurred)');

      return result;
    }
  }
}
