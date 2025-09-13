import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  jitterEnabled?: boolean;
  retryableErrors?: string[];
  operationType?: 'database' | 'rabbitmq' | 'http' | 'default';
}

export interface RetryAttempt {
  attemptNumber: number;
  error: Error;
  nextRetryAt: Date;
  context: string;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);
  private readonly defaultRetryOptions: RetryOptions;

  constructor(private readonly configService: ConfigService) {
    this.defaultRetryOptions = {
      maxRetries: this.configService.get<number>('RETRY_MAX_ATTEMPTS', 3),
      baseDelay: this.configService.get<number>('RETRY_INITIAL_DELAY', 1000),
      maxDelay: this.configService.get<number>('RETRY_MAX_DELAY', 30000),
      backoffMultiplier: this.configService.get<number>('RETRY_BACKOFF_MULTIPLIER', 2),
      jitterEnabled: this.configService.get<boolean>('RETRY_JITTER_ENABLED', true),
      retryableErrors: [
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'ECONNRESET',
        'Connection closed',
        'Channel closed',
        'Connection lost',
        'Connection terminated',
        'Connection timeout',
        'PRECONDITION_FAILED',
        'SERVICE_UNAVAILABLE',
        'TIMEOUT',
      ],
    };
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {},
    context: string = 'unknown',
  ): Promise<T> {
    const startTime = Date.now();
    const config = this.mergeOptions(options);
    let lastError: Error;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        this.logger.debug(`Executing operation: ${context}, attempt: ${attempt + 1}`);
        const result = await operation();

        if (attempt > 0) {
          const duration = Date.now() - startTime;
          this.logger.log(
            `Operation succeeded on attempt ${attempt + 1}: ${context} (${duration}ms)`,
          );
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (!this.isRetryableError(error, config.retryableErrors)) {
          this.logger.error(`Non-retryable error encountered: ${context} - ${error.message}`);
          throw error;
        }

        if (attempt === config.maxRetries) {
          const duration = Date.now() - startTime;
          this.logger.error(
            `Max retries (${config.maxRetries}) exceeded for operation: ${context} ` +
              `(${duration}ms). Final error: ${error.message}`,
            error.stack,
          );
          throw new Error(
            `Operation failed after ${config.maxRetries + 1} attempts: ${context}. ` +
              `Last error: ${error.message}`,
          );
        }

        const delay = this.calculateDelay(attempt, config);
        this.logger.warn(
          `Attempt ${attempt + 1}/${config.maxRetries + 1} failed: ${context}. ` +
            `Error: ${error.message}. Retrying in ${delay}ms...`,
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private mergeOptions(options: RetryOptions): Required<RetryOptions> {
    const operationType = options.operationType || 'default';
    const typeSpecificOptions = this.getRetryConfigByType(operationType);

    return {
      ...this.defaultRetryOptions,
      ...typeSpecificOptions,
      ...options,
      retryableErrors:
        options.retryableErrors ||
        typeSpecificOptions.retryableErrors ||
        this.defaultRetryOptions.retryableErrors,
    } as Required<RetryOptions>;
  }

  private getRetryConfigByType(operationType: string): Partial<RetryOptions> {
    switch (operationType) {
      case 'database':
        return {
          maxRetries: 5,
          baseDelay: 500,
          maxDelay: 10000,
          backoffMultiplier: 1.5,
        };
      case 'rabbitmq':
        return {
          maxRetries: 3,
          baseDelay: 1000,
          maxDelay: 15000,
          backoffMultiplier: 2,
        };
      case 'http':
        return {
          maxRetries: 3,
          baseDelay: 2000,
          maxDelay: 20000,
          backoffMultiplier: 2,
        };
      default:
        return {};
    }
  }

  private calculateDelay(attempt: number, config: Required<RetryOptions>): number {
    // Exponential backoff: delay = baseDelay * (backoffMultiplier ^ attempt)
    let delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);

    // Cap at max delay
    delay = Math.min(delay, config.maxDelay);

    // Add jitter to prevent thundering herd
    if (config.jitterEnabled) {
      const jitter = delay * 0.1 * Math.random(); // 10% jitter
      delay += jitter;
    }

    return Math.floor(delay);
  }

  private isRetryableError(error: any, retryableErrors: string[]): boolean {
    const errorMessage = error.message || error.toString();
    return retryableErrors.some(retryableError => errorMessage.includes(retryableError));
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
