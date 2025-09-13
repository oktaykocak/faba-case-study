import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { firstValueFrom, timeout } from 'rxjs';
import { EventPublisher } from '../../events/event.publisher';

export interface InventoryValidationRequest {
  items: Array<{ productId: string; quantity: number }>;
  correlationId: string;
}

export interface InventoryValidationResponse {
  success: boolean;
  validatedItems?: Array<{ productId: string; quantity: number; price: number }>;
  error?: string;
  correlationId: string;
}

@Injectable()
export class InventoryValidationService {
  private readonly logger = new Logger(InventoryValidationService.name);

  constructor(private readonly eventPublisher: EventPublisher) {}

  /**
   * Message queue üzerinden inventory validation yapar
   */
  async validateInventoryItems(
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<Array<{ productId: string; quantity: number; price: number }>> {
    const correlationId = this.generateCorrelationId();

    try {
      this.logger.log(`Sending inventory validation request: ${correlationId}`);

      // Inventory service'e validation request gönder
      const response = await firstValueFrom(
        this.eventPublisher
          .getInventoryClient()
          .send<InventoryValidationResponse, InventoryValidationRequest>('inventory.validate', {
            items,
            correlationId,
          })
          .pipe(
            timeout(10000), // 10 saniye timeout
          ),
      );

      const validationResponse = response as InventoryValidationResponse;

      if (!validationResponse.success) {
        throw new BadRequestException(validationResponse.error || 'Inventory validation failed');
      }

      if (!validationResponse.validatedItems) {
        throw new InternalServerErrorException(
          'No validated items received from inventory service',
        );
      }

      this.logger.log(`Inventory validation successful: ${correlationId}`);
      return validationResponse.validatedItems;
    } catch (error) {
      this.logger.error(`Inventory validation failed: ${correlationId}`, error.stack);

      if (error.name === 'TimeoutError') {
        throw new InternalServerErrorException('Inventory service timeout - please try again');
      }

      throw error;
    }
  }

  /**
   * Tek bir ürün için validation
   */
  async validateSingleItem(
    productId: string,
    quantity: number,
  ): Promise<{ productId: string; quantity: number; price: number }> {
    const validatedItems = await this.validateInventoryItems([{ productId, quantity }]);
    return validatedItems[0];
  }

  /**
   * Correlation ID generator
   */
  private generateCorrelationId(): string {
    return `order-validation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async onModuleInit() {
    // EventPublisher handles client connections
  }

  async onModuleDestroy() {
    // EventPublisher handles client disconnections
  }
}
