'use client';

import React, { useState } from 'react';
import { Dialog } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { PendingAutoReply } from '@/types/faq';
import { Beaker, Send, Edit3 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';

// Dynamically import FAQEmailComposer to avoid SSR issues
const FAQEmailComposer = dynamic(() => import('./FAQEmailComposer'), {
  ssr: false,
});

interface CancellationReason {
  id: string;
  label: string;
}

const CANCELLATION_REASONS: CancellationReason[] = [
  { id: 'inappropriate', label: 'Response is inappropriate or incorrect' },
  { id: 'tone', label: 'Tone is not right for our brand' },
  { id: 'incomplete', label: 'Response is incomplete or missing information' },
  { id: 'outdated', label: 'Information is outdated' },
  { id: 'formatting', label: 'Formatting or structure needs improvement' },
  { id: 'other', label: 'Other (please specify)' }
];

interface PendingRepliesProps {
  pendingReplies: PendingAutoReply[];
  onSend: (replyId: string) => void;
  onEdit: (replyId: string, updatedReply: string) => void;
}

export const PendingReplies: React.FC<PendingRepliesProps> = ({
  pendingReplies,
  onSend,
  onEdit,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedReply, setSelectedReply] = useState<PendingAutoReply | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const handleEditClick = (reply: PendingAutoReply) => {
    setSelectedReply(reply);
    setIsEditing(true);
  };

  const handleSendClick = (reply: PendingAutoReply) => {
    onSend(reply.id);
    toast.success('Email sent successfully! 📧');
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b">
        <h3 className="text-lg font-semibold text-gray-900">Pending Auto-Replies</h3>
        <p className="text-sm text-gray-600 mt-1">
          Review and manage automated email responses before they are sent
        </p>
      </div>

      <div className="p-6">
        {pendingReplies.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            No pending replies at the moment
          </div>
        ) : (
          <div className="space-y-4">
            {pendingReplies.map((reply) => (
              <div
                key={reply.id}
                className="border rounded-lg p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-gray-900">
                        {reply.originalEmail.subject || 'No Subject'}
                      </h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        reply.confidence >= 95
                          ? 'bg-green-100 text-green-800'
                          : reply.confidence >= 85
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {reply.confidence}% Confidence
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      To: {reply.originalEmail.from}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditClick(reply)}
                      className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100"
                      title="Edit Response"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleSendClick(reply)}
                      className="p-2 text-blue-500 hover:text-blue-700 rounded-full hover:bg-blue-50"
                      title="Send Response"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        const shouldDelete = window.confirm('Are you sure you want to cancel this auto-reply?');
                        if (shouldDelete) {
                          onSend(reply.id);
                          toast.success('Auto-reply cancelled ❌');
                        }
                      }}
                      className="p-2 text-red-500 hover:text-red-700 rounded-full hover:bg-red-50"
                      title="Cancel Auto-Reply"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">
                  {reply.generatedReply}
                </div>

                {reply.requiresHumanResponse && (
                  <div className="mt-3 p-2 bg-yellow-50 border border-yellow-100 rounded text-sm text-yellow-800">
                    <div className="flex items-center gap-2">
                      <Beaker className="w-4 h-4" />
                      <span>Human review recommended: {reply.reason}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Reply Modal */}
      {isEditing && selectedReply && (
        <FAQEmailComposer
          customerEmail={selectedReply.originalEmail.from}
          originalQuestion={selectedReply.originalEmail.body}
          generatedReply={selectedReply.generatedReply}
          onClose={() => {
            setIsEditing(false);
            setSelectedReply(null);
          }}
          onEmailSent={() => {
            onSend(selectedReply.id);
            setIsEditing(false);
            setSelectedReply(null);
          }}
        />
      )}
    </div>
  );
}; 