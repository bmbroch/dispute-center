import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Get the pathname of the request
  const path = request.nextUrl.pathname;

  // Define protected routes that require authentication
  const protectedRoutes = ['/dispute'];

  // Check if the current path is a protected route
  const isProtectedRoute = protectedRoutes.some(route => path.startsWith(route));

  // Get the authentication status from cookies
  const authSession = request.cookies.get('auth')?.value;

  // If it's a protected route and user is not authenticated
  if (isProtectedRoute && !authSession) {
    // Create the URL for the current page
    const url = new URL(request.url);
    const searchParams = new URLSearchParams(url.search);
    
    // Add a redirect parameter
    searchParams.set('redirect', path);
    
    // Redirect to home page with the redirect parameter
    const response = NextResponse.redirect(new URL(`/?${searchParams.toString()}`, request.url));
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}; 