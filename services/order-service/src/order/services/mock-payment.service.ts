import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '@ecommerce/shared-types';

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface PaymentRequest {
  orderId: string;
  amount: number;
  customerId: string;
}

@Injectable()
export class MockPaymentService {
  private readonly logger = new Logger(MockPaymentService.name);

  /**
   * Mock payment processing
   * %70 başarı, %30 başarısızlık oranı
   */
  async processPayment(paymentRequest: PaymentRequest): Promise<PaymentResult> {
    const { orderId, amount, customerId } = paymentRequest;

    this.logger.log(`Processing payment for order ${orderId}, amount: ${amount}`);

    // Simulate payment processing delay
    await this.simulateDelay();

    // %100 başarı oranı (test için)
    const isSuccess = true; // Math.random() < 1.0;

    if (isSuccess) {
      const paymentId = this.generatePaymentId();

      this.logger.log(`Payment successful for order ${orderId}, paymentId: ${paymentId}`);

      return {
        success: true,
        paymentId,
      };
    } else {
      const errorCode = this.getRandomErrorCode();
      const errorMessage = this.getErrorMessage(errorCode);

      this.logger.warn(
        `Payment failed for order ${orderId}, error: ${errorCode} - ${errorMessage}`,
      );

      return {
        success: false,
        errorCode,
        errorMessage,
      };
    }
  }

  /**
   * Payment processing simulation delay (500ms - 2s)
   */
  private async simulateDelay(): Promise<void> {
    const delay = Math.random() * 1500 + 500; // 500ms - 2000ms
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Generate mock payment ID
   */
  private generatePaymentId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `pay_${timestamp}_${random}`;
  }

  /**
   * Get random error code for failed payments
   */
  private getRandomErrorCode(): string {
    const errorCodes = [
      'INSUFFICIENT_FUNDS',
      'CARD_DECLINED',
      'EXPIRED_CARD',
      'INVALID_CVV',
      'NETWORK_ERROR',
      'BANK_TIMEOUT',
      'FRAUD_DETECTED',
    ];

    const randomIndex = Math.floor(Math.random() * errorCodes.length);
    return errorCodes[randomIndex];
  }

  /**
   * Get error message for error code
   */
  private getErrorMessage(errorCode: string): string {
    const errorMessages: Record<string, string> = {
      INSUFFICIENT_FUNDS: 'Insufficient funds in account',
      CARD_DECLINED: 'Card declined by issuer',
      EXPIRED_CARD: 'Card has expired',
      INVALID_CVV: 'Invalid CVV code',
      NETWORK_ERROR: 'Network connection error',
      BANK_TIMEOUT: 'Bank processing timeout',
      FRAUD_DETECTED: 'Potential fraud detected',
    };

    return errorMessages[errorCode] || 'Unknown payment error';
  }

  /**
   * Validate payment request
   */
  validatePaymentRequest(paymentRequest: PaymentRequest): boolean {
    const { orderId, amount, customerId } = paymentRequest;

    if (!orderId || !customerId) {
      return false;
    }

    if (!amount || amount <= 0) {
      return false;
    }

    return true;
  }
}
