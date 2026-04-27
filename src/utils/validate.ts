import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, coerceTypes: false, useDefaults: true });
addFormats(ajv);

// Trade input validation schema — matches OpenAPI TradeInput exactly
const tradeInputSchema = {
  type: 'object',
  required: [
    'tradeId', 'userId', 'sessionId', 'asset', 'assetClass',
    'direction', 'entryPrice', 'quantity', 'entryAt', 'status',
  ],
  properties: {
    tradeId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    sessionId: { type: 'string', format: 'uuid' },
    asset: { type: 'string', minLength: 1 },
    assetClass: { type: 'string', enum: ['equity', 'crypto', 'forex'] },
    direction: { type: 'string', enum: ['long', 'short'] },
    entryPrice: { type: 'number' },
    exitPrice: { type: ['number', 'null'] },
    quantity: { type: 'number', exclusiveMinimum: 0 },
    entryAt: { type: 'string', format: 'date-time' },
    exitAt: { type: ['string', 'null'], format: 'date-time' },
    status: { type: 'string', enum: ['open', 'closed', 'cancelled'] },
    planAdherence: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
    emotionalState: {
      type: ['string', 'null'],
      enum: ['calm', 'anxious', 'greedy', 'fearful', 'neutral', null],
    },
    entryRationale: { type: ['string', 'null'], maxLength: 500 },
  },
  additionalProperties: false,
};

export const validateTradeInput = ajv.compile(tradeInputSchema);

// Metrics query params validation
const metricsQuerySchema = {
  type: 'object',
  required: ['from', 'to', 'granularity'],
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    granularity: { type: 'string', enum: ['hourly', 'daily', 'rolling30d'] },
  },
};

export const validateMetricsQuery = ajv.compile(metricsQuerySchema);

// Debrief input validation
const debriefInputSchema = {
  type: 'object',
  required: ['overallMood', 'planAdherenceRating'],
  properties: {
    overallMood: { type: 'string', enum: ['calm', 'anxious', 'greedy', 'fearful', 'neutral'] },
    keyMistake: { type: ['string', 'null'], maxLength: 1000 },
    keyLesson: { type: ['string', 'null'], maxLength: 1000 },
    planAdherenceRating: { type: 'integer', minimum: 1, maximum: 5 },
    willReviewTomorrow: { type: 'boolean' },
  },
  additionalProperties: false,
};

export const validateDebriefInput = ajv.compile(debriefInputSchema);

export function formatValidationErrors(errors: typeof validateTradeInput.errors) {
  if (!errors) return [];
  return errors.map((err) => ({
    field: err.instancePath.replace('/', '') || err.params?.['missingProperty'] || 'unknown',
    msg: err.message || 'Invalid value',
  }));
}
