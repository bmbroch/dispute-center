import React from 'react';

interface ConfidenceThresholdControlProps {
  value: number;
  onChange: (value: number) => void;
}

export const ConfidenceThresholdControl: React.FC<ConfidenceThresholdControlProps> = ({
  value,
  onChange,
}) => {
  const getConfidenceColor = (threshold: number) => {
    if (threshold >= 95) return 'text-green-600';
    if (threshold >= 85) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceMessage = (threshold: number) => {
    if (threshold >= 95) {
      return 'Recommended: High confidence ensures accurate auto-replies';
    }
    if (threshold >= 85) {
      return 'Caution: Medium confidence may lead to some inaccurate replies';
    }
    return 'Warning: Low confidence is not recommended for auto-replies';
  };

  const getConfidenceBackground = (threshold: number) => {
    if (threshold >= 95) return 'bg-green-100';
    if (threshold >= 85) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Confidence Threshold</h3>
        <span className={`text-lg font-medium ${getConfidenceColor(value)}`}>
          {value}%
        </span>
      </div>

      <div className="relative">
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, 
              #ef4444 0%, 
              #ef4444 85%, 
              #eab308 85%, 
              #eab308 95%, 
              #22c55e 95%, 
              #22c55e 100%
            )`,
          }}
        />
        
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0%</span>
          <span>85%</span>
          <span>95%</span>
          <span>100%</span>
        </div>
      </div>

      <div className={`mt-4 p-3 rounded-md ${getConfidenceBackground(value)}`}>
        <p className={`text-sm ${getConfidenceColor(value)}`}>
          {getConfidenceMessage(value)}
        </p>
      </div>
    </div>
  );
}; 