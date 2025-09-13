import { getConnection } from 'typeorm';

export default async function globalTeardown() {
  console.log('🧹 Cleaning up test environment...');

  try {
    const connection = getConnection();

    if (connection && connection.isConnected) {
      await connection.close();
      console.log('✅ Test database connection closed');
    }

    console.log('✅ Test environment cleanup complete');
  } catch (error) {
    console.error('❌ Failed to cleanup test environment:', error);
  }
}
