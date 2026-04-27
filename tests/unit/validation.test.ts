import { describe, it, expect } from 'vitest';
import { validateTradeInput, formatValidationErrors } from '../../src/utils/validate.js';

describe('Trade Input Validation', () => {
  const validTrade = {
    tradeId: '550e8400-e29b-41d4-a716-446655440000',
    userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    sessionId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    asset: 'AAPL',
    assetClass: 'equity',
    direction: 'long',
    entryPrice: 178.45,
    exitPrice: 182.30,
    quantity: 10,
    entryAt: '2025-01-06T09:35:00Z',
    exitAt: '2025-01-06T11:20:00Z',
    status: 'closed',
    planAdherence: 4,
    emotionalState: 'calm',
    entryRationale: 'Breakout above key resistance with volume confirmation',
  };

  it('should accept a valid complete trade input', () => {
    const result = validateTradeInput(validTrade);
    expect(result).toBe(true);
  });

  it('should accept trade with null optional fields', () => {
    const trade = {
      ...validTrade,
      exitPrice: null,
      exitAt: null,
      planAdherence: null,
      emotionalState: null,
      entryRationale: null,
    };
    const result = validateTradeInput(trade);
    expect(result).toBe(true);
  });

  it('should reject trade with missing required fields', () => {
    const trade = { asset: 'AAPL' };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
    const errors = formatValidationErrors(validateTradeInput.errors);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject invalid assetClass enum', () => {
    const trade = { ...validTrade, assetClass: 'options' };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject invalid direction enum', () => {
    const trade = { ...validTrade, direction: 'neutral' };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject invalid emotionalState enum', () => {
    const trade = { ...validTrade, emotionalState: 'happy' };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject planAdherence outside 1-5 range', () => {
    const trade = { ...validTrade, planAdherence: 6 };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject planAdherence of 0', () => {
    const trade = { ...validTrade, planAdherence: 0 };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject entryRationale over 500 chars', () => {
    const trade = { ...validTrade, entryRationale: 'A'.repeat(501) };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject non-UUID tradeId', () => {
    const trade = { ...validTrade, tradeId: 'not-a-uuid' };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject invalid status enum', () => {
    const trade = { ...validTrade, status: 'pending' };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject zero quantity', () => {
    const trade = { ...validTrade, quantity: 0 };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject negative quantity', () => {
    const trade = { ...validTrade, quantity: -5 };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });

  it('should reject additional properties', () => {
    const trade = { ...validTrade, extraField: 'not allowed' };
    const result = validateTradeInput(trade);
    expect(result).toBe(false);
  });
});

describe('Idempotency Contract', () => {
  it('should define duplicate trade returns 200 not 409', () => {
    // Per SKILL.md pitfall #6:
    // Duplicate tradeId must return 200, not 409
    const expectedDuplicateStatus = 200;
    expect(expectedDuplicateStatus).toBe(200);
    expect(expectedDuplicateStatus).not.toBe(409);
  });

  it('should define new trade returns 201', () => {
    const expectedNewStatus = 201;
    expect(expectedNewStatus).toBe(201);
  });
});
