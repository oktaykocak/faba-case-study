import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderHistory, OrderHistoryAction } from './entities/order-history.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus } from '@ecommerce/shared-types';
import { EventPublisher } from '../events/event.publisher';
import { InventoryValidationService } from './services/inventory-validation.service';
import { MockPaymentService } from './services/mock-payment.service';
import {
  isValidStatusTransition,
  getInvalidTransitionMessage,
  isCancellableStatus,
} from './utils/order-status-rules.util';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderHistory)
    private readonly orderHistoryRepository: Repository<OrderHistory>,
    private readonly eventPublisher: EventPublisher,
    private readonly inventoryValidationService: InventoryValidationService,
    private readonly mockPaymentService: MockPaymentService,
  ) {}

  async create(createOrderDto: CreateOrderDto, customerId?: string): Promise<Order> {
    try {
      if (!customerId) {
        throw new BadRequestException('Customer ID is required');
      }
      this.logger.log(`Creating order for customer: ${customerId}`);

      // Message queue üzerinden inventory validation yap
      const validatedItems = await this.inventoryValidationService.validateInventoryItems(
        createOrderDto.items,
      );

      // Calculate total amount with real prices
      const totalAmount = validatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

      const orderId = uuidv4();

      const order = this.orderRepository.create({
        id: orderId,
        customerId: customerId,
        items: validatedItems,
        totalAmount,
        status: OrderStatus.PENDING,
      });

      const savedOrder = await this.orderRepository.save(order);

      // Payment işlemini başlat
      const paymentResult = await this.processPayment(savedOrder);

      if (paymentResult.success) {
        // Payment başarılı - CONFIRMED'a geçir
        const confirmedOrder = await this.updateStatus(
          savedOrder.id,
          OrderStatus.CONFIRMED,
          'system-payment',
        );
        this.logger.log(`Order confirmed: ${savedOrder.id}`);

        // Şimdi order.created event'ini publish et - inventory reservation için
        await this.eventPublisher.publishOrderCreated(confirmedOrder);

        return confirmedOrder;
      } else {
        // Payment başarısız - CANCELLED'a geçir
        const cancelledOrder = await this.updateStatus(
          savedOrder.id,
          OrderStatus.CANCELLED,
          'system-payment',
          `Payment failed: ${paymentResult.errorMessage}`,
        );
        this.logger.warn(`❌ [STEP 11] Payment failed, order cancelled: ${savedOrder.id}`);
        throw new BadRequestException(`Payment failed: ${paymentResult.errorMessage}`);
      }
    } catch (error) {
      this.logger.error(`❌ [ERROR] Failed to create order: ${error.message}`, error.stack);

      // Re-throw business logic errors from inventory service
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      // Only convert unexpected errors to InternalServerErrorException
      throw new InternalServerErrorException('Failed to create order', error);
    }
  }

  async findAll(): Promise<Order[]> {
    return this.orderRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  async findOneWithHistory(id: string): Promise<Order & { history?: OrderHistory[] }> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    // Get order history
    const history = await this.orderHistoryRepository.find({
      where: { orderId: id },
      order: { createdAt: 'DESC' },
    });

    return { ...order, history };
  }

  async findByCustomerId(customerId: string): Promise<Order[]> {
    return this.orderRepository.find({
      where: { customerId },
      order: { createdAt: 'DESC' },
    });
  }

  // Update metodu kaldırıldı - Order'lar güncellenemez

  async updateStatus(
    id: string,
    status: OrderStatus,
    adminId?: string,
    reason?: string,
    isFromSystem: boolean = false,
  ): Promise<Order> {
    // System events don't require admin authorization
    if (!isFromSystem && !adminId) {
      throw new BadRequestException('Admin authorization required for status update');
    }

    const order = await this.findOne(id);
    const previousStatus = order.status;

    // Status transition validation
    if (!isValidStatusTransition(previousStatus, status)) {
      throw new BadRequestException({
        message: 'Invalid order status transition',
        error: 'BAD_REQUEST',
        statusCode: 400,
        details: {
          currentStatus: previousStatus,
          requestedStatus: status,
          reason: getInvalidTransitionMessage(previousStatus, status),
        },
      });
    }

    order.status = status;

    const updatedOrder = await this.orderRepository.save(order);
    this.logger.log(`Order status updated by admin ${adminId}: ${id} -> ${status}`);

    // History kaydı oluştur
    await this.createHistoryRecord({
      orderId: id,
      action: OrderHistoryAction.STATUS_UPDATED,
      previousStatus,
      newStatus: status,
      adminId: isFromSystem ? 'system' : adminId,
      reason: reason || undefined,
      notes: isFromSystem
        ? `Status updated from ${previousStatus} to ${status} by system event`
        : reason
          ? `Status updated from ${previousStatus} to ${status} by admin. Reason: ${reason}`
          : `Status updated from ${previousStatus} to ${status} by admin`,
    });

    // If order is delivered, publish order.delivered event for inventory finalization
    if (status === OrderStatus.DELIVERED) {
      await this.eventPublisher.publishOrderDelivered(id, order.items);
      this.logger.log(`Order delivered event published for order: ${id}`);
    }

    return updatedOrder;
  }

  async cancel(id: string, reason: string): Promise<Order> {
    const order = await this.findOne(id);

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled');
    }

    // Status transition kurallarına göre cancel kontrolü
    if (!isCancellableStatus(order.status)) {
      throw new BadRequestException(
        `Order cannot be cancelled from status '${order.status}'. Only PENDING and CONFIRMED orders can be cancelled.`,
      );
    }

    const previousStatus = order.status;
    order.status = OrderStatus.CANCELLED;

    const cancelledOrder = await this.orderRepository.save(order);
    this.logger.log(`Order cancelled: ${id}, reason: ${reason}`);

    // History kaydı oluştur
    await this.createHistoryRecord({
      orderId: id,
      action: OrderHistoryAction.CANCELLED,
      previousStatus,
      newStatus: OrderStatus.CANCELLED,
      customerId: order.customerId, // Order'dan customer ID al
      reason,
      notes: `Order cancelled by customer. Reason: ${reason}`,
    });

    // Event yayınla - Inventory Service otomatik release yapacak
    await this.eventPublisher.publishOrderCancelled(id, order.items, reason);

    return cancelledOrder;
  }

  // softDelete metodu kaldırıldı - Order cancel etmek aynı işlevi görüyor

  private async createHistoryRecord(historyData: Partial<OrderHistory>): Promise<OrderHistory> {
    const historyRecord = new OrderHistory(historyData);
    return await this.orderHistoryRepository.save(historyRecord);
  }

  /**
   * Sync payment processing
   */
  private async processPayment(
    order: Order,
  ): Promise<{ success: boolean; paymentId?: string; errorCode?: string; errorMessage?: string }> {
    try {
      this.logger.log(`Starting payment processing for order: ${order.id}`);

      const paymentResult = await this.mockPaymentService.processPayment({
        orderId: order.id,
        amount: order.totalAmount,
        customerId: order.customerId,
      });

      if (paymentResult.success) {
        this.logger.log(
          `Payment successful for order ${order.id}, paymentId: ${paymentResult.paymentId}`,
        );
        return paymentResult;
      } else {
        this.logger.warn(`Payment failed for order ${order.id}: ${paymentResult.errorMessage}`);
        return paymentResult;
      }
    } catch (error) {
      this.logger.error(`Payment processing error for order ${order.id}:`, error.stack);

      return {
        success: false,
        errorCode: 'SYSTEM_ERROR',
        errorMessage: 'Payment processing system error',
      };
    }
  }

  /**
   * Payment failure durumunda order'ı cancel et
   */
  private async cancelOrderDueToPaymentFailure(
    orderId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      const order = await this.findOne(orderId);
      const previousStatus = order.status;

      order.status = OrderStatus.CANCELLED;
      await this.orderRepository.save(order);

      // History kaydı oluştur
      await this.createHistoryRecord({
        orderId,
        action: OrderHistoryAction.CANCELLED,
        previousStatus,
        newStatus: OrderStatus.CANCELLED,
        reason: `Payment rejected: ${errorCode}`,
        notes: `Payment failed - ${errorMessage}`,
      });

      // Cancel eventi yayınla
      await this.eventPublisher.publishOrderCancelled(
        orderId,
        order.items,
        `Payment rejected: ${errorCode}`,
      );

      this.logger.log(`Order ${orderId} cancelled due to payment failure: ${errorCode}`);
    } catch (error) {
      this.logger.error(`Failed to cancel order ${orderId} after payment failure:`, error.stack);
    }
  }
}
