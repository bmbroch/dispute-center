import React from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface AutoReplySettings {
  similarityThreshold: number;
  confidenceThreshold: number;
  emailFormatting: {
    greeting: string;
    listStyle: 'bullet' | 'numbered';
    spacing: 'compact' | 'normal' | 'spacious';
    signatureStyle: string;
    customPrompt: string;
    useHtml: boolean;
    includeSignature: boolean;
    signatureText: string;
  };
  automaticFiltering: {
    enabled: boolean;
    blockedAddresses: string[];
  };
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AutoReplySettings;
  onSave: (settings: AutoReplySettings) => void;
  onResetAllEmails?: () => Promise<void>;
}

export default function SettingsModal({ isOpen, onClose, settings, onSave, onResetAllEmails }: SettingsModalProps) {
  const [localSettings, setLocalSettings] = React.useState<AutoReplySettings>({
    ...settings,
    automaticFiltering: settings.automaticFiltering || {
      enabled: false,
      blockedAddresses: []
    }
  });
  const [isCompletelyResetting, setIsCompletelyResetting] = React.useState(false);
  const [newBlockedEmail, setNewBlockedEmail] = React.useState('');

  React.useEffect(() => {
    setLocalSettings({
      ...settings,
      automaticFiltering: settings.automaticFiltering || {
        enabled: false,
        blockedAddresses: []
      }
    });
  }, [settings]);

  const handleAddBlockedEmail = () => {
    const emailToAdd = newBlockedEmail.trim().toLowerCase();
    if (emailToAdd && !localSettings.automaticFiltering.blockedAddresses.includes(emailToAdd)) {
      setLocalSettings({
        ...localSettings,
        automaticFiltering: {
          ...localSettings.automaticFiltering,
          blockedAddresses: [...localSettings.automaticFiltering.blockedAddresses, emailToAdd]
        }
      });
      setNewBlockedEmail('');
    }
  };

  const handleRemoveBlockedEmail = (index: number) => {
    setLocalSettings({
      ...localSettings,
      automaticFiltering: {
        ...localSettings.automaticFiltering,
        blockedAddresses: localSettings.automaticFiltering.blockedAddresses.filter((_, i) => i !== index)
      }
    });
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleCompleteReset = async () => {
    if (!onResetAllEmails) return;

    if (window.confirm('Are you sure you want to perform a COMPLETE EMAIL RESET? This will DELETE ALL EMAILS from the system and fetch only the 20 most recent email threads from Gmail. This action cannot be undone.')) {
      setIsCompletelyResetting(true);
      try {
        await onResetAllEmails();
      } finally {
        setIsCompletelyResetting(false);
      }
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
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
          <div className="fixed inset-0 bg-black/25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-8 text-left align-middle shadow-xl transition-all">
                <Dialog.Title as="div" className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-semibold text-gray-900">Auto-Reply Settings</h3>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-500"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </Dialog.Title>

                <div>
                  <div className="space-y-8">
                    <div>
                      <h4 className="text-base font-medium text-gray-900 mb-2 flex items-center gap-2">
                        <span role="img" aria-label="thinking" className="text-3xl">🤔</span>
                        Similarity Threshold
                      </h4>
                      <div>
                        <div className="flex items-center gap-4">
                          <div className="relative w-full">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={localSettings.similarityThreshold}
                              onChange={(e) => setLocalSettings({
                                ...localSettings,
                                similarityThreshold: parseInt(e.target.value)
                              })}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:bg-red-500 [&::-moz-range-thumb]:border-0"
                              style={{
                                background: `linear-gradient(to right, rgb(239 68 68) ${localSettings.similarityThreshold}%, rgb(229 231 235) ${localSettings.similarityThreshold}%)`
                              }}
                            />
                          </div>
                          <span className="text-sm text-gray-500 min-w-[3rem]">{localSettings.similarityThreshold}%</span>
                        </div>
                        <p className="mt-2 text-sm text-gray-500">
                          Threshold for determining when to create a new question vs. matching with an existing one
                        </p>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <span role="img" aria-label="wave" className="text-3xl"></span>
                          Default Greeting
                        </label>
                        <input
                          type="text"
                          value={localSettings.emailFormatting.greeting}
                          onChange={(e) => setLocalSettings({
                            ...localSettings,
                            emailFormatting: {
                              ...localSettings.emailFormatting,
                              greeting: e.target.value
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                            <span role="img" aria-label="filter" className="text-3xl">🔍</span>
                            Automatically move emails from these addresses
                          </label>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">
                              {localSettings.automaticFiltering.enabled ? 'On' : 'Off'}
                            </span>
                            <button
                              type="button"
                              className={`${localSettings.automaticFiltering.enabled ? 'bg-blue-600' : 'bg-gray-200'
                                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                              onClick={() => setLocalSettings({
                                ...localSettings,
                                automaticFiltering: {
                                  ...localSettings.automaticFiltering,
                                  enabled: !localSettings.automaticFiltering.enabled
                                }
                              })}
                            >
                              <span
                                className={`${localSettings.automaticFiltering.enabled ? 'translate-x-5' : 'translate-x-0'
                                  } pointer-events-none relative inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                              />
                            </button>
                          </div>
                        </div>

                        {localSettings.automaticFiltering.enabled && (
                          <div className="mt-4 space-y-4">
                            <div className="flex gap-2">
                              <input
                                type="email"
                                placeholder="Enter email address to block"
                                className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                value={newBlockedEmail}
                                onChange={(e) => setNewBlockedEmail(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddBlockedEmail();
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={handleAddBlockedEmail}
                                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                              >
                                Add
                              </button>
                            </div>

                            <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                              <div className="p-3 bg-gray-50 text-sm font-medium text-gray-700">
                                Blocked Email Addresses
                              </div>
                              <div className="max-h-48 overflow-y-auto p-2 space-y-2 bg-white">
                                {localSettings.automaticFiltering.blockedAddresses.length === 0 ? (
                                  <p className="text-sm text-gray-500 text-center py-2">
                                    No blocked email addresses yet
                                  </p>
                                ) : (
                                  localSettings.automaticFiltering.blockedAddresses.map((email, index) => (
                                    <div key={index} className="flex items-center justify-between p-2 rounded bg-gray-50 border border-gray-200">
                                      <span className="text-sm text-gray-900">{email}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveBlockedEmail(index)}
                                        className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-white"
                                      >
                                        <XMarkIcon className="h-4 w-4" />
                                      </button>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <span role="img" aria-label="handshake" className="text-3xl">🤝</span>
                          Signature Style
                        </label>
                        <input
                          type="text"
                          value={localSettings.emailFormatting.signatureStyle}
                          onChange={(e) => setLocalSettings({
                            ...localSettings,
                            emailFormatting: {
                              ...localSettings.emailFormatting,
                              signatureStyle: e.target.value
                            }
                          })}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <span role="img" aria-label="warning" className="text-3xl">⚠️</span>
                          Custom Formatting Instructions
                        </label>
                        <textarea
                          value={localSettings.emailFormatting.customPrompt}
                          onChange={(e) => setLocalSettings({
                            ...localSettings,
                            emailFormatting: {
                              ...localSettings.emailFormatting,
                              customPrompt: e.target.value
                            }
                          })}
                          rows={3}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    {onResetAllEmails && (
                      <div className="pt-6 border-t border-gray-200">
                        <h4 className="text-base font-medium text-gray-900 mb-4 flex items-center gap-2">
                          <span role="img" aria-label="reset" className="text-3xl">🔄</span>
                          Data Management
                        </h4>

                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                          <h5 className="text-sm font-medium text-gray-900 mb-2">Complete Email Reset</h5>
                          <p className="text-sm text-gray-600 mb-4">
                            <strong>Warning:</strong> This will delete all emails from the system and fetch only the 20 most recent
                            email threads from Gmail. All categorizations, matched FAQs, and suggested replies will be lost.
                            This action cannot be undone.
                          </p>
                          <button
                            type="button"
                            className="px-4 py-2 text-sm font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={handleCompleteReset}
                            disabled={isCompletelyResetting}
                          >
                            {isCompletelyResetting ? 'Performing Complete Reset...' : 'Delete All Emails & Fetch Latest'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-8 flex justify-end gap-3">
                  <button
                    type="button"
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    onClick={handleSave}
                  >
                    Save Settings
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
