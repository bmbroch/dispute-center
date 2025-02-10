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
import { Dialog } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';

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
  const [faqs, setFaqs] = useState<FAQ[]>(mockFaqs);
  const [pendingReplies, setPendingReplies] = useState<PendingAutoReply[]>([]);
  const [showAddFAQModal, setShowAddFAQModal] = useState(false);
  const [newFAQ, setNewFAQ] = useState({ question: '', replyTemplate: '' });
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);

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
        receivedAt: new Date().toISOString(),
        threadId: uuidv4(),
        hasImages: false,
        date: new Date().toISOString(),
      },
      generatedReply: result.matches[0].suggestedReply,
      confidence: result.matches[0].confidence,
      status: 'pending',
      requiresHumanResponse: result.requiresHumanResponse,
      reason: result.reason,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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

  const handleAddNewFAQ = (faq: { question: string; answer: string }) => {
    const newFaqEntry: FAQ = {
      id: uuidv4(),
      question: faq.question.replace(/<[^>]*>/g, ''),
      replyTemplate: faq.answer.replace(/<[^>]*>/g, ''),
      instructions: 'Maintain a professional and helpful tone.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confidence: 0,
      useCount: 0
    };

    setFaqs(prev => [...prev, newFaqEntry]);
    toast.success('New FAQ template added successfully! 📝');
  };

  const handleManualAddFAQ = () => {
    if (!newFAQ.question.trim() || !newFAQ.replyTemplate.trim()) {
      toast.error('Please fill in both question and answer fields');
      return;
    }

    if (editingFaqId) {
      // Update existing FAQ
      setFaqs(prev => prev.map(faq => 
        faq.id === editingFaqId
          ? {
              ...faq,
              question: newFAQ.question.replace(/<[^>]*>/g, ''),
              replyTemplate: newFAQ.replyTemplate.replace(/<[^>]*>/g, ''),
              updatedAt: new Date().toISOString()
            }
          : faq
      ));
      toast.success('FAQ template updated successfully! ✏️');
    } else {
      // Add new FAQ
      const newFaqEntry: FAQ = {
        id: uuidv4(),
        question: newFAQ.question.replace(/<[^>]*>/g, ''),
        replyTemplate: newFAQ.replyTemplate.replace(/<[^>]*>/g, ''),
        instructions: 'Maintain a professional and helpful tone.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: 0,
        useCount: 0
      };
      setFaqs(prev => [...prev, newFaqEntry]);
      toast.success('New FAQ template added successfully! 📝');
    }

    setNewFAQ({ question: '', replyTemplate: '' });
    setEditingFaqId(null);
    setShowAddFAQModal(false);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8 text-gray-900">FAQ Auto Reply</h1>
        
        <div className="grid grid-cols-1 gap-8">
          <ConfidenceThresholdControl
            value={confidenceThreshold}
            onChange={handleConfidenceChange}
          />
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b">
                <h3 className="text-lg font-semibold text-gray-900">FAQ Templates</h3>
              </div>
              <div className="p-6">
                <button 
                  onClick={() => setShowAddFAQModal(true)}
                  className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  Add New FAQ
                </button>
                <div className="mt-4">
                  {faqs.length > 0 ? (
                    <div className="space-y-4">
                      {faqs.map((faq) => (
                        <div key={faq.id} className="border rounded-lg p-4">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium text-gray-900">{faq.question.replace(/<[^>]*>/g, '')}</h4>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setNewFAQ({
                                    question: faq.question.replace(/<[^>]*>/g, ''),
                                    replyTemplate: faq.replyTemplate
                                  });
                                  setEditingFaqId(faq.id);
                                  setShowAddFAQModal(true);
                                }}
                                className="text-blue-600 hover:text-blue-700 p-1"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => {
                                  const shouldDelete = window.confirm('Are you sure you want to delete this FAQ?');
                                  if (shouldDelete) {
                                    setFaqs(prev => prev.filter(f => f.id !== faq.id));
                                    toast.success('FAQ template deleted successfully');
                                  }
                                }}
                                className="text-red-600 hover:text-red-700 p-1"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="text-sm text-gray-600 mb-2">
                            <div className="font-medium text-gray-700 mb-1">Answer:</div>
                            <div className="pl-2 border-l-2 border-gray-200">
                              {faq.replyTemplate.replace(/<[^>]*>/g, '')}
                            </div>
                          </div>
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
              confidenceThreshold={confidenceThreshold}
              onAddNewFAQ={handleAddNewFAQ}
              existingFaqs={faqs}
            />
          </div>
          
          <PendingReplies
            pendingReplies={pendingReplies}
            onSend={handleSend}
            onEdit={handleEdit}
          />
        </div>

        {/* Add FAQ Modal */}
        <Dialog
          open={showAddFAQModal}
          onClose={() => setShowAddFAQModal(false)}
          className="relative z-50"
        >
          <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
          
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="mx-auto max-w-2xl w-full rounded-lg bg-white p-6 shadow-xl">
              <div className="flex justify-between items-start mb-4">
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  {editingFaqId ? 'Edit FAQ Template' : 'Add New FAQ Template'}
                </Dialog.Title>
                <button
                  onClick={() => setShowAddFAQModal(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Question
                  </label>
                  <textarea
                    value={newFAQ.question}
                    onChange={(e) => setNewFAQ(prev => ({ ...prev, question: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    rows={3}
                    placeholder="Enter the frequently asked question"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Answer Template
                  </label>
                  <textarea
                    value={newFAQ.replyTemplate}
                    onChange={(e) => setNewFAQ(prev => ({ ...prev, replyTemplate: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    rows={5}
                    placeholder="Enter the answer template"
                  />
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => setShowAddFAQModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleManualAddFAQ}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    {editingFaqId ? 'Update Template' : 'Add Template'}
                  </button>
                </div>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      </div>
    </Layout>
  );
} 