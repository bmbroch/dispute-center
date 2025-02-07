'use client';

import React, { useState } from 'react';
import { PendingAutoReply } from '@/types/faq';
import { Beaker, Send, Edit3 } from 'lucide-react';
import dynamic from 'next/dynamic';

// Dynamically import FAQEmailComposer to avoid SSR issues
const FAQEmailComposer = dynamic(() => import('./FAQEmailComposer'), {
  ssr: false,
});

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
  const [selectedReply, setSelectedReply] = useState<PendingAutoReply | null>(null);
  const [isComposerOpen, setIsComposerOpen] = useState(false);

  const handleSendClick = (reply: PendingAutoReply) => {
    onSend(reply.id);
  };

  const handleEditClick = (reply: PendingAutoReply) => {
    setSelectedReply(reply);
    setIsComposerOpen(true);
  };

  const handleEmailSent = () => {
    if (selectedReply) {
      onSend(selectedReply.id);
    }
    setIsComposerOpen(false);
    setSelectedReply(null);
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b">
        <h3 className="text-lg font-semibold">Pending Auto-Replies</h3>
      </div>
      <div className="p-6">
        {pendingReplies.length > 0 ? (
          <div className="space-y-6">
            {pendingReplies.map((reply) => (
              <div
                key={reply.id}
                className="border rounded-lg p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-gray-900">
                        {reply.originalEmail.subject || 'No Subject'}
                      </h4>
                      {reply.status === 'pending' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          Pending
                        </span>
                      )}
                      {/* Simulation indicator */}
                      {reply.originalEmail.hasImages && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          <Beaker className="w-3 h-3" />
                          Simulation
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      From: {reply.originalEmail.from}
                    </p>
                    <p className="text-sm text-gray-600">
                      Confidence: {reply.confidence}%
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditClick(reply)}
                      className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Edit Reply"
                    >
                      <Edit3 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleSendClick(reply)}
                      className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                      title="Send Reply"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="prose prose-sm max-w-none">
                  <div
                    className="bg-gray-50 rounded p-3 text-gray-700"
                    dangerouslySetInnerHTML={{ __html: reply.generatedReply }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 italic">No pending auto-replies</div>
        )}
      </div>

      {/* Email Composer Modal */}
      {isComposerOpen && selectedReply && (
        <FAQEmailComposer
          customerEmail={selectedReply.originalEmail.from}
          originalQuestion={selectedReply.originalEmail.body}
          generatedReply={selectedReply.generatedReply}
          onClose={() => {
            setIsComposerOpen(false);
            setSelectedReply(null);
          }}
          onEmailSent={handleEmailSent}
        />
      )}
    </div>
  );
}; 