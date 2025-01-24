'use client';

import { useEffect } from 'react';
import SignInWithGoogle from './SignInWithGoogle';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';

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

interface LoginSplashScreenProps {
  isOpen: boolean;
  onClose: () => void;
  message?: string;
}

export default function LoginSplashScreen({
  isOpen,
  onClose,
  message = 'Sign in to automate customer inquiries ⁉️ & get back to building ⚙️',
}: LoginSplashScreenProps) {
  const { user } = useAuth();

  // Close the splash screen if user becomes authenticated
  useEffect(() => {
    if (user) {
      onClose();
    }
  }, [user, onClose]);

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

              <div className="flex justify-center w-full">
                <SignInWithGoogle />
              </div>

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