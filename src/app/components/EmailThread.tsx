import { X } from 'lucide-react';

interface EmailThreadProps {
  email: {
    subject: string;
    from: string;
    body: string;
    date: string;
  };
  onClose: () => void;
}

function formatEmailBody(body: string): string {
  return body
    .replace(/^>+/gm, '') // Remove quote markers
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
    .trim();
}

function formatEmailAddress(email: string): { name: string; address: string } {
  const match = email.match(/(.*?)\s*<(.+?)>/) || ['', '', email];
  return {
    name: match[1].trim() || match[2],
    address: match[2]
  };
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  }).format(date);
}

export default function EmailThread({ email, onClose }: EmailThreadProps) {
  const sender = formatEmailAddress(email.from);
  const formattedBody = formatEmailBody(email.body);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 truncate pr-4">
            {email.subject}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Email Details */}
        <div className="flex-1 overflow-auto">
          <div className="p-6">
            {/* Sender Info */}
            <div className="flex items-start space-x-3 mb-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <span className="text-red-700 font-medium text-lg">
                    {sender.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {sender.name}
                </p>
                <p className="text-sm text-gray-500">
                  {sender.address}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {formatDate(email.date)}
                </p>
              </div>
            </div>

            {/* Email Body */}
            <div className="prose prose-sm max-w-none mt-6">
              {formattedBody.split('\n\n').map((paragraph, index) => (
                <p key={index} className="whitespace-pre-wrap mb-4 last:mb-0 text-gray-700">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 rounded-b-lg">
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-800 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 