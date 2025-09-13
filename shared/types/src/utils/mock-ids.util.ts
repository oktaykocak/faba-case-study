// Mock Admin UUID'leri - Gerçek uygulamada JWT'den gelecek
const MOCK_ADMIN_IDS = [
  '550e8400-e29b-41d4-a716-446655440001',
  '550e8400-e29b-41d4-a716-446655440002',
  '550e8400-e29b-41d4-a716-446655440003',
  '550e8400-e29b-41d4-a716-446655440004',
  '550e8400-e29b-41d4-a716-446655440005',
];

// Mock Customer UUID'leri - Gerçek uygulamada JWT'den gelecek
const MOCK_CUSTOMER_IDS = [
  '123e4567-e89b-12d3-a456-426614174001',
  '123e4567-e89b-12d3-a456-426614174002',
  '123e4567-e89b-12d3-a456-426614174003',
  '123e4567-e89b-12d3-a456-426614174004',
  '123e4567-e89b-12d3-a456-426614174005',
  '123e4567-e89b-12d3-a456-426614174006',
  '123e4567-e89b-12d3-a456-426614174007',
  '123e4567-e89b-12d3-a456-426614174008',
  '123e4567-e89b-12d3-a456-426614174009',
  '123e4567-e89b-12d3-a456-426614174010',
];

/**
 * Mock admin ID'lerinden rastgele birini seçer
 * Gerçek uygulamada JWT token'dan admin ID alınacak
 */
export function getRandomMockAdminId(): string {
  const randomIndex = Math.floor(Math.random() * MOCK_ADMIN_IDS.length);
  return MOCK_ADMIN_IDS[randomIndex];
}

/**
 * Mock customer ID'lerinden rastgele birini seçer
 * Gerçek uygulamada JWT token'dan customer ID alınacak
 */
export function getRandomMockCustomerId(): string {
  const randomIndex = Math.floor(Math.random() * MOCK_CUSTOMER_IDS.length);
  return MOCK_CUSTOMER_IDS[randomIndex];
}

/**
 * Tüm mock admin ID'lerini döner
 */
export function getAllMockAdminIds(): string[] {
  return [...MOCK_ADMIN_IDS];
}

/**
 * Tüm mock customer ID'lerini döner
 */
export function getAllMockCustomerIds(): string[] {
  return [...MOCK_CUSTOMER_IDS];
}

/**
 * Verilen ID'nin mock admin ID'si olup olmadığını kontrol eder
 */
export function isMockAdminId(adminId: string): boolean {
  return MOCK_ADMIN_IDS.includes(adminId);
}

/**
 * Verilen ID'nin mock customer ID'si olup olmadığını kontrol eder
 */
export function isMockCustomerId(customerId: string): boolean {
  return MOCK_CUSTOMER_IDS.includes(customerId);
}
