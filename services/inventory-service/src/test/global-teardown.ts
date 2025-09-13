import { getConnection } from 'typeorm';

export default async function globalTeardown() {
  console.log('🧹 Cleaning up inventory test environment...');

  try {
    const connection = getConnection();

    if (connection && connection.isConnected) {
      await connection.close();
      console.log('✅ Inventory test database connection closed');
    }

    console.log('✅ Inventory test environment cleanup complete');
  } catch (error) {
    console.error('❌ Failed to cleanup inventory test environment:', error);
  }
}
