import React from 'react';

interface ConfidenceThresholdControlProps {
  value: number;
  onChange: (value: number) => void;
}

export const ConfidenceThresholdControl: React.FC<ConfidenceThresholdControlProps> = ({
  value,
  onChange,
}) => {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Confidence Threshold</h3>
        <p className="text-sm text-gray-600 mt-1">
          Set the minimum confidence level required for automatic responses
        </p>
      </div>

      <div className="relative pt-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">0%</span>
          <span className="text-sm font-medium text-gray-700">{value}%</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full">
          <div
            style={{ width: `${value}%` }}
            className={`h-full rounded-full ${
              value >= 95
                ? 'bg-green-500'
                : value >= 85
                ? 'bg-yellow-500'
                : 'bg-red-500'
            }`}
          ></div>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="absolute top-0 w-full h-8 opacity-0 cursor-pointer"
        />
      </div>

      <div className="mt-4">
        <div className={`p-3 rounded-lg ${
          value >= 95
            ? 'bg-green-50 text-green-800'
            : value >= 85
            ? 'bg-yellow-50 text-yellow-800'
            : 'bg-red-50 text-red-800'
        }`}>
          {value >= 95
            ? 'Recommended: High confidence ensures accurate auto-replies'
            : value >= 85
            ? 'Moderate confidence: Some responses may need review'
            : 'Low confidence: Most responses will need human review'}
        </div>
      </div>
    </div>
  );
}; 