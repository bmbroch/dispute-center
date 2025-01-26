'use client';

import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { useAuth } from '@/lib/hooks/useAuth';
import { toast } from 'react-hot-toast';
import { Editor } from '@tinymce/tinymce-react';

interface DisputeSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  order: number;
}

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    id: '1',
    name: 'First Response',
    subject: 'Re: Dispute Resolution - Interview Sidekick',
    body: `Hi {{firstName}},\n\nI noticed you've opened a dispute for our service. I understand your concern and I'd like to help resolve this directly.\n\nOur records show that you've accessed our platform and we'd love to ensure you get the most value from it. Would you be open to discussing this before proceeding with the dispute?\n\nBest regards,\nBen`,
    order: 1
  },
  {
    id: '2',
    name: 'Follow Up',
    subject: 'Re: Dispute Follow-up - Interview Sidekick',
    body: `Hi {{firstName}},\n\nI'm following up on the dispute you've filed. I noticed we haven't heard back from you yet. As a small business owner, I'm personally committed to ensuring every customer's satisfaction.\n\nWould you be willing to have a quick discussion about your concerns? We can also arrange for a refund through PayPal if you'd prefer that option?\n\nBest regards,\nBen`,
    order: 2
  },
  {
    id: '3',
    name: 'Final Notice',
    subject: 'Re: Final Notice - Interview Sidekick Dispute',
    body: `Hi {{firstName}},\n\nThis is my final attempt to resolve this dispute amicably. As mentioned before, we have records of your platform usage and are prepared to provide this evidence if needed.\n\nHowever, I'd much prefer to resolve this directly with you. Please let me know if you'd be open to discussing this or accepting a refund through PayPal.\n\nBest regards,\nBen`,
    order: 3
  }
];

export default function DisputeSettingsModal({ isOpen, onClose }: DisputeSettingsModalProps) {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[]>(DEFAULT_TEMPLATES);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [editedTemplate, setEditedTemplate] = useState<EmailTemplate | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
  }, [isOpen, user?.email]);

  const fetchTemplates = async () => {
    if (!user?.email) {
      setTemplates(DEFAULT_TEMPLATES);
      setSelectedTemplate(DEFAULT_TEMPLATES[0]);
      setEditedTemplate(DEFAULT_TEMPLATES[0]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch('/api/settings/email-templates', {
        headers: {
          'X-User-Email': user.email,
        }
      });
      
      const data = await response.json();
      
      // If we get valid templates, use them
      if (Array.isArray(data) && data.length > 0) {
        setTemplates(data);
        setSelectedTemplate(data[0]);
        setEditedTemplate(data[0]);
      } else {
        // Otherwise use defaults
        setTemplates(DEFAULT_TEMPLATES);
        setSelectedTemplate(DEFAULT_TEMPLATES[0]);
        setEditedTemplate(DEFAULT_TEMPLATES[0]);
      }
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      toast.error('Failed to load templates, using defaults');
      setTemplates(DEFAULT_TEMPLATES);
      setSelectedTemplate(DEFAULT_TEMPLATES[0]);
      setEditedTemplate(DEFAULT_TEMPLATES[0]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.email) {
      toast.error('Please sign in to save templates');
      return;
    }

    try {
      setIsSaving(true);

      // Validate required fields
      if (!editedTemplate?.name || !editedTemplate?.subject || !editedTemplate?.body) {
        toast.error('Please fill in all required fields');
        return;
      }

      // Update the templates array with the edited template
      const updatedTemplates = templates.map(t => 
        t.id === editedTemplate.id ? editedTemplate : t
      );

      // Save to API
      const response = await fetch('/api/settings/email-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': user.email
        },
        body: JSON.stringify(updatedTemplates)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save templates');
      }

      // Update local state with the saved templates
      setTemplates(data.templates || updatedTemplates);
      toast.success('Templates saved successfully');

    } catch (error) {
      console.error('Error saving templates:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save templates');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-4xl">
                <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <Dialog.Title as="h3" className="text-xl font-semibold leading-6 text-gray-900">
                        Email Templates
                      </Dialog.Title>
                      <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-500"
                      >
                        <span className="sr-only">Close</span>
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    
                    {isLoading ? (
                      <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
                      </div>
                    ) : (
                      <div className="flex gap-6">
                        {/* Template List */}
                        <div className="w-1/4 border-r pr-6">
                          <h4 className="text-sm font-medium text-gray-900 mb-3">Template List</h4>
                          <div className="space-y-2">
                            {templates.map((template) => (
                              <button
                                key={template.id}
                                onClick={() => {
                                  setSelectedTemplate(template);
                                  setEditedTemplate(template);
                                }}
                                className={`w-full text-left px-4 py-3 rounded-md text-sm transition-colors ${
                                  selectedTemplate?.id === template.id
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <div className="font-medium">{template.name}</div>
                                <div className="text-xs text-gray-500 mt-1 truncate">
                                  {template.subject}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Template Editor */}
                        <div className="w-3/4">
                          {editedTemplate && (
                            <div className="space-y-6">
                              <div>
                                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                                  Template Name
                                </label>
                                <input
                                  type="text"
                                  id="name"
                                  value={editedTemplate.name}
                                  onChange={(e) => setEditedTemplate({
                                    ...editedTemplate,
                                    name: e.target.value
                                  })}
                                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                                />
                              </div>

                              <div>
                                <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">
                                  Email Subject
                                </label>
                                <input
                                  type="text"
                                  id="subject"
                                  value={editedTemplate.subject}
                                  onChange={(e) => setEditedTemplate({
                                    ...editedTemplate,
                                    subject: e.target.value
                                  })}
                                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                                />
                              </div>

                              <div>
                                <label htmlFor="body" className="block text-sm font-medium text-gray-700 mb-1">
                                  Email Body
                                </label>
                                <div className="mt-1 border rounded-md">
                                  <Editor
                                    id="body"
                                    apiKey="lxujz1zpiz2jjj6a109swdlf62pgyqpfu5z4e88tkql1vlbr"
                                    value={editedTemplate.body}
                                    onEditorChange={(content) => {
                                      setEditedTemplate({
                                        ...editedTemplate,
                                        body: content
                                      });
                                    }}
                                    init={{
                                      height: 400,
                                      menubar: false,
                                      plugins: [
                                        'advlist', 'autolink', 'lists', 'link', 'charmap',
                                        'anchor', 'searchreplace', 'visualblocks',
                                        'insertdatetime', 'wordcount'
                                      ],
                                      toolbar: 'undo redo | formatselect | ' +
                                        'bold italic underline | alignleft aligncenter ' +
                                        'alignright alignjustify | bullist numlist | ' +
                                        'removeformat',
                                      content_style: `
                                        body { 
                                          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                                          font-size: 14px;
                                          line-height: 1.6;
                                          margin: 1rem;
                                        }
                                        p { margin: 0 0 1rem 0; }
                                      `,
                                      formats: {
                                        p: { block: 'p', attributes: { style: 'margin-bottom: 1rem;' } }
                                      },
                                      entity_encoding: 'raw',
                                      convert_urls: false,
                                      relative_urls: false,
                                      remove_script_host: false,
                                      end_container_on_empty_block: true,
                                      statusbar: false,
                                      branding: false,
                                      placeholder: 'Enter your email template here...',
                                      paste_as_text: false,
                                      paste_retain_style_properties: 'all',
                                      paste_word_valid_elements: 'b,strong,i,em,h1,h2,h3,p,br',
                                      paste_remove_styles_if_webkit: false,
                                      valid_elements: 'p[style],br,b,strong,i,em,a[href|target],ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote',
                                      valid_styles: {
                                        '*': 'font-size,font-family,color,text-decoration,text-align'
                                      }
                                    }}
                                  />
                                </div>
                                <div className="mt-2 p-3 bg-blue-50 rounded-md">
                                  <p className="text-sm text-blue-700">
                                    <span className="font-medium">💡 Tip:</span> Use <code className="bg-blue-100 px-1.5 py-0.5 rounded">{`{{firstName}}`}</code> to automatically include the customer&apos;s first name in your email.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
                  <button
                    type="button"
                    onClick={handleSave}
                    className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:ml-3 sm:w-auto"
                  >
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
} 