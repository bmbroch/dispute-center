import { rateLimiter } from './rate-limiter';

export async function GET(request: Request) {
  const rateLimited = rateLimiter(request);
  if (rateLimited) return rateLimited;

  // Existing GET logic...
}
