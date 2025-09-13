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
      service: 'inventory-service',
      version: '1.0.0',
      uptime: Math.floor(checks.uptime) + 's',
      responseTime: responseTime + 'ms',
      checks,
    };
  }

  @Get('live')
  async live() {
    const startTime = Date.now();
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    // Memory leak kontrolü (basit)
    const memoryUsageMB = memUsage.heapUsed / 1024 / 1024;
    const isMemoryHealthy = memoryUsageMB < 500; // 500MB limit

    // Response time kontrolü
    const responseTime = Date.now() - startTime;
    const isResponseTimeHealthy = responseTime < 1000; // 1s limit

    const isAlive = isMemoryHealthy && isResponseTimeHealthy;

    if (!isAlive) {
      throw new HttpException(
        {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          service: 'inventory-service',
          uptime: Math.floor(uptime) + 's',
          memory: {
            used: Math.round(memoryUsageMB) + 'MB',
            healthy: isMemoryHealthy,
          },
          responseTime: {
            value: responseTime + 'ms',
            healthy: isResponseTimeHealthy,
          },
          message: 'Service is not healthy and should be restarted',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      service: 'inventory-service',
      uptime: Math.floor(uptime) + 's',
      memory: {
        used: Math.round(memoryUsageMB) + 'MB',
        total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        healthy: isMemoryHealthy,
      },
      responseTime: {
        value: responseTime + 'ms',
        healthy: isResponseTimeHealthy,
      },
      pid: process.pid,
      message: 'Service is alive and healthy',
    };
  }
}
