'use client';

import React, { useState, useEffect } from 'react';
import { EmailSimulator } from './components/EmailSimulator';
import { ConfidenceThresholdControl } from './components/ConfidenceThresholdControl';
import { PendingReplies } from './components/PendingReplies';
import { FAQ, PendingAutoReply, EmailSimulationResult } from '@/types/faq';
import { Layout } from '../components/Layout';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '@/lib/hooks/useAuth';
import { toast } from 'sonner';
import { Dialog } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';

// Move mockFaqs outside the component
const mockFaqs: FAQ[] = [
  {
    id: '1',
    question: 'How do I reset my password?',
    answer: 'To reset your password, please follow these steps:\n1. Click on the "Forgot Password" link\n2. Enter your email address\n3. Follow the instructions in the email we send you',
    replyTemplate: 'To reset your password, please follow these steps:\n1. Click on the "Forgot Password" link\n2. Enter your email address\n3. Follow the instructions in the email we send you',
    category: 'account',
    confidence: 1,
    useCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    emailIds: [],
    requiresCustomerSpecificInfo: false
  },
  // Add more mock FAQs as needed
];

// Add new interface for settings
interface AutoReplySettings {
  confidenceThreshold: number;
  emailFormatting: {
    greeting: string;
    listStyle: 'numbered' | 'bullet';
    spacing: 'compact' | 'normal' | 'spacious';
    signatureStyle: string;
    customPrompt: string;
  };
}

const DEFAULT_SETTINGS: AutoReplySettings = {
  confidenceThreshold: 80,
  emailFormatting: {
    greeting: "Hi [Name]!",
    listStyle: 'numbered',
    spacing: 'normal',
    signatureStyle: "Best,\n[Name]",
    customPrompt: "Please keep responses friendly but professional. Use proper spacing between paragraphs and lists."
  }
};

export default function FAQAutoReplyPage() {
  const { user } = useAuth();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settings, setSettings] = useState<AutoReplySettings>(DEFAULT_SETTINGS);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [pendingReplies, setPendingReplies] = useState<PendingAutoReply[]>([]);
  const [showAddFAQModal, setShowAddFAQModal] = useState(false);
  const [newFAQ, setNewFAQ] = useState({ question: '', replyTemplate: '' });
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  const [showUploadDatasetModal, setShowUploadDatasetModal] = useState(false);
  const [datasetText, setDatasetText] = useState('');
  const [generatedQAs, setGeneratedQAs] = useState<{ question: string; answer: string; isEditing?: boolean }[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Load FAQs from localStorage on mount
  useEffect(() => {
    const savedFaqs = localStorage.getItem('faqs');
    if (savedFaqs) {
      setFaqs(JSON.parse(savedFaqs));
    } else {
      setFaqs(mockFaqs);
      localStorage.setItem('faqs', JSON.stringify(mockFaqs));
    }
  }, []);

  // Update localStorage whenever FAQs change
  useEffect(() => {
    localStorage.setItem('faqs', JSON.stringify(faqs));
  }, [faqs]);

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
          setSettings(settings);
        }
      } catch (error) {
        console.error('Error loading user settings:', error);
      }
    }

    loadUserSettings();
  }, [user?.email]);

  // Save all settings
  const handleSaveSettings = async () => {
    if (!user?.email) {
      toast.error('Please sign in to save settings');
      return;
    }

    try {
      const response = await fetch('/api/settings/user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': user.email,
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      const result = await response.json();
      if (result.success) {
        toast.success('Settings saved successfully! ⚙️', {
          duration: 4000,
          position: 'top-center',
          style: { background: '#fff' },
          className: 'border-green-500',
          descriptionClassName: 'text-gray-500',
          closeButton: true
        });
        setShowSettingsModal(false);
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings. Please try again.');
    }
  };

  const handleSimulationResult = (result: EmailSimulationResult, emailContent: string) => {
    // Always add to pending replies if there's a match, regardless of confidence
    // since we want to track all potential auto-replies
    if (result.matches.length > 0) {
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
        matchedFAQ: result.matches[0].faq,
        generatedReply: result.matches[0].suggestedReply,
        confidence: result.matches[0].confidence,
        status: 'pending',
        requiresHumanResponse: result.requiresHumanResponse,
        reason: result.reason,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setPendingReplies((prev) => [newReply, ...prev]);
      toast.success('Added to pending replies', {
        duration: 4000,
        position: 'top-center',
        style: { background: '#fff' },
        className: 'border-green-500',
        descriptionClassName: 'text-gray-500',
        closeButton: true
      });
    }
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
      question: faq.question.trim(),
      answer: faq.answer.trim(),
      replyTemplate: faq.answer.trim(),
      instructions: 'Maintain a professional and helpful tone.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confidence: 1,
      useCount: 0,
      requiresCustomerSpecificInfo: false,
      category: 'general'
    };

    setFaqs(prev => [...prev, newFaqEntry]);
    toast.success('New FAQ template added successfully! 📝', {
      duration: 4000,
      position: 'top-center',
      style: { background: '#fff' },
      className: 'border-green-500',
      descriptionClassName: 'text-gray-500',
      closeButton: true
    });
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
        answer: newFAQ.replyTemplate.replace(/<[^>]*>/g, ''),
        replyTemplate: newFAQ.replyTemplate.replace(/<[^>]*>/g, ''),
        instructions: 'Maintain a professional and helpful tone.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        confidence: 1,
        useCount: 0,
        requiresCustomerSpecificInfo: false,
        category: 'general'
      };
      setFaqs(prev => [...prev, newFaqEntry]);
      toast.success('New FAQ template added successfully! 📝', {
        duration: 4000,
        position: 'top-center',
        style: { background: '#fff' },
        className: 'border-green-500',
        descriptionClassName: 'text-gray-500',
        closeButton: true
      });
    }

    setNewFAQ({ question: '', replyTemplate: '' });
    setEditingFaqId(null);
    setShowAddFAQModal(false);
  };

  const handleEditFAQ = (faq: FAQ) => {
    if (faq.replyTemplate) {
      setNewFAQ({
        question: faq.question,
        replyTemplate: faq.replyTemplate
      });
    }
    if (faq.id) {
      setEditingFaqId(faq.id);
    }
    setShowAddFAQModal(true);
  };

  const handleDeleteFAQ = async (id?: string) => {
    if (!id) {
      toast.error('Invalid FAQ ID');
      return;
    }

    const shouldDelete = window.confirm('Are you sure you want to delete this FAQ?');
    if (shouldDelete) {
      setFaqs(prev => prev.filter(f => f.id !== id));
      toast.success('FAQ template deleted successfully', {
        duration: 4000,
        position: 'top-center',
        style: { background: '#fff' },
        className: 'border-green-500',
        descriptionClassName: 'text-gray-500',
        closeButton: true
      });
    }
  };

  const handleAnalyzeDataset = async () => {
    if (!datasetText.trim()) {
      toast.error('Please enter some text to analyze');
      return;
    }

    if (datasetText.split(/\s+/).filter(Boolean).length > 2000) {
      toast.error('Text exceeds 2,000 words limit');
      return;
    }

    setIsAnalyzing(true);
    try {
      console.log('Sending request to analyze text...');
      const response = await fetch('/api/knowledge/generate-qas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: datasetText }),
      });

      console.log('Received response:', response.status, response.statusText);

      const responseData = await response.json();
      console.log('Response data:', responseData);

      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to analyze text');
      }

      if (!responseData.qas || !Array.isArray(responseData.qas)) {
        console.error('Invalid response format:', responseData);
        throw new Error('Invalid response format from server');
      }

      setGeneratedQAs(responseData.qas.map((qa: { question: string; answer: string }) => ({ ...qa, isEditing: false })));

      if (responseData.qas.length === 0) {
        toast.error('No Q&As could be generated from the text. Please try with different content.');
      } else {
        toast.success(`Generated ${responseData.qas.length} Q&As for review`);
      }
    } catch (error) {
      console.error('Error analyzing text:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to analyze text. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRejectQA = (question: string) => {
    setGeneratedQAs(prev => prev.filter(qa => qa.question !== question));
    toast.success('Q&A pair rejected');
  };

  const handleApproveQA = (qa: { question: string; answer: string }) => {
    const newFaqEntry: FAQ = {
      id: uuidv4(),
      question: qa.question,
      answer: qa.answer,
      replyTemplate: qa.answer,
      instructions: 'Maintain a professional and helpful tone.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confidence: 1,
      useCount: 0,
      requiresCustomerSpecificInfo: false,
      category: 'general'
    };

    setFaqs(prev => [...prev, newFaqEntry]);
    setGeneratedQAs(prev => prev.filter(item => item.question !== qa.question));
    toast.success('Q&A pair added to library');
  };

  const handleEditQA = (index: number) => {
    setGeneratedQAs(prev => prev.map((qa, i) =>
      i === index ? { ...qa, isEditing: true } : qa
    ));
  };

  const handleSaveQA = (index: number, updatedQA: { question: string; answer: string }) => {
    setGeneratedQAs(prev => prev.map((qa, i) =>
      i === index ? { ...updatedQA, isEditing: false } : qa
    ));
    toast.success('Q&A updated successfully');
  };

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50 py-4">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">FAQ Auto Reply</h1>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <Cog6ToothIcon className="h-5 w-5 mr-2 text-gray-500" />
              Settings
            </button>
          </div>

          {/* Settings Modal */}
          <Dialog
            open={showSettingsModal}
            onClose={() => setShowSettingsModal(false)}
            className="relative z-50"
          >
            <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
              <Dialog.Panel className="mx-auto max-w-2xl w-full rounded-xl bg-white p-6 shadow-xl">
                <div className="flex justify-between items-start mb-4">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    FAQ Auto Reply Settings
                  </Dialog.Title>
                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Confidence Threshold Section */}
                  <div>
                    <h3 className="text-sm font-medium text-gray-900 mb-2">
                      Confidence Threshold
                    </h3>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <ConfidenceThresholdControl
                        value={settings.confidenceThreshold}
                        onChange={(value) => setSettings(prev => ({
                          ...prev,
                          confidenceThreshold: value
                        }))}
                      />
                      <p className="text-xs text-gray-500 mt-2">
                        Minimum confidence level required for auto-replies
                      </p>
                    </div>
                  </div>

                  {/* Email Formatting Section */}
                  <div>
                    <div className="space-y-4 bg-gray-50 p-4 rounded-lg">
                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          Default Greeting
                        </label>
                        <input
                          type="text"
                          value={settings.emailFormatting?.greeting || DEFAULT_SETTINGS.emailFormatting.greeting}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            emailFormatting: {
                              ...prev.emailFormatting,
                              greeting: e.target.value
                            }
                          }))}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Hi [Name]!"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          List Style
                        </label>
                        <select
                          value={settings.emailFormatting?.listStyle || DEFAULT_SETTINGS.emailFormatting.listStyle}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            emailFormatting: {
                              ...(prev.emailFormatting || DEFAULT_SETTINGS.emailFormatting),
                              listStyle: e.target.value as 'numbered' | 'bullet'
                            }
                          }))}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        >
                          <option value="numbered">Numbered Lists (1. 2. 3.)</option>
                          <option value="bullet">Bullet Points</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          Email Spacing
                        </label>
                        <select
                          value={settings.emailFormatting?.spacing || DEFAULT_SETTINGS.emailFormatting.spacing}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            emailFormatting: {
                              ...(prev.emailFormatting || DEFAULT_SETTINGS.emailFormatting),
                              spacing: e.target.value as 'compact' | 'normal' | 'spacious'
                            }
                          }))}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        >
                          <option value="compact">Compact</option>
                          <option value="normal">Normal</option>
                          <option value="spacious">Spacious</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          Signature Style
                        </label>
                        <input
                          type="text"
                          value={settings.emailFormatting?.signatureStyle || DEFAULT_SETTINGS.emailFormatting.signatureStyle}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            emailFormatting: {
                              ...(prev.emailFormatting || DEFAULT_SETTINGS.emailFormatting),
                              signatureStyle: e.target.value
                            }
                          }))}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Best,\n[Name]"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-gray-700 mb-1">
                          Custom Formatting Instructions
                        </label>
                        <textarea
                          value={settings.emailFormatting?.customPrompt || DEFAULT_SETTINGS.emailFormatting.customPrompt}
                          onChange={(e) => setSettings(prev => ({
                            ...prev,
                            emailFormatting: {
                              ...(prev.emailFormatting || DEFAULT_SETTINGS.emailFormatting),
                              customPrompt: e.target.value
                            }
                          }))}
                          rows={4}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Add any specific formatting instructions for the AI..."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setShowSettingsModal(false)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveSettings}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                    >
                      Save Settings
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </div>
          </Dialog>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* FAQ Templates Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">FAQ Library 📚</h2>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setShowAddFAQModal(true)}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Add to Library
                  </button>
                  <button
                    onClick={() => setShowUploadDatasetModal(true)}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    Upload Data Set
                  </button>
                </div>
              </div>

              <div className="bg-white shadow rounded-lg divide-y divide-gray-200">
                {faqs.map((faq) => (
                  <div key={faq.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-medium text-gray-900">{faq.question}</h3>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEditFAQ(faq)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <span className="sr-only">Edit</span>
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteFAQ(faq.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <span className="sr-only">Delete</span>
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-gray-600 whitespace-pre-line">
                      {faq.replyTemplate}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Email Simulator Section */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">Email Response Simulator</h2>
              <div className="bg-white shadow rounded-lg">
                <EmailSimulator
                  confidenceThreshold={settings.confidenceThreshold}
                  onSimulationResult={handleSimulationResult}
                  existingFaqs={faqs}
                  onAddNewFAQ={handleAddNewFAQ}
                  emailFormatting={settings.emailFormatting}
                />
              </div>
            </div>
          </div>

          {/* Pending Replies Section */}
          <div className="mt-6">
            <PendingReplies
              pendingReplies={pendingReplies}
              onSend={handleSend}
              onEdit={handleEdit}
            />
          </div>
        </div>

        {/* Add/Edit FAQ Modal */}
        <Dialog
          open={showAddFAQModal}
          onClose={() => setShowAddFAQModal(false)}
          className="relative z-50"
        >
          <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="mx-auto max-w-xl w-full rounded-lg bg-white p-5 shadow-xl">
              <div className="flex justify-between items-start mb-3">
                <Dialog.Title className="text-base font-semibold text-gray-900">
                  {editingFaqId ? 'Edit FAQ Template' : 'Add New FAQ Template'}
                </Dialog.Title>
                <button
                  onClick={() => setShowAddFAQModal(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Question
                  </label>
                  <textarea
                    value={newFAQ.question}
                    onChange={(e) => setNewFAQ(prev => ({ ...prev, question: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    rows={2}
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
                    rows={4}
                    placeholder="Enter the answer template"
                  />
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setShowAddFAQModal(false)}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleManualAddFAQ}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    {editingFaqId ? 'Update Template' : 'Add Template'}
                  </button>
                </div>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>

        {/* Upload Dataset Modal */}
        <Dialog
          open={showUploadDatasetModal}
          onClose={() => setShowUploadDatasetModal(false)}
          className="relative z-50"
        >
          <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="mx-auto max-w-3xl w-full rounded-lg bg-white p-6 shadow-xl">
              <div className="flex justify-between items-start mb-4">
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  Upload Data Set
                </Dialog.Title>
                <button
                  onClick={() => setShowUploadDatasetModal(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Paste your text here (up to 2,000 words)
                  </label>
                  <textarea
                    value={datasetText}
                    onChange={(e) => setDatasetText(e.target.value)}
                    className="w-full h-64 rounded-md border border-gray-300 shadow-sm px-4 py-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Enter your text here..."
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Word count: {datasetText.split(/\s+/).filter(Boolean).length}/2,000
                  </p>
                </div>

                <button
                  onClick={handleAnalyzeDataset}
                  disabled={!datasetText.trim() || isAnalyzing}
                  className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {isAnalyzing ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Analyzing...
                    </div>
                  ) : (
                    'Analyze Text'
                  )}
                </button>

                {generatedQAs.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-lg font-medium mb-4">Generated Q&As</h3>
                    <div className="space-y-4 max-h-96 overflow-y-auto">
                      {generatedQAs.map((qa, index) => (
                        <div key={index} className="border rounded-lg p-4 bg-gray-50">
                          {qa.isEditing ? (
                            <div className="space-y-4">
                              <div>
                                <h4 className="font-medium mb-2">Question:</h4>
                                <textarea
                                  value={qa.question}
                                  onChange={(e) => {
                                    setGeneratedQAs(prev => prev.map((item, i) =>
                                      i === index ? { ...item, question: e.target.value } : item
                                    ));
                                  }}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                  rows={2}
                                />
                              </div>
                              <div>
                                <h4 className="font-medium mb-2">Answer:</h4>
                                <textarea
                                  value={qa.answer}
                                  onChange={(e) => {
                                    setGeneratedQAs(prev => prev.map((item, i) =>
                                      i === index ? { ...item, answer: e.target.value } : item
                                    ));
                                  }}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                  rows={4}
                                />
                              </div>
                              <div className="flex justify-end space-x-2">
                                <button
                                  onClick={() => handleSaveQA(index, { question: qa.question, answer: qa.answer })}
                                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-500"
                                >
                                  Save Changes
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="mb-2">
                                <div className="flex justify-between items-start">
                                  <h4 className="font-medium">Question:</h4>
                                  <button
                                    onClick={() => handleEditQA(index)}
                                    className="text-blue-600 hover:text-blue-800"
                                  >
                                    <PencilIcon className="h-4 w-4" />
                                  </button>
                                </div>
                                <p className="text-gray-700">{qa.question}</p>
                              </div>
                              <div className="mb-4">
                                <h4 className="font-medium">Answer:</h4>
                                <p className="text-gray-700 whitespace-pre-line">{qa.answer}</p>
                              </div>
                              <div className="flex justify-end space-x-2">
                                <button
                                  onClick={() => handleRejectQA(qa.question)}
                                  className="px-3 py-1 text-sm text-red-600 hover:text-red-500"
                                >
                                  Reject
                                </button>
                                <button
                                  onClick={() => handleApproveQA(qa)}
                                  className="px-3 py-1 text-sm bg-green-600 text-white rounded-md hover:bg-green-500"
                                >
                                  Approve
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      </div>
    </Layout>
  );
}
