'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';

interface LoginSplashScreenProps {
  isOpen: boolean;
  onClose: () => void;
  message: string;
}

interface ValuePropType {
  icon: string;
  title: string;
  description: string;
}

const ValueProp = ({ icon, title, description }: ValuePropType) => (
  <div className="flex items-start space-x-4">
    <div className="text-2xl">{icon}</div>
    <div>
      <h2 className="font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
    </div>
  </div>
);

export default function LoginSplashScreen({ isOpen, onClose, message }: LoginSplashScreenProps) {
  const { signIn } = useAuth();

  const handleSignIn = async () => {
    try {
      await signIn();
      onClose();
    } catch (error) {
      console.error('Failed to sign in:', error);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-gradient-to-br from-[#EE6352]/30 to-[#F79D84]/30"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-md p-8 bg-white/80 backdrop-blur-sm rounded-xl shadow-2xl dark:bg-gray-800/80"
          >
            <div className="flex flex-col items-center space-y-8">
              <div className="text-center space-y-3">
                <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100">
                  Welcome to Subspond
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  {message}
                </p>
              </div>

              <button
                onClick={handleSignIn}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </button>

              <div className="w-full space-y-6">
                <ValueProp
                  icon="📧"
                  title="80% Automated Inquiries"
                  description="Our AI handles the majority of customer emails, freeing up your team."
                />
                <ValueProp
                  icon="🔄"
                  title="Dispute Resolution Autopilot"
                  description="Resolve customer disputes efficiently without manual intervention."
                />
                <ValueProp
                  icon="❓"
                  title="Smart Subscription Support"
                  description="AI-powered responses to subscription queries, tailored to your docs."
                />
              </div>

              <button
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
} 