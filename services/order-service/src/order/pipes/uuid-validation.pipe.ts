import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { validate as isValidUuid } from 'uuid';

@Injectable()
export class UuidValidationPipe implements PipeTransform<string, string> {
  constructor(private readonly fieldType: 'order' | 'customer' = 'order') {}

  transform(value: string): string {
    if (!isValidUuid(value)) {
      const isOrderField = this.fieldType === 'order';
      const fieldName = isOrderField ? 'order ID' : 'customer ID';
      const detailKey = isOrderField ? 'orderId' : 'customerId';

      throw new BadRequestException({
        message: `Invalid ${fieldName} format`,
        error: 'BAD_REQUEST',
        statusCode: 400,
        details: {
          [detailKey]: value,
          reason: `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} must be a valid UUID format`,
        },
      });
    }
    return value;
  }
}
