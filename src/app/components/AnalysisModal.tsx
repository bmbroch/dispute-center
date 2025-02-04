import React from 'react';
import { SavedEmailAnalysis } from '@/types/analysis';
import AnalysisSummary from './AnalysisSummary';

interface AnalysisModalProps {
  analysis: SavedEmailAnalysis | null;
  onClose: () => void;
}

export default function AnalysisModal({ analysis, onClose }: AnalysisModalProps) {
  if (!analysis) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="min-h-[200px] w-full max-w-4xl relative">
        <AnalysisSummary 
          analysis={analysis} 
          onClose={onClose}
          showCloseButton={true}
        />
      </div>
    </div>
  );
} 