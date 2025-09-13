import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

interface EmailPayload {
  to: string;
  subject: string;
  message: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    // For development/testing, use mock transport (no actual email sending)
    if (this.configService.get('NODE_ENV') === 'production') {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get('SMTP_HOST'),
        port: this.configService.get('SMTP_PORT', 587),
        secure: false,
        auth: {
          user: this.configService.get('SMTP_USER'),
          pass: this.configService.get('SMTP_PASS'),
        },
      });
    } else {
      // For development, use mock transport (no actual sending)
      this.transporter = nodemailer.createTransport({
        jsonTransport: true,
      });
    }
  }

  async sendEmail(payload: EmailPayload): Promise<void> {
    try {
      this.logger.log(`Sending email to: ${payload.to}`);

      // For development, just log the email instead of sending
      if (this.configService.get('NODE_ENV') !== 'production') {
        this.logger.log('📧 EMAIL MOCK - Email content:');
        this.logger.log(`📧 To: ${payload.to}`);
        this.logger.log(`📧 Subject: ${payload.subject}`);
        this.logger.log(`📧 Message: ${payload.message}`);
        this.logger.log('📧 Email sent successfully (mock)');
        return;
      }

      const mailOptions = {
        from: this.configService.get('SMTP_FROM', 'noreply@ecommerce.com'),
        to: payload.to,
        subject: payload.subject,
        text: payload.message,
        html: this.formatHtmlMessage(payload.message, payload.metadata),
      };

      if (this.configService.get('NODE_ENV') === 'production') {
        const result = await this.transporter.sendMail(mailOptions);
        this.logger.log(`Email sent successfully: ${result.messageId}`);
      } else {
        // For development, just log the email content
        this.logger.log('Email sent (development mode):', {
          to: payload.to,
          subject: payload.subject,
          message: payload.message,
          metadata: payload.metadata,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
      throw error;
    }
  }

  private formatHtmlMessage(message: string, metadata?: Record<string, any>): string {
    let html = `
      <html>
        <body>
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">E-commerce Notification</h2>
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px;">
              <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
    `;

    if (metadata) {
      html += `
        <div style="margin-top: 20px; padding: 15px; background-color: #e9e9e9; border-radius: 5px;">
          <h4>Additional Information:</h4>
          <ul>
      `;

      Object.entries(metadata).forEach(([key, value]) => {
        html += `<li><strong>${key}:</strong> ${value}</li>`;
      });

      html += `
          </ul>
        </div>
      `;
    }

    html += `
            <div style="margin-top: 30px; text-align: center; color: #666; font-size: 12px;">
              <p>This is an automated message from E-commerce System</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return html;
  }

  async testConnection(): Promise<boolean> {
    try {
      if (this.configService.get('NODE_ENV') === 'production') {
        await this.transporter.verify();
      }
      this.logger.log('Email service connection verified');
      return true;
    } catch (error) {
      this.logger.error(`Email service connection failed: ${error.message}`);
      return false;
    }
  }
}
