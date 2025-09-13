import { OrderStatus } from '@ecommerce/shared-types';

/**
 * Order Status Transition Rules
 * Hangi status'ten hangi status'e geçiş yapılabileceğini tanımlar
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [
    // DELIVERED final status - hiçbir yere geçiş yok
  ],
  [OrderStatus.CANCELLED]: [
    // CANCELLED final status - hiçbir yere geçiş yok
  ],
};

/**
 * Order Status Flow Açıklamaları
 */
export const ORDER_STATUS_DESCRIPTIONS: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: 'Order oluşturuldu, inventory validation yapıldı, ödeme bekleniyor',
  [OrderStatus.CONFIRMED]: 'Ödeme alındı, sipariş onaylandı, kargo hazırlığı başladı',
  [OrderStatus.SHIPPED]: 'Sipariş kargoya verildi, müşteriye gönderildi',
  [OrderStatus.DELIVERED]: 'Sipariş müşteriye teslim edildi',
  [OrderStatus.CANCELLED]: 'Sipariş iptal edildi',
};

/**
 * Verilen status transition'ının geçerli olup olmadığını kontrol eder
 */
export function isValidStatusTransition(
  currentStatus: OrderStatus,
  newStatus: OrderStatus,
): boolean {
  const allowedTransitions = ORDER_STATUS_TRANSITIONS[currentStatus];
  return allowedTransitions.includes(newStatus);
}

/**
 * Geçersiz transition için hata mesajı oluşturur
 */
export function getInvalidTransitionMessage(
  currentStatus: OrderStatus,
  newStatus: OrderStatus,
): string {
  const allowedTransitions = ORDER_STATUS_TRANSITIONS[currentStatus];

  if (allowedTransitions.length === 0) {
    return `Order status '${currentStatus}' is final and cannot be changed`;
  }

  return `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedTransitions.join(', ')}`;
}

/**
 * Order lifecycle'daki bir sonraki olası status'leri döner
 */
export function getNextPossibleStatuses(currentStatus: OrderStatus): OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[currentStatus] || [];
}

/**
 * Status'ün final (değiştirilemez) olup olmadığını kontrol eder
 */
export function isFinalStatus(status: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[status].length === 0;
}

/**
 * Status'ün cancel edilebilir olup olmadığını kontrol eder
 */
export function isCancellableStatus(status: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[status].includes(OrderStatus.CANCELLED);
}
