import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface SmsPayload {
  to: string;
  message: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendSms(payload: SmsPayload): Promise<void> {
    try {
      this.logger.log(`Sending SMS to: ${payload.to}`);

      // In a real implementation, you would integrate with SMS providers like:
      // - Twilio
      // - AWS SNS
      // - Nexmo/Vonage
      // - etc.

      if (this.configService.get('NODE_ENV') === 'production') {
        // Production SMS sending logic would go here
        // Example with Twilio:
        // const client = twilio(accountSid, authToken);
        // await client.messages.create({
        //   body: payload.message,
        //   from: this.configService.get('TWILIO_PHONE_NUMBER'),
        //   to: payload.to
        // });

        this.logger.log('SMS sent via production provider (mock)');
      } else {
        // For development, just log the SMS content
        this.logger.log('SMS sent (development mode):', {
          to: payload.to,
          message: payload.message,
          metadata: payload.metadata,
        });
      }

      this.logger.log(`SMS sent successfully to: ${payload.to}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS: ${error.message}`, error.stack);
      throw error;
    }
  }

  async validatePhoneNumber(phoneNumber: string): Promise<boolean> {
    // Basic phone number validation
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber.replace(/\s+/g, ''));
  }

  private formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters except +
    return phoneNumber.replace(/[^\d+]/g, '');
  }

  async testConnection(): Promise<boolean> {
    try {
      // In production, you would test the SMS provider connection here
      this.logger.log('SMS service connection verified (mock)');
      return true;
    } catch (error) {
      this.logger.error(`SMS service connection failed: ${error.message}`);
      return false;
    }
  }
}
