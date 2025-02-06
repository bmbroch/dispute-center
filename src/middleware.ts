import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Get the user's auth token from cookies
  const authSession = request.cookies.get('auth');

  // Check if the user is accessing the knowledge page
  if (request.nextUrl.pathname.startsWith('/knowledge')) {
    if (!authSession) {
      // Create the URL for the current page
      const url = new URL(request.url);
      const searchParams = new URLSearchParams(url.search);
      
      // Add a redirect parameter
      searchParams.set('redirect', request.nextUrl.pathname);
      
      // Redirect to home page with the redirect parameter
      return NextResponse.redirect(new URL(`/?${searchParams.toString()}`, request.url));
    }
  }

  return NextResponse.next();
}

// Configure which routes to run middleware on
export const config = {
  matcher: ['/knowledge/:path*']
}; 