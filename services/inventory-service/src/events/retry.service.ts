import { Injectable, Logger } from '@nestjs/common';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  retryableErrors?: string[];
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  async executeWithRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 30000,
      retryableErrors = ['ECONNREFUSED', 'TIMEOUT', 'DATABASE_ERROR', 'SERVICE_UNAVAILABLE'],
    } = options;

    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryableError(error, retryableErrors)) {
          this.logger.error(`Non-retryable error encountered: ${error.message}`);
          throw error;
        }

        if (attempt === maxRetries) {
          this.logger.error(`Max retries (${maxRetries}) exceeded for operation`, error.stack);
          throw error;
        }

        const delay = this.calculateExponentialBackoff(attempt, baseDelay, maxDelay);
        this.logger.warn(
          `Attempt ${attempt + 1}/${maxRetries + 1} failed: ${error.message}. Retrying in ${delay}ms`,
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private isRetryableError(error: any, retryableErrors: string[]): boolean {
    const errorCode = error.code || error.name || error.message;
    return retryableErrors.some(
      retryableError =>
        errorCode.includes(retryableError) || error.message?.includes(retryableError),
    );
  }

  private calculateExponentialBackoff(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
  ): number {
    const delay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * delay; // Add 10% jitter
    return Math.min(delay + jitter, maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getRetryCount(headers: any): number {
    return parseInt(headers['x-retry-count'] || '0');
  }

  setRetryHeaders(headers: any, retryCount: number, originalError?: string): any {
    return {
      ...headers,
      'x-retry-count': retryCount.toString(),
      'x-retry-timestamp': new Date().toISOString(),
      'x-original-error': originalError || headers['x-original-error'],
    };
  }

  shouldRetry(error: any, currentRetryCount: number, maxRetries: number): boolean {
    return (
      currentRetryCount < maxRetries &&
      this.isRetryableError(error, [
        'ECONNREFUSED',
        'TIMEOUT',
        'DATABASE_ERROR',
        'SERVICE_UNAVAILABLE',
      ])
    );
  }
}
