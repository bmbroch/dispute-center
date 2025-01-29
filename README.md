# SubHub - Subscription Management & Dispute Resolution

SubHub is a Next.js application that helps businesses manage subscriptions and handle customer disputes efficiently using AI-powered responses.

## Features

- 🔄 Automated dispute resolution
- 📧 Email template management
- 🤖 AI-powered response generation
- 📚 Knowledge base for customer communication

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Firebase (Auth & Firestore)
- Vercel AI SDK
- Google OAuth
- Stripe API

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   Create a `.env.local` file with the following variables:

   ```env
   # Firebase Configuration
   NEXT_PUBLIC_FIREBASE_API_KEY=
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
   NEXT_PUBLIC_FIREBASE_APP_ID=
   NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

   # AI Services
   REPLICATE_API_TOKEN=
   ANTHROPIC_API_KEY=
   OPENAI_API_KEY=
   DEEPGRAM_API_KEY=

   # Google OAuth
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=
   NEXT_PUBLIC_GOOGLE_CLIENT_SECRET=
   NEXT_PUBLIC_GOOGLE_REDIRECT_URI=
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REDIRECT_URI=

   # Stripe Configuration
   STRIPE_SECRET_KEY=

   # App URL
   NEXT_PUBLIC_APP_URL=
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

## Deployment

This project is configured for deployment on Vercel. To deploy:

1. Push your code to GitHub
2. Import the repository in Vercel
3. Configure environment variables in Vercel's project settings
4. Deploy!

### Important Deployment Notes

- Update `NEXT_PUBLIC_GOOGLE_REDIRECT_URI` and `GOOGLE_REDIRECT_URI` to your production URL
- Update `NEXT_PUBLIC_APP_URL` to your production URL
- Ensure all API keys are properly set in Vercel's environment variables
- Configure Firebase Authentication to allow your production domain

## License

MIT