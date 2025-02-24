import { NextResponse } from 'next/server';

const RATE_LIMIT = {
  windowMs: 30 * 1000, // 30 seconds
  max: 5 // Max 5 requests per window
};

const requests = new Map<string, number>();

export function rateLimiter(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
  const current = requests.get(ip) || 0;

  if (current >= RATE_LIMIT.max) {
    return NextResponse.json(
      { error: 'Too many requests, please try again later' },
      { status: 429 }
    );
  }

  requests.set(ip, current + 1);
  setTimeout(() => {
    requests.delete(ip);
  }, RATE_LIMIT.windowMs);
}
