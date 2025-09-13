// Event Base Types
export interface BaseEvent {
  id: string;
  timestamp: Date;
  version: string;
  sequenceNumber: number;
  entityId: string; // For ordering events by entity (productId, orderId, etc.)
  correlationId?: string;
  causationId?: string;
}

// Order Types
export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
}

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Inventory Types
export interface InventoryItem {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lastUpdated: Date;
}

// Notification Types
export enum NotificationType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
}

export interface NotificationPayload {
  id: string;
  type: NotificationType;
  recipient: string;
  subject?: string;
  message: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  sentAt?: Date;
}

// Event Types
export interface OrderCreatedEvent extends BaseEvent {
  type: 'order.created';
  payload: {
    order: Order;
  };
}

export interface OrderCancelledEvent extends BaseEvent {
  type: 'order.cancelled';
  payload: {
    orderId: string;
    items: OrderItem[];
    reason: string;
  };
}

export interface OrderDeliveredEvent extends BaseEvent {
  type: 'order.delivered';
  payload: {
    orderId: string;
    items: OrderItem[];
  };
}

export interface InventoryReservedEvent extends BaseEvent {
  type: 'inventory.reserved';
  payload: {
    orderId: string;
    items: OrderItem[];
  };
}

export interface InventoryReservationFailedEvent extends BaseEvent {
  type: 'inventory.reservation.failed';
  payload: {
    orderId: string;
    items: OrderItem[];
    reason: string;
  };
}

export interface InventoryUpdatedEvent extends BaseEvent {
  type: 'inventory.updated';
  payload: {
    productId: string;
    previousQuantity: number;
    newQuantity: number;
  };
}

export interface NotificationSentEvent extends BaseEvent {
  type: 'notification.sent';
  payload: {
    notificationId: string;
    recipient: string;
    type: NotificationType;
  };
}

export interface NotificationFailedEvent extends BaseEvent {
  type: 'notification.failed';
  payload: {
    notificationId: string;
    recipient: string;
    type: NotificationType;
    error: string;
  };
}

// Union type for all events
export type DomainEvent =
  | OrderCreatedEvent
  | OrderCancelledEvent
  | OrderDeliveredEvent
  | InventoryReservedEvent
  | InventoryReservationFailedEvent
  | InventoryUpdatedEvent
  | NotificationSentEvent
  | NotificationFailedEvent;

// Message Queue Types
export interface MessageMetadata {
  messageId: string;
  timestamp: Date;
  retryCount: number;
  maxRetries: number;
  routingKey: string;
  exchange: string;
}

export interface QueueMessage<T = any> {
  data: T;
  metadata: MessageMetadata;
}

// Event Ordering Types
export interface EventSequence {
  entityId: string;
  entityType: string; // 'order', 'product', 'customer'
  lastSequenceNumber: number;
  updatedAt: Date;
}

export interface OrderedEvent extends BaseEvent {
  processed: boolean;
  processedAt?: Date;
}

export interface EventBuffer {
  entityId: string;
  pendingEvents: OrderedEvent[];
  lastProcessedSequence: number;
}

// Error Types
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details?: any) {
    super(message, 'NOT_FOUND', details);
    this.name = 'NotFoundError';
  }
}

export class InsufficientInventoryError extends DomainError {
  constructor(message: string, details?: any) {
    super(message, 'INSUFFICIENT_INVENTORY', details);
    this.name = 'InsufficientInventoryError';
  }
}

// Mock ID Utilities
export {
  getRandomMockAdminId,
  getRandomMockCustomerId,
  getAllMockAdminIds,
  getAllMockCustomerIds,
  isMockAdminId,
  isMockCustomerId,
} from './utils/mock-ids.util';
