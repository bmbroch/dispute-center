'use client';

import React, { useState, useEffect, useRef } from 'react';
import { EmailMessage, EmailThread } from './EmailCorrespondence';
import toast from 'react-hot-toast';
import { Editor } from '@tinymce/tinymce-react';
import { useAuth } from '@/lib/hooks/useAuth';

const DEFAULT_TEMPLATES = [
  {
    id: 1,
    name: 'First Response',
    subject: 'Re: Dispute Resolution - Interview Sidekick',
    body: `Hi {{firstName}},

I noticed you've opened a dispute for our service. I understand your concern and I'd like to help resolve this directly.

Our records show that you've accessed our platform and we'd love to ensure you get the most value from it. Would you be open to discussing this before proceeding with the dispute?

Best regards,
Ben`
  },
  {
    id: 2,
    name: 'Second Response',
    subject: 'Re: Dispute Follow-up - Interview Sidekick',
    body: `Hi {{firstName}},

I'm following up on the dispute you've filed. I noticed we haven't heard back from you yet. As a small business owner, I'm personally committed to ensuring every customer's satisfaction.

Would you be willing to have a quick discussion about your concerns? We can also arrange for a refund through PayPal if you'd prefer that option.

Best regards,
Ben`
  },
  {
    id: 3,
    name: 'Final Response',
    subject: 'Re: Final Notice - Interview Sidekick Dispute',
    body: `Hi {{firstName}},

This is my final attempt to resolve this dispute amicably. As mentioned before, we have records of your platform usage and are prepared to provide this evidence if needed.

However, I'd much prefer to resolve this directly with you. Please let me know if you'd be open to discussing this or accepting a refund through PayPal.

Best regards,
Ben`
  }
];

interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
}

interface EmailComposerProps {
  customerEmail: string;
  onClose: () => void;
  onEmailSent?: () => void;
  replyToMessage?: EmailMessage | null;
  threads: EmailThread[];
}

export default function EmailComposer({ 
  customerEmail, 
  onClose, 
  onEmailSent, 
  replyToMessage,
  threads
}: EmailComposerProps) {
  const { user, refreshAccessToken } = useAuth();
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [to, setTo] = useState(customerEmail || '');
  const [templates, setTemplates] = useState<EmailTemplate[]>(DEFAULT_TEMPLATES);
  const [isLoading, setIsLoading] = useState(false);
  const [showPreviousEmails, setShowPreviousEmails] = useState(false);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    // Update 'to' field when customerEmail changes, ensuring it's never undefined
    setTo(customerEmail || '');
  }, [customerEmail]);

  // Initialize with first template if not a reply
  useEffect(() => {
    if (!replyToMessage && customerEmail) {
      const firstTemplate = DEFAULT_TEMPLATES[0];
      setSelectedTemplate(firstTemplate);
      setSubject(firstTemplate.subject);
      
      const firstName = customerEmail.split('@')[0].split(/[^a-zA-Z]/)[0];
      const formattedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
      
      const processedBody = firstTemplate.body.replace(/\{\{firstName\}\}/g, formattedFirstName);
      setContent(processedBody);
    }
  }, [customerEmail, replyToMessage]);

  // Handle API templates
  useEffect(() => {
    async function fetchTemplates() {
      if (!user?.email) return;

      try {
        const response = await fetch('/api/settings/email-templates', {
          headers: {
            'X-User-Email': user.email,
          }
        });
        const data = await response.json();
        
        if (data && data.length > 0) {
          setTemplates(data);
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      }
    }

    fetchTemplates();
  }, [user?.email]);

  // Handle reply message
  useEffect(() => {
    if (replyToMessage) {
      setSubject(replyToMessage.subject.startsWith('Re:') 
        ? replyToMessage.subject 
        : `Re: ${replyToMessage.subject}`);
      
      setContent(`<div class="min-h-[100px]"></div>`);
    }
  }, [replyToMessage]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  };

  const getPreviousEmailsContent = () => {
    if (!replyToMessage) return '';

    // Get all messages from the thread
    const threadMessages = replyToMessage.threadId ? threads?.find(t => t.id === replyToMessage.threadId)?.messages || [] : [];
    
    // Sort messages by date
    const sortedMessages = [...threadMessages].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Build the quoted content from all previous messages
    return sortedMessages.map(message => {
      const quotedHeader = `<div class="text-gray-500 text-sm mb-2">On ${formatDate(message.date)}, ${message.from} wrote:</div>`;
      
      // Clean the message content
      const cleanMessage = message.body
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<blockquote[^>]*>/gi, '')
        .replace(/<\/blockquote>/gi, '')
        .replace(/<[^>]*>/g, '')
        .trim();

      return `
        <div class="border-t border-gray-200 mt-8 pt-4">
          <div class="border-l-2 border-gray-300 pl-3 text-gray-600">
            ${quotedHeader}
            <div class="whitespace-pre-wrap">${cleanMessage}</div>
          </div>
        </div>
      `;
    }).join('\n');
  };

  const formatThreadHistory = () => {
    if (!replyToMessage) return '';

    // Get all messages from the thread
    const threadMessages = replyToMessage.threadId ? threads?.find(t => t.id === replyToMessage.threadId)?.messages || [] : [];
    
    // Sort messages by date (newest first)
    const sortedMessages = [...threadMessages].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Format each message with its content visible
    return sortedMessages.map(message => {
      // Format the date in Gmail style
      const date = new Date(message.date);
      const formattedDate = date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      // Extract email from the "from" field
      const emailMatch = message.from.match(/<(.+?)>/);
      const email = emailMatch ? emailMatch[1] : message.from;
      const name = message.from.split('<')[0].trim();

      // Clean and format the message content
      let cleanMessage = message.body
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<blockquote[^>]*>/gi, '')
        .replace(/<\/blockquote>/gi, '')
        .replace(/<[^>]*>/g, '')
        .trim();

      // Format in Gmail's style
      return `<div class="gmail_message">
  <div class="gmail_header">On ${formattedDate}, ${name} &lt;${email}&gt; wrote:</div>
  <div class="gmail_content">${cleanMessage}</div>
</div>`;
    }).join('\n\n');
  };

  const handleTemplateSelect = (template: EmailTemplate) => {
    if (!customerEmail) {
      toast.error('Recipient email is required');
      return;
    }

    setSelectedTemplate(template);
    setSubject(replyToMessage ? 
      (replyToMessage.subject.startsWith('Re:') ? replyToMessage.subject : `Re: ${replyToMessage.subject}`) :
      template.subject
    );
    
    const firstName = customerEmail.split('@')[0].split(/[^a-zA-Z]/)[0];
    const formattedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    
    const processedBody = template.body.replace(/\{\{firstName\}\}/g, formattedFirstName);
    
    const editor = (window as any).tinymce.get('email-editor');
    if (editor) {
      editor.setContent(processedBody);
    } else {
      setContent(processedBody);
    }
  };

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

      // Add thread history
      const threadHistory = formatThreadHistory();
      const fullEmailContent = `<div class="gmail_message">
  <div class="gmail_content">${newContent}</div>
</div>
${threadHistory}`;

      let currentAccessToken = user.accessToken;

      const sendEmail = async (token: string) => {
        const response = await fetch('/api/gmail/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            to: to.trim(),
            subject: subject.trim(),
            content: fullEmailContent,
            threadId: replyToMessage?.threadId,
            messageId: replyToMessage?.messageId,
            references: replyToMessage?.references,
            inReplyTo: replyToMessage?.inReplyTo
          })
        });

        if (!response.ok) {
          const error = await response.json();
          if (error.error === 'Token expired' && refreshAccessToken) {
            // Try to refresh the token
            const newToken = await refreshAccessToken();
            if (newToken) {
              return sendEmail(newToken);
            }
          }
          throw new Error(error.details || error.error || 'Failed to send email');
        }
        return response;
      };

      const response = await sendEmail(currentAccessToken);
      const data = await response.json();

      if (data.success) {
        toast.success('Email sent successfully');
        if (onEmailSent) {
          onEmailSent();
        }
        onClose();
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
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">
                {replyToMessage ? 'Reply to Email' : 'New Email'}
              </h2>
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
                  Templates
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleTemplateSelect(template)}
                      className={`p-3 text-left border rounded-lg transition-colors ${
                        selectedTemplate?.id === template.id
                          ? 'border-blue-500 bg-blue-50 text-gray-900'
                          : 'border-gray-200 hover:border-blue-300 text-gray-900'
                      }`}
                    >
                      <div className="font-medium text-gray-900">{template.name}</div>
                      <div className="text-sm text-gray-600 truncate">
                        {template.subject}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Message
                  </label>
                  {replyToMessage && (
                    <button
                      onClick={() => {
                        setShowPreviousEmails(!showPreviousEmails);
                        const editor = (window as any).tinymce.get('email-editor');
                        if (editor) {
                          const currentContent = editor.getContent();
                          const baseContent = currentContent.split('<div class="border-t')[0];
                          editor.setContent(
                            showPreviousEmails 
                              ? baseContent 
                              : baseContent + getPreviousEmailsContent()
                          );
                        }
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      {showPreviousEmails ? 'Hide' : 'Show'} previous emails
                      <svg 
                        className={`w-4 h-4 transform transition-transform ${showPreviousEmails ? 'rotate-180' : ''}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                </div>
                <Editor
                  id="email-editor"
                  apiKey="lxujz1zpiz2jjj6a109swdlf62pgyqpfu5z4e88tkql1vlbr"
                  init={{
                    height: 500,
                    menubar: false,
                    statusbar: false,
                    branding: false,
                    promotion: false,
                    skin: 'oxide',
                    plugins: 'link lists',
                    toolbar: 'bold italic | bullist numlist | link',
                    content_style: `
                      body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.5;
                        padding: 1rem;
                        color: #000000;
                        background: #ffffff;
                      }
                      p { margin: 0 0 1em 0; }
                    `,
                    setup: function(editor) {
                      editor.on('init', function() {
                        const body = editor.getBody();
                        body.style.backgroundColor = '#ffffff';
                        body.style.color = '#000000';
                      });
                    }
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
          </>
        )}
      </div>
    </div>
  );
} 