import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { validate as isValidUuid } from 'uuid';

@Injectable()
export class UuidValidationPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isValidUuid(value)) {
      throw new BadRequestException({
        message: 'Invalid notification ID format',
        error: 'BAD_REQUEST',
        statusCode: 400,
        details: {
          notificationId: value,
          reason: 'Notification ID must be a valid UUID format',
        },
      });
    }
    return value;
  }
}
