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
  firstName?: string;
  onClose: () => void;
  onEmailSent: () => void;
  replyToMessage?: EmailMessage;
  threads?: EmailThread[];
  initialTemplate?: string | null;
}

export default function EmailComposer({
  customerEmail,
  firstName,
  onClose,
  onEmailSent,
  replyToMessage,
  threads,
  initialTemplate
}: EmailComposerProps) {
  const { user, refreshAccessToken } = useAuth();
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [to, setTo] = useState('');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const editorRef = useRef<any>(null);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    // Set the recipient to the customer's email
    setTo(customerEmail);
  }, [customerEmail]);

  // Handle API templates
  useEffect(() => {
    async function fetchTemplates() {
      if (!user?.email) {
        setTemplates(DEFAULT_TEMPLATES);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        console.log('Fetching templates for user:', user.email);

        const response = await fetch('/api/settings/email-templates', {
          method: 'GET',
          headers: {
            'X-User-Email': user.email,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          cache: 'no-cache'
        }).catch(error => {
          console.error('Network error:', error);
          throw error;
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('API error:', {
            status: response.status,
            statusText: response.statusText,
            body: errorText
          });
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Templates received:', data);

        // Set templates, falling back to defaults if none found
        const templatesData = (data && data.length > 0) ? data : DEFAULT_TEMPLATES;
        setTemplates(templatesData);
        handleInitialTemplate(templatesData);
      } catch (error) {
        console.error('Failed to fetch templates:', error);
        setTemplates(DEFAULT_TEMPLATES);
        handleInitialTemplate(DEFAULT_TEMPLATES);
      } finally {
        setIsLoading(false);
      }
    }

    function handleInitialTemplate(templatesData: EmailTemplate[]) {
      if (!hasInitializedRef.current && !replyToMessage && customerEmail) {
        const templateIndex = initialTemplate ? parseInt(initialTemplate) : 0;
        const templateToUse = templatesData[templateIndex] || templatesData[0];
        setSelectedTemplate(templateToUse);
        setSubject(templateToUse.subject);

        const formattedFirstName = firstName || (() => {
          const nameFromEmail = customerEmail.split('@')[0].split(/[^a-zA-Z]/)[0];
          return nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1).toLowerCase();
        })();

        const processedBody = templateToUse.body.replace(/\{\{firstName\}\}/g, formattedFirstName);
        setContent(processedBody);

        if (editorRef.current) {
          editorRef.current.setContent(processedBody);
        }

        hasInitializedRef.current = true;
      }
    }

    fetchTemplates();
  }, [user?.email, customerEmail, replyToMessage, initialTemplate, firstName]);

  // Handle reply message
  useEffect(() => {
    if (replyToMessage) {
      setSubject(replyToMessage.subject.startsWith('Re:')
        ? replyToMessage.subject
        : `Re: ${replyToMessage.subject}`);

      // Start with empty content for replies
      setContent('');
      hasInitializedRef.current = true;
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

  const formatThreadHistory = (threadHistory?: string): string => {
    if (!threadHistory) {
      return '';
    }
    // Clean the content while preserving important HTML formatting
    const cleanContent = threadHistory
      // Remove any existing quotes to prevent nesting
      .replace(/<div[^>]*class="gmail_quote"[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*>On [^<]*wrote:<\/div>/gi, '')
      // Preserve image tags but ensure they have proper styling
      .replace(/<img([^>]*)>/gi, '<img$1 style="max-width:100%;height:auto;">')
      // Clean up extra divs and normalize spacing
      .replace(/<div[^>]*>/gi, '<div>')
      .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>') // Normalize multiple breaks
      .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
      .trim();

    if (!cleanContent) return '';

    const date = formatDate(replyToMessage?.date || '');
    const from = replyToMessage?.from || '';

    // Return formatted content with preserved HTML and images
    return `<div class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">
<div class="gmail_attr" style="color:#666;margin:0 0 .8ex 0;font-size:90%">On ${date}, ${from} wrote:</div>
<div class="gmail_content" style="font-family:Arial,sans-serif;font-size:14px">${cleanContent}</div>
</div>`;
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

    // Use provided firstName or fall back to email-based name if not provided
    const formattedFirstName = firstName || (() => {
      const nameFromEmail = customerEmail.split('@')[0].split(/[^a-zA-Z]/)[0];
      return nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1).toLowerCase();
    })();

    const processedBody = template.body.replace(/\{\{firstName\}\}/g, formattedFirstName);

    // Set the content state immediately
    setContent(processedBody);

    // Also try to update the editor if it's available
    if (editorRef.current) {
      editorRef.current.setContent(processedBody);
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

      // Extract all inline images from the content
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = newContent;
      const images = tempDiv.getElementsByTagName('img');
      const inlineImages: { filename: string; content: string; contentId: string; }[] = [];

      // Process each image
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const src = img.getAttribute('src');
        if (src && src.startsWith('data:')) {
          // Generate a unique content ID for the image
          const contentId = `image_${Date.now()}_${i}`;
          const extension = src.split(';')[0].split('/')[1];
          const filename = `image_${Date.now()}_${i}.${extension}`;

          // Replace the data URL with a CID reference
          img.setAttribute('src', `cid:${contentId}`);

          // Store the image data
          inlineImages.push({
            filename,
            content: src.split(',')[1], // Remove the data:image/xxx;base64, prefix
            contentId
          });
        }
      }

      // Format the email with proper structure
      const threadHistoryToAppend = formatThreadHistory(replyToMessage ? replyToMessage.content : '');
      const fullEmailContent = `<div dir="ltr" style="font-family:Arial,sans-serif;font-size:14px">
${tempDiv.innerHTML}
${threadHistoryToAppend ? `<br>${threadHistoryToAppend}` : ''}
</div>`;

      let currentAccessToken = user.accessToken;

      const sendEmail = async (token: string) => {
        // Get all messages in the thread for proper threading
        const threadMessages = replyToMessage?.threadId ?
          threads?.find(t => t.id === replyToMessage.threadId)?.messages || [] :
          [];

        // Sort messages chronologically (oldest first) for References header
        const sortedMessages = [...threadMessages].sort((a, b) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        // Build References header - should include all previous message IDs
        const messageIds = sortedMessages
          .map(msg => msg.messageId)
          .filter(id => id)
          .map(id => id.startsWith('<') ? id : `<${id}>`);

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
            references: messageIds,
            inReplyTo: replyToMessage?.messageId,
            originalContent: replyToMessage?.content,
            inlineImages // Add inline images to the request
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
      <div className="bg-white rounded-lg w-full max-w-4xl mx-4 flex flex-col max-h-[90vh]">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            <div className="p-6 flex-shrink-0">
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
            </div>

            <div className="flex-1 overflow-y-auto px-6">
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Message
                  </label>
                  <Editor
                    id="email-editor"
                    apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
                    init={{
                      height: 500,
                      menubar: false,
                      statusbar: false,
                      branding: false,
                      promotion: false,
                      skin: 'oxide',
                      plugins: [
                        'advlist', 'autolink', 'lists', 'link', 'image',
                        'charmap', 'preview', 'anchor', 'searchreplace',
                        'visualblocks', 'code', 'fullscreen',
                        'insertdatetime', 'media', 'table', 'help',
                        'wordcount'
                      ],
                      toolbar: 'undo redo | formatselect | ' +
                        'bold italic underline | alignleft aligncenter ' +
                        'alignright alignjustify | bullist numlist | ' +
                        'link image | removeformat',
                      content_style: `
                        body {
                          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                          font-size: 14px;
                          line-height: 1.4;
                          color: #000000;
                          background: #ffffff;
                          margin: 0;
                          padding: 16px;
                        }
                        .mce-content-body {
                          padding: 16px !important;
                        }
                        p {
                          margin: 0;
                          padding: 0;
                          min-height: 1.4em;
                        }
                        p:empty {
                          min-height: 1.4em;
                        }
                        p + p {
                          margin-top: 0.7em;
                        }
                        img {
                          max-width: 40%;
                          height: auto;
                          display: block;
                          margin: 8px 0;
                        }
                        ul, ol {
                          margin: 0.7em 0;
                          padding-left: 2em;
                        }
                        li {
                          margin: 0;
                          padding: 0;
                        }
                        li + li {
                          margin-top: 0.2em;
                        }
                      `,
                      content_css: 'default',
                      content_css_cors: true,
                      forced_root_block: 'p',
                      forced_root_block_attrs: {
                        style: 'margin: 0; padding: 0; min-height: 1.4em;'
                      },
                      formats: {
                        p: { block: 'p', styles: { margin: '0', padding: '0', 'min-height': '1.4em' } }
                      },
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
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex-shrink-0">
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
