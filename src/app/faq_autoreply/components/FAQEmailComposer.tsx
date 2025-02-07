'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tinymce/tinymce-react';
import { useAuth } from '@/lib/hooks/useAuth';
import toast from 'react-hot-toast';

interface FAQEmailComposerProps {
  customerEmail: string;
  originalQuestion: string;
  generatedReply: string;
  onClose: () => void;
  onEmailSent: () => void;
}

export default function FAQEmailComposer({
  customerEmail,
  originalQuestion,
  generatedReply,
  onClose,
  onEmailSent,
}: FAQEmailComposerProps) {
  const { user } = useAuth();
  const [subject, setSubject] = useState('Re: Your Question');
  const [content, setContent] = useState(generatedReply);
  const [isSending, setIsSending] = useState(false);
  const [to, setTo] = useState(user?.email || '');
  const editorRef = useRef<any>(null);

  // Update 'to' field when user auth state changes
  useEffect(() => {
    if (user?.email) {
      setTo(user.email);
    }
  }, [user?.email]);

  // Set the editor content when component mounts
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setContent(generatedReply);
    }
  }, [generatedReply]);

  const handleSend = async () => {
    if (!user?.accessToken) {
      toast.error('Please sign in to send emails');
      return;
    }

    if (!to || !to.trim()) {
      toast.error('Recipient address is required');
      return;
    }

    try {
      setIsSending(true);

      // Get the content from TinyMCE editor
      const editor = (window as any).tinymce.get('email-editor');
      const newContent = editor ? editor.getContent() : content;

      // Format the email content with proper structure
      const fullEmailContent = `<div dir="ltr" style="font-family:Arial,sans-serif;font-size:14px">
${newContent}
</div>`;

      // Send the email
      const response = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          content: fullEmailContent,
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || 'Failed to send email');
      }

      const data = await response.json();
      if (data.success) {
        toast.success('Email sent successfully! 📧');
        onEmailSent();
        onClose();
      } else {
        throw new Error('Failed to send email');
      }
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-4xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">Edit AI-Generated Response</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">To</label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 block w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Message
            </label>
            <Editor
              id="email-editor"
              apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
              init={{
                height: 400,
                menubar: false,
                plugins: [
                  'advlist', 'autolink', 'lists', 'link', 'charmap', 'preview',
                  'searchreplace', 'visualblocks', 'code', 'fullscreen',
                  'insertdatetime', 'table', 'code', 'help', 'wordcount', 'emoticons'
                ],
                toolbar: 'undo redo | formatselect | ' +
                  'bold italic | alignleft aligncenter ' +
                  'alignright alignjustify | bullist numlist | ' +
                  'removeformat | emoticons | help',
                content_style: `
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    font-size: 14px;
                    line-height: 1.6;
                    color: #333;
                    margin: 1rem;
                  }
                  p {
                    margin: 0 0 1rem 0;
                  }
                  .emoji {
                    font-size: 1.2em;
                    vertical-align: middle;
                  }
                `,
                formats: {
                  p: { block: 'p', styles: { margin: '0 0 1rem 0' } }
                },
                forced_root_block: 'p'
              }}
              onInit={(evt, editor) => {
                editorRef.current = editor;
              }}
              initialValue={content}
            />
          </div>

          <div className="flex justify-end gap-4">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={isSending}
              className={`px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                isSending ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 