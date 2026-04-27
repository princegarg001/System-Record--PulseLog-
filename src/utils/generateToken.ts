import crypto from 'crypto';

const SIGNING_SECRET = process.env.JWT_SECRET || '97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02';

function base64url(str: string): string {
  return Buffer.from(str).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJWT(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sigData = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SIGNING_SECRET)
    .update(sigData).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${sigData}.${sig}`;
}

// Generate tokens for all 10 seed users
const users = [
  { id: 'f412f236-4edc-47a2-8f54-8763a6ed2ce8', name: 'Alex Mercer' },
  { id: 'fcd434aa-2201-4060-aeb2-f44c77aa0683', name: 'Jordan Lee' },
  { id: '84a6a3dd-f2d0-4167-960b-7319a6033d49', name: 'Sam Rivera' },
  { id: '4f2f0816-f350-4684-b6c3-29bbddbb1869', name: 'Casey Kim' },
  { id: '75076413-e8e8-44ac-861f-c7acb3902d6d', name: 'Morgan Bell' },
  { id: '8effb0f2-f16b-4b5f-87ab-7ffca376f309', name: 'Taylor Grant' },
  { id: '50dd1053-73b0-43c5-8d0f-d2af88c01451', name: 'Riley Stone' },
  { id: 'af2cfc5e-c132-4989-9c12-2913f89271fb', name: 'Drew Patel' },
  { id: '9419073a-3d58-4ee6-a917-be2d40aecef2', name: 'Quinn Torres' },
  { id: 'e84ea28c-e5a7-49ef-ac26-a873e32667bd', name: 'Avery Chen' },
];

const now = Math.floor(Date.now() / 1000);

console.log('=== NevUp JWT Tokens (24h expiry) ===\n');

for (const user of users) {
  const token = signJWT({
    sub: user.id,
    iat: now,
    exp: now + 86400,
    role: 'trader',
    name: user.name,
  });
  console.log(`${user.name} (${user.id}):`);
  console.log(`  ${token}\n`);
}
