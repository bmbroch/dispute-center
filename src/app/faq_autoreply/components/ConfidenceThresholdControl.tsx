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
    <div className="flex items-center gap-3 bg-white rounded-lg px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Confidence:</span>
        <span className={`text-sm font-semibold ${
          value >= 95 ? 'text-green-600' :
          value >= 85 ? 'text-yellow-600' :
          'text-red-600'
        }`}>{value}%</span>
      </div>
      
      <div className="relative flex-1 w-32">
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            style={{ width: `${value}%` }}
            className={`h-full rounded-full transition-all ${
              value >= 95 ? 'bg-green-500' :
              value >= 85 ? 'bg-yellow-500' :
              'bg-red-500'
            }`}
          ></div>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="absolute top-1/2 -translate-y-1/2 w-full h-4 opacity-0 cursor-pointer"
          style={{
            WebkitAppearance: 'none',
            background: 'transparent'
          }}
        />
        <div 
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 rounded-full shadow-sm transition-all"
          style={{
            left: `calc(${value}% - 6px)`,
            borderColor: value >= 95 ? '#22c55e' : value >= 85 ? '#eab308' : '#ef4444'
          }}
        />
      </div>
    </div>
  );
}; 