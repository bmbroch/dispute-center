'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tinymce/tinymce-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { toast } from 'sonner';
import { TINYMCE_CONFIG } from '@/lib/config/tinymce';
import { Send } from 'lucide-react';

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
  const [isSending, setIsSending] = useState(false);
  const [to, setTo] = useState('');
  const editorRef = useRef<any>(null);

  // Format the content for display
  const formatContent = (content: string) => {
    // Remove the subject line if it exists
    const contentWithoutSubject = content.replace(/^Subject: .+?\n/, '');

    // Split the content into paragraphs and format them
    const paragraphs = contentWithoutSubject.split('\n\n');
    const formattedParagraphs = paragraphs.map(para => {
      // Handle multi-line paragraphs
      const lines = para.split('\n').map(line => line.trim()).filter(Boolean);
      if (lines.length === 0) return '<p><br></p>';
      return lines.map(line => `<p>${line}</p>`).join('');
    });

    return formattedParagraphs.join('\n');
  };

  // Extract email address from customer email string
  useEffect(() => {
    if (customerEmail) {
      // Extract email from format like "Name <email@example.com>" or just "email@example.com"
      const emailMatch = customerEmail.match(/<(.+)>/) || [null, customerEmail];
      setTo(emailMatch[1] || customerEmail);
    }
  }, [customerEmail]);

  // Update editor content when initialized or when generatedReply changes
  useEffect(() => {
    if (editorRef.current) {
      const formattedContent = formatContent(generatedReply);
      editorRef.current.setContent(formattedContent);
    }
  }, [generatedReply, editorRef.current]);

  const handleSend = async () => {
    if (!user?.accessToken) {
      toast.error('Please sign in to send emails');
      return;
    }

    if (!to || !to.trim()) {
      toast.error('Recipient address is required');
      return;
    }

    // Create a loading toast that we'll update
    const toastId = toast.loading('Sending email...');
    setIsSending(true);
    onClose(); // Close the modal immediately

    try {
      // Get the content from TinyMCE editor
      const editor = (window as any).tinymce.get('email-editor');
      const newContent = editor ? editor.getContent() : formatContent(generatedReply);

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
          subject: `Re: ${originalQuestion.split('\n')[0].substring(0, 50)}...`, // Use first line of original email
          content: fullEmailContent,
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || 'Failed to send email');
      }

      const data = await response.json();
      if (data.success) {
        toast.success('Email sent successfully! 📧', { id: toastId });
        onEmailSent();
      } else {
        throw new Error('Failed to send email');
      }
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send email', { id: toastId });
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Message
            </label>
            <Editor
              id="email-editor"
              apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
              initialValue={formatContent(generatedReply)}
              init={{
                ...TINYMCE_CONFIG,
                height: 400,
                plugins: [
                  ...TINYMCE_CONFIG.plugins,
                  'emoticons'
                ],
                toolbar: TINYMCE_CONFIG.toolbar + ' | emoticons',
                content_style: `
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    font-size: 14px;
                    line-height: 1.6;
                    color: #333;
                    margin: 1rem;
                    padding: 0;
                  }
                  p {
                    margin: 0 0 1rem 0;
                    padding: 0;
                  }
                  .emoji {
                    font-size: 1.2em;
                    vertical-align: middle;
                  }
                `,
                formats: {
                  p: { block: 'p', styles: { margin: '0 0 1rem 0' } }
                },
                forced_root_block: 'p',
                convert_newlines_to_brs: false,
                remove_trailing_brs: false,
                paste_as_text: true,
                paste_enable_default_filters: false,
                paste_word_valid_elements: "p,b,strong,i,em,h1,h2,h3,h4,h5,h6",
                paste_retain_style_properties: "none"
              }}
              onInit={(evt, editor) => {
                editorRef.current = editor;
              }}
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
              className={`px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 inline-flex items-center gap-2 ${isSending ? 'opacity-50 cursor-not-allowed' : ''
                }`}
            >
              <Send className="h-4 w-4" />
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
