import { Controller, Get, HttpStatus, HttpException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async check() {
    const startTime = Date.now();
    const checks: any = {
      database: 'unknown',
      memory: 'unknown',
      uptime: process.uptime(),
    };

    try {
      // Database bağlantı kontrolü
      await this.dataSource.query('SELECT 1');
      checks.database = 'connected';
    } catch (error) {
      checks.database = 'disconnected';
    }

    // Memory kullanımı
    const memUsage = process.memoryUsage();
    checks.memory = {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
    };

    const responseTime = Date.now() - startTime;
    const isHealthy = checks.database === 'connected';

    return {
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      service: 'order-service',
      version: '1.0.0',
      uptime: Math.floor(checks.uptime) + 's',
      responseTime: responseTime + 'ms',
      checks,
    };
  }

  @Get('live')
  async live() {
    const startTime = Date.now();
    const checks: any = {
      database: 'unknown',
      memory: 'unknown',
      uptime: process.uptime(),
    };

    try {
      // Basit database ping
      await this.dataSource.query('SELECT 1');
      checks.database = 'connected';
    } catch (error) {
      checks.database = 'disconnected';
      throw new HttpException(
        {
          status: 'error',
          timestamp: new Date().toISOString(),
          service: 'order-service',
          error: 'Database connection failed',
          checks,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Memory kullanımı
    const memUsage = process.memoryUsage();
    checks.memory = {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
    };

    const responseTime = Date.now() - startTime;

    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      service: 'order-service',
      version: '1.0.0',
      uptime: Math.floor(checks.uptime) + 's',
      responseTime: responseTime + 'ms',
      checks,
    };
  }
}
