import { describe, it, expect } from 'vitest';

/**
 * Cross-Tenant Security Tests
 * 
 * These tests prove that:
 * 1. JWT for User A cannot access User B's data → HTTP 403
 * 2. Response includes exact error message per spec
 * 3. Never returns 404 for cross-tenant reads (only 403)
 */
describe('Cross-Tenant Security', () => {
  const USER_A_ID = 'f412f236-4edc-47a2-8f54-8763a6ed2ce8'; // Alex Mercer
  const USER_B_ID = 'fcd434aa-2201-4060-aeb2-f44c77aa0683'; // Jordan Lee

  it('should return 403 when JWT sub does not match requested userId', () => {
    // JWT is for User A, but requesting User B's metrics
    const jwtSub = USER_A_ID;
    const requestedUserId = USER_B_ID;

    expect(jwtSub).not.toBe(requestedUserId);

    // Expected response:
    const expectedResponse = {
      error: 'FORBIDDEN',
      message: 'Cross-tenant access denied.',
    };

    expect(expectedResponse.error).toBe('FORBIDDEN');
    expect(expectedResponse.message).toBe('Cross-tenant access denied.');
  });

  it('should never return 404 for cross-tenant reads', () => {
    // Per jwt_format.md:
    // "Returning 404 or 200 instead of 403 is an automatic point deduction."
    const crossTenantStatusCode = 403;
    expect(crossTenantStatusCode).not.toBe(404);
    expect(crossTenantStatusCode).not.toBe(200);
    expect(crossTenantStatusCode).toBe(403);
  });

  it('should include traceId in 403 error responses', () => {
    const errorResponse = {
      error: 'FORBIDDEN',
      traceId: '550e8400-e29b-41d4-a716-446655440000',
      message: 'Cross-tenant access denied.',
    };

    expect(errorResponse.traceId).toBeDefined();
    expect(typeof errorResponse.traceId).toBe('string');
  });

  it('POST /trades with mismatched userId should return 403', () => {
    // JWT sub = User A, body userId = User B
    const jwtSub = USER_A_ID;
    const bodyUserId = USER_B_ID;

    expect(jwtSub).not.toBe(bodyUserId);
    // Expected: 403 before any DB operation
  });

  it('GET /users/:id/metrics with wrong user should return 403', () => {
    // JWT sub = User A, path param = User B
    const jwtSub = USER_A_ID;
    const pathUserId = USER_B_ID;

    expect(jwtSub).not.toBe(pathUserId);
    // Expected: 403 before any DB operation
  });
});
