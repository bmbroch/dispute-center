'use client';

import React, { useState, useEffect } from 'react';
import { EmailSimulator } from './components/EmailSimulator';
import { ConfidenceThresholdControl } from './components/ConfidenceThresholdControl';
import { PendingReplies } from './components/PendingReplies';
import { FAQ, PendingAutoReply, EmailSimulationResult } from '@/types/faq';
import { Layout } from '../components/Layout';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '@/lib/hooks/useAuth';
import toast from 'react-hot-toast';

// Temporary mock data - using ISO strings to avoid hydration errors
const mockFaqs: FAQ[] = [
  {
    id: '1',
    question: 'How do I reset my password?',
    replyTemplate: 'To reset your password, please follow these steps:\n1. Click on the "Forgot Password" link\n2. Enter your email address\n3. Follow the instructions in the email we send you',
    instructions: 'Make sure to maintain a friendly tone and offer additional help if needed.',
    createdAt: '2024-02-07T00:00:00.000Z',
    updatedAt: '2024-02-07T00:00:00.000Z',
    confidence: 0,
    useCount: 0
  },
  // Add more mock FAQs as needed
];

export default function FAQAutoReplyPage() {
  const { user } = useAuth();
  const [confidenceThreshold, setConfidenceThreshold] = useState(80);
  const [faqs] = useState<FAQ[]>(mockFaqs);
  const [pendingReplies, setPendingReplies] = useState<PendingAutoReply[]>([]);

  // Load user settings when component mounts
  useEffect(() => {
    async function loadUserSettings() {
      if (!user?.email) return;

      try {
        const response = await fetch('/api/settings/user', {
          headers: {
            'x-user-email': user.email,
          },
        });

        if (response.ok) {
          const settings = await response.json();
          setConfidenceThreshold(settings.confidenceThreshold);
        }
      } catch (error) {
        console.error('Error loading user settings:', error);
      }
    }

    loadUserSettings();
  }, [user?.email]);

  // Save confidence threshold when it changes
  const handleConfidenceChange = async (value: number) => {
    setConfidenceThreshold(value);
    if (!user?.email) return;

    try {
      const response = await fetch('/api/settings/user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': user.email,
        },
        body: JSON.stringify({
          confidenceThreshold: value,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving confidence threshold:', error);
      toast.error('Failed to save confidence threshold');
    }
  };

  const handleSimulationResult = (result: EmailSimulationResult, emailContent: string) => {
    // Only add to pending replies if confidence is below threshold
    // or if human response is explicitly required
    if (result.matches.length === 0) {
      return;
    }

    const newReply: PendingAutoReply = {
      id: uuidv4(),
      originalEmail: {
        from: user?.email || 'simulation@example.com',
        subject: 'Test Email',
        body: emailContent,
        date: new Date().toISOString(),
        hasImages: false,
      },
      generatedReply: result.matches[0].suggestedReply,
      confidence: result.matches[0].confidence,
      status: 'pending',
      requiresHumanResponse: result.requiresHumanResponse,
      reason: result.reason,
    };

    setPendingReplies((prev) => [newReply, ...prev]);
  };

  const handleSend = (replyId: string) => {
    setPendingReplies((prev) =>
      prev.filter((reply) => reply.id !== replyId)
    );
    toast.success('Email sent successfully! 📧');
  };

  const handleEdit = (replyId: string, updatedReply: string) => {
    setPendingReplies((prev) =>
      prev.map((reply) =>
        reply.id === replyId
          ? { ...reply, generatedReply: updatedReply }
          : reply
      )
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">FAQ Auto Reply</h1>
        
        <div className="grid grid-cols-1 gap-8">
          <ConfidenceThresholdControl
            value={confidenceThreshold}
            onChange={handleConfidenceChange}
          />
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b">
                <h3 className="text-lg font-semibold">FAQ Templates</h3>
              </div>
              <div className="p-6">
                <button className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                  Add New FAQ
                </button>
                <div className="mt-4">
                  {faqs.length > 0 ? (
                    <div className="space-y-4">
                      {faqs.map((faq) => (
                        <div key={faq.id} className="border rounded-lg p-4">
                          <h4 className="font-medium mb-2">{faq.question}</h4>
                          <p className="text-sm text-gray-600">
                            {faq.replyTemplate.substring(0, 100)}...
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-500 italic">No FAQ templates yet</div>
                  )}
                </div>
              </div>
            </div>

            <EmailSimulator
              onSimulationResult={handleSimulationResult}
            />
          </div>
          
          <PendingReplies
            pendingReplies={pendingReplies}
            onSend={handleSend}
            onEdit={handleEdit}
          />
        </div>
      </div>
    </Layout>
  );
} 