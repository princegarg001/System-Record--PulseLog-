// OpenTelemetry setup — vendor-neutral tracing
// For hackathon scope, we implement trace ID propagation via headers
// Full OTel SDK can be added later for production export

import { v4 as uuidv4 } from 'uuid';

export function getTraceId(headerValue?: string): string {
  if (headerValue && typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue;
  }
  return uuidv4();
}
