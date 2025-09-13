import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { validate as isValidUuid } from 'uuid';

@Injectable()
export class UuidValidationPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isValidUuid(value)) {
      throw new BadRequestException({
        message: 'Invalid product ID format',
        error: 'BAD_REQUEST',
        statusCode: 400,
        details: {
          productId: value,
          reason: 'Product ID must be a valid UUID format',
        },
      });
    }
    return value;
  }
}
