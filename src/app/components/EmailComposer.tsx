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
  initialTemplate?: EmailTemplate;
}

export default function EmailComposer({ 
  customerEmail, 
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
  const [to, setTo] = useState(customerEmail || '');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const editorRef = useRef<any>(null);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    // Update 'to' field when customerEmail changes, ensuring it's never undefined
    setTo(customerEmail || '');
  }, [customerEmail]);

  // Handle API templates
  useEffect(() => {
    async function fetchTemplates() {
      if (!user?.email) return;

      try {
        setIsLoading(true);
        const response = await fetch('/api/settings/email-templates', {
          headers: {
            'X-User-Email': user.email,
          }
        });
        const data = await response.json();
        
        // Set templates, falling back to defaults if none found
        const templatesData = (data && data.length > 0) ? data : DEFAULT_TEMPLATES;
        setTemplates(templatesData);

        // Initialize with initialTemplate if provided, otherwise use first template
        if (!hasInitializedRef.current && !replyToMessage && customerEmail) {
          const templateToUse = initialTemplate || templatesData[0];
          setSelectedTemplate(templateToUse);
          setSubject(templateToUse.subject);
          
          const firstName = customerEmail.split('@')[0].split(/[^a-zA-Z]/)[0];
          const formattedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
          
          const processedBody = templateToUse.body.replace(/\{\{firstName\}\}/g, formattedFirstName);
          setContent(processedBody);
          
          // Also update the editor content if it exists
          if (editorRef.current) {
            editorRef.current.setContent(processedBody);
          }
          
          hasInitializedRef.current = true;
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error);
        // Fall back to default templates or initialTemplate
        const templatesData = initialTemplate ? [initialTemplate, ...DEFAULT_TEMPLATES] : DEFAULT_TEMPLATES;
        setTemplates(templatesData);
        
        if (!hasInitializedRef.current && !replyToMessage && customerEmail) {
          const templateToUse = initialTemplate || templatesData[0];
          setSelectedTemplate(templateToUse);
          setSubject(templateToUse.subject);
          
          const firstName = customerEmail.split('@')[0].split(/[^a-zA-Z]/)[0];
          const formattedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
          
          const processedBody = templateToUse.body.replace(/\{\{firstName\}\}/g, formattedFirstName);
          setContent(processedBody);
          
          if (editorRef.current) {
            editorRef.current.setContent(processedBody);
          }
          
          hasInitializedRef.current = true;
        }
      } finally {
        setIsLoading(false);
      }
    }

    fetchTemplates();
  }, [user?.email, customerEmail, replyToMessage, initialTemplate]);

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

  const formatThreadHistory = () => {
    if (!replyToMessage) return '';
    
    // Get all messages from the thread in chronological order
    const threadMessages = replyToMessage.threadId ? 
      threads?.find(t => t.id === replyToMessage.threadId)?.messages || [] : 
      [replyToMessage];
    
    // Sort messages by date (newest first for display)
    const sortedMessages = [...threadMessages].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Take only the immediate parent message for the quote
    const immediateParent = sortedMessages[0];
    if (!immediateParent) return '';

    // Clean the content while preserving important HTML formatting
    const cleanContent = immediateParent.body
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

    const date = formatDate(immediateParent.date);
    const from = immediateParent.from;

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
    
    const firstName = customerEmail.split('@')[0].split(/[^a-zA-Z]/)[0];
    const formattedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
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
      const threadHistory = formatThreadHistory();
      const fullEmailContent = `<div dir="ltr" style="font-family:Arial,sans-serif;font-size:14px">
${tempDiv.innerHTML}
${threadHistory ? `<br>${threadHistory}` : ''}
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
                    paste_data_images: true,
                    paste_as_text: false,
                    paste_enable_default_filters: true,
                    paste_word_valid_elements: 'b,strong,i,em,h1,h2,h3,p,br',
                    paste_webkit_styles: 'none',
                    paste_retain_style_properties: 'none',
                    paste_merge_formats: true,
                    paste_convert_word_fake_lists: true,
                    automatic_uploads: true,
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
                      img { 
                        max-width: 40%; 
                        height: auto;
                        display: block;
                        margin: 8px 0;
                      }
                    `,
                    setup: function(editor) {
                      editor.on('init', function() {
                        const body = editor.getBody();
                        body.style.backgroundColor = '#ffffff';
                        body.style.color = '#000000';
                      });

                      // Handle paste events to ensure images are properly handled
                      editor.on('paste', function(e) {
                        if (e.clipboardData) {
                          const items = e.clipboardData.items;
                          for (let i = 0; i < items.length; i++) {
                            if (items[i].type.indexOf('image') !== -1) {
                              // Convert image to base64 immediately
                              const blob = items[i].getAsFile();
                              const reader = new FileReader();
                              reader.onload = function(e) {
                                editor.insertContent(`<img src="${e.target?.result}" style="max-width:40%; height:auto; display:block; margin:8px 0;" />`);
                              };
                              reader.readAsDataURL(blob);
                              e.preventDefault();
                            }
                          }
                        }
                      });
                    },
                    // Add default image settings
                    image_dimensions: false,
                    image_class_list: [
                      {title: 'Default (40%)', value: 'default-image'},
                      {title: 'Full width', value: 'full-width'}
                    ],
                    image_default_size: {
                      width: '40%',
                      height: 'auto'
                    },
                    images_upload_handler: async function (blobInfo) {
                      try {
                        // Convert the blob to base64
                        return new Promise((resolve) => {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            resolve(reader.result as string);
                          };
                          reader.readAsDataURL(blobInfo.blob());
                        });
                      } catch (error) {
                        console.error('Failed to upload image:', error);
                        throw error;
                      }
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