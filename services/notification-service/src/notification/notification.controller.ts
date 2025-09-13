import { Controller, Get, Post, Body, Patch, Param, Delete, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { NotificationService } from './notification.service';
import { NotificationPayload, NotificationType } from '@ecommerce/shared-types';
import { v4 as uuidv4 } from 'uuid';
import { UuidValidationPipe } from './pipes/uuid-validation.pipe';

@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  async sendNotification(@Body() notificationPayload: NotificationPayload) {
    this.logger.log('Sending notification');
    return this.notificationService.sendNotification(notificationPayload);
  }

  @Get()
  async findAll() {
    return this.notificationService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', UuidValidationPipe) id: string) {
    return this.notificationService.findOne(id);
  }

  @Get('recipient/:recipient')
  async findByRecipient(@Param('recipient') recipient: string) {
    return this.notificationService.findByRecipient(recipient);
  }

  @Get('failed/list')
  async findFailedNotifications() {
    return this.notificationService.findFailedNotifications();
  }

  @Post(':id/retry')
  async retryNotification(@Param('id', UuidValidationPipe) id: string) {
    this.logger.log(`Retrying notification: ${id}`);
    return this.notificationService.retryFailedNotification(id);
  }

  @Patch(':id/mark-processed')
  async markAsProcessed(@Param('id', UuidValidationPipe) id: string) {
    return this.notificationService.markAsProcessed(id);
  }

  // Message Queue Handlers
  @MessagePattern('order.notification')
  async handleOrderNotification(@Payload() data: any, @Ctx() context: RmqContext) {
    this.logger.log('Received order.notification event', data);

    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      const notification = data.data;

      const notificationPayload: NotificationPayload = {
        id: uuidv4(),
        type: NotificationType.EMAIL,
        recipient: 'customer@example.com', // In real app, get from notification.customerId
        subject: this.getSubjectByType(notification.type),
        message: this.getMessageByType(notification),
        metadata: {
          orderId: notification.orderId,
          customerId: notification.customerId,
          totalAmount: notification.totalAmount,
          type: notification.type,
          descriptiveId: `order-${notification.type.toLowerCase()}-${notification.orderId}`,
        },
        createdAt: new Date(),
      };

      await this.notificationService.sendNotification(notificationPayload);
      this.logger.log(`${notification.type} notification sent for order: ${notification.orderId}`);

      const result = { success: true, orderId: notification.orderId };

      // Manual ACK on success
      channel.ack(originalMsg);
      this.logger.log('✅ [ACK] order.notification message acknowledged successfully');

      return result;
    } catch (error) {
      this.logger.error(`Failed to send notification:`, error.stack);

      const result = { success: false, orderId: data.data?.orderId, error: error.message };

      // Manual NACK on error
      channel.nack(originalMsg, false, false);
      this.logger.log('❌ [NACK] order.notification message rejected (not requeued)');

      return result;
    }
  }

  @MessagePattern('order.cancelled.notification')
  async handleOrderCancelledNotification(@Payload() data: any, @Ctx() context: RmqContext) {
    this.logger.log('Received order.cancelled.notification event', data);

    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      const notification = data.data;

      const notificationPayload: NotificationPayload = {
        id: uuidv4(),
        type: NotificationType.EMAIL,
        recipient: 'customer@example.com', // In real app, get from order data
        subject: 'Order Cancelled',
        message: `Your order ${notification.orderId} has been cancelled. Reason: ${notification.reason}`,
        metadata: {
          orderId: notification.orderId,
          reason: notification.reason,
          type: notification.type,
          descriptiveId: `order-cancelled-${notification.orderId}`,
        },
        createdAt: new Date(),
      };

      await this.notificationService.sendNotification(notificationPayload);
      this.logger.log(`Order cancellation notification sent for order: ${notification.orderId}`);

      const result = { success: true, orderId: notification.orderId };

      // Manual ACK on success
      channel.ack(originalMsg);
      this.logger.log('✅ [ACK] order.cancelled.notification message acknowledged successfully');

      return result;
    } catch (error) {
      this.logger.error(`Failed to send order cancellation notification:`, error.stack);

      const result = { success: false, orderId: data.data?.orderId, error: error.message };

      // Manual NACK on error
      channel.nack(originalMsg, false, false);
      this.logger.log('❌ [NACK] order.cancelled.notification message rejected (not requeued)');

      return result;
    }
  }

  private getSubjectByType(type: string): string {
    switch (type) {
      case 'ORDER_CREATED':
        return 'Order Confirmation';
      case 'ORDER_CANCELLED':
        return 'Order Cancelled';
      default:
        return 'Order Notification';
    }
  }

  private getMessageByType(notification: any): string {
    switch (notification.type) {
      case 'ORDER_CREATED':
        return `Your order ${notification.orderId} has been created successfully. Total amount: $${notification.totalAmount}`;
      case 'ORDER_CANCELLED':
        return `Your order ${notification.orderId} has been cancelled. Reason: ${notification.reason}`;
      default:
        return `Order ${notification.orderId} status update.`;
    }
  }

  @MessagePattern('order.cancelled')
  async handleOrderCancelled(@Payload() data: any) {
    this.logger.log('Received order.cancelled event', data);
    const { orderId, reason } = data;

    const notificationPayload: NotificationPayload = {
      id: `order-cancelled-${orderId}`,
      type: NotificationType.EMAIL,
      recipient: 'customer@example.com', // In real app, get from order data
      subject: 'Order Cancellation',
      message: `Your order ${orderId} has been cancelled. Reason: ${reason}`,
      metadata: {
        orderId,
        reason,
      },
      createdAt: new Date(),
    };

    try {
      await this.notificationService.sendNotification(notificationPayload);
      this.logger.log(`Order cancellation notification sent for order: ${orderId}`);
      return { success: true, orderId };
    } catch (error) {
      this.logger.error(`Failed to send order cancellation notification: ${orderId}`, error.stack);
      return { success: false, orderId, error: error.message };
    }
  }

  @MessagePattern('inventory.reserved')
  async handleInventoryReserved(@Payload() data: any) {
    this.logger.log('Received inventory.reserved event', data);
    const { orderId, items } = data;

    const notificationPayload: NotificationPayload = {
      id: `inventory-reserved-${orderId}`,
      type: NotificationType.EMAIL,
      recipient: 'customer@example.com', // In real app, get from order data
      subject: 'Order Confirmed - Inventory Reserved',
      message: `Great news! Your order ${orderId} has been confirmed and inventory has been reserved.`,
      metadata: {
        orderId,
        items,
      },
      createdAt: new Date(),
    };

    try {
      await this.notificationService.sendNotification(notificationPayload);
      this.logger.log(`Inventory reserved notification sent for order: ${orderId}`);
      return { success: true, orderId };
    } catch (error) {
      this.logger.error(`Failed to send inventory reserved notification: ${orderId}`, error.stack);
      return { success: false, orderId, error: error.message };
    }
  }

  @MessagePattern('inventory.reservation.failed')
  async handleInventoryReservationFailed(@Payload() data: any) {
    this.logger.log(`Processing inventory reservation failed: ${data.orderId}`);

    try {
      const notificationPayload: NotificationPayload = {
        id: uuidv4(),
        type: NotificationType.EMAIL,
        recipient: 'admin@example.com',
        subject: 'Inventory Reservation Failed',
        message: `Failed to reserve inventory for order ${data.orderId}. Reason: ${data.reason}`,
        metadata: {
          orderId: data.orderId,
          reason: data.reason,
          timestamp: new Date().toISOString(),
        },
        createdAt: new Date(),
      };

      await this.notificationService.sendNotification(notificationPayload);
      this.logger.log(`Inventory reservation failed notification sent: ${data.orderId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send inventory reservation failed notification for order: ${data.orderId}`,
        error.stack,
      );
    }
  }

  @MessagePattern('inventory.low_stock')
  async handleLowStockAlert(@Payload() data: any) {
    this.logger.log(`Processing low stock alert: ${data.productId}`);

    try {
      const notificationPayload: NotificationPayload = {
        id: uuidv4(),
        type: NotificationType.EMAIL,
        recipient: 'admin@example.com',
        subject: `🚨 Low Stock Alert - ${data.productName}`,
        message: `Low stock alert for product: ${data.productName} (ID: ${data.productId})\n\nCurrent Status:\n- Total Quantity: ${data.totalQuantity}\n- Reserved Quantity: ${data.reservedQuantity}\n- Available Quantity: ${data.availableQuantity}\n- Threshold: ${data.threshold}\n\nImmediate restocking recommended!`,
        metadata: {
          productId: data.productId,
          productName: data.productName,
          availableQuantity: data.availableQuantity,
          threshold: data.threshold,
          alertType: 'LOW_STOCK',
          timestamp: new Date().toISOString(),
        },
        createdAt: new Date(),
      };

      await this.notificationService.sendNotification(notificationPayload);
      this.logger.log(`Low stock alert sent: ${data.productId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send low stock alert for product: ${data.productId}`,
        error.stack,
      );
    }
  }

  @MessagePattern('inventory.back_in_stock')
  async handleBackInStockAlert(@Payload() data: any) {
    this.logger.log('Received inventory.back_in_stock event');
    this.logger.log('Object:');
    this.logger.log(JSON.stringify(data, null, 2));

    try {
      const notificationPayload: NotificationPayload = {
        id: uuidv4(),
        type: NotificationType.EMAIL,
        recipient: 'admin@example.com',
        subject: `📦 Back in Stock - ${data.productName}`,
        message: `Good news! Product is back in stock: ${data.productName} (ID: ${data.productId})\n\nStock Update:\n- Previous Quantity: ${data.previousQuantity}\n- New Quantity: ${data.newQuantity}\n- Previous Available: ${data.previousAvailableQuantity}\n- New Available: ${data.newAvailableQuantity}\n- Reserved: ${data.reservedQuantity}\n\nProduct is now available for orders!`,
        metadata: {
          productId: data.productId,
          productName: data.productName,
          previousQuantity: data.previousQuantity,
          newQuantity: data.newQuantity,
          newAvailableQuantity: data.newAvailableQuantity,
          alertType: 'BACK_IN_STOCK',
          timestamp: new Date().toISOString(),
        },
        createdAt: new Date(),
      };

      await this.notificationService.sendNotification(notificationPayload);
      this.logger.log(`📦 Back in stock notification sent for product: ${data.productId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send back in stock notification for product: ${data.productId}`,
        error.stack,
      );
    }
  }
}
