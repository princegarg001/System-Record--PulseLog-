import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('error_rate');
const tradeDuration = new Trend('trade_duration');

// SLA thresholds per SKILL.md
export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 500,
      stages: [
        { target: 200, duration: '2m' },  // ramp up
        { target: 200, duration: '1m' },  // sustain (required)
        { target: 0, duration: '30s' },   // ramp down
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],       // < 1% error rate
    http_req_duration: ['p(95)<150'],      // p95 write latency <= 150ms ← PRIMARY SLA
    'http_req_duration{scenario:ramp_up}': ['p(99)<300'],  // p99 safety net
    checks: ['rate>0.99'],                // > 99% check pass rate
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:4010';
const JWT_TOKEN = __ENV.JWT_TOKEN || '';

// Test user IDs from seed data
const USER_IDS = [
  'f412f236-4edc-47a2-8f54-8763a6ed2ce8',
  'fcd434aa-2201-4060-aeb2-f44c77aa0683',
  '84a6a3dd-f2d0-4167-960b-7319a6033d49',
  '4f2f0816-f350-4684-b6c3-29bbddbb1869',
  'e84ea28c-e5a7-49ef-ac26-a873e32667bd',
];

const ASSETS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'BTC/USD', 'ETH/USD', 'EUR/USD'];
const ASSET_CLASSES = ['equity', 'equity', 'equity', 'equity', 'equity', 'crypto', 'crypto', 'forex'];
const DIRECTIONS = ['long', 'short'];
const EMOTIONS = ['calm', 'anxious', 'greedy', 'fearful', 'neutral'];

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  const userId = randomElement(USER_IDS);
  const assetIdx = Math.floor(Math.random() * ASSETS.length);
  const asset = ASSETS[assetIdx];
  const assetClass = ASSET_CLASSES[assetIdx];

  const tradePayload = {
    tradeId: generateUUID(),
    userId: userId,
    sessionId: generateUUID(),
    asset: asset,
    assetClass: assetClass,
    direction: randomElement(DIRECTIONS),
    entryPrice: 100 + Math.random() * 400,
    exitPrice: 100 + Math.random() * 400,
    quantity: Math.round(Math.random() * 50) + 1,
    entryAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    exitAt: new Date().toISOString(),
    status: 'closed',
    planAdherence: Math.floor(Math.random() * 5) + 1,
    emotionalState: randomElement(EMOTIONS),
    entryRationale: 'k6 load test trade',
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'X-Trace-Id': generateUUID(),
  };

  // POST /trades — primary write path
  const startTime = Date.now();
  const res = http.post(`${API_URL}/trades`, JSON.stringify(tradePayload), { headers });
  const duration = Date.now() - startTime;

  tradeDuration.add(duration);

  const isSuccess = check(res, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'response has tradeId': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.tradeId !== undefined;
      } catch {
        return false;
      }
    },
    'response time < 150ms': (r) => r.timings.duration < 150,
  });

  errorRate.add(!isSuccess);

  // Occasionally test read paths (10% of requests)
  if (Math.random() < 0.1) {
    const metricsRes = http.get(
      `${API_URL}/users/${userId}/metrics?from=2025-01-01T00:00:00Z&to=2025-12-31T23:59:59Z&granularity=daily`,
      { headers }
    );

    check(metricsRes, {
      'metrics status is 200': (r) => r.status === 200,
    });
  }

  // Health check (5% of requests)
  if (Math.random() < 0.05) {
    const healthRes = http.get(`${API_URL}/health`);
    check(healthRes, {
      'health status is 200': (r) => r.status === 200,
    });
  }

  sleep(0.01); // 10ms think time
}
