import { useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { addDoc, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase/firebase';

interface SaveAnalysisButtonProps {
  analysis: {
    totalEmails: number;
    supportEmails: number;
    faqs: Array<{
      question: string;
      typicalAnswer: string;
      frequency: number;
    }>;
    keyCustomerPoints: string[];
    customerSentiment: {
      overall: string;
      details: string;
    };
    recommendedActions: string[];
    tokenUsage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    timestamp: number;
    analyzedEmails: Array<{
      subject: string;
      from: string;
      body: string;
      date: string;
      isSupport: boolean;
      confidence: number;
      reason: string;
    }>;
  };
}

export default function SaveAnalysisButton({ analysis }: SaveAnalysisButtonProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!user) {
      setError('Please sign in to save analysis');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const analysisRef = collection(db, 'emailAnalyses');
      
      await addDoc(analysisRef, {
        ...analysis,
        userId: user.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const savedAnalyses = JSON.parse(localStorage.getItem('savedAnalyses') || '[]');
      savedAnalyses.unshift({
        ...analysis,
        userId: user.uid,
        createdAt: new Date().toISOString()
      });
      localStorage.setItem('savedAnalyses', JSON.stringify(savedAnalyses.slice(0, 5))); // Keep last 5

    } catch (err) {
      console.error('Error saving analysis:', err);
      setError('Failed to save analysis');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleSave}
        disabled={saving || !user}
        className={`px-4 py-2 rounded-lg text-sm ${
          saving 
            ? 'bg-gray-400 cursor-not-allowed' 
            : 'bg-green-600 hover:bg-green-700 text-white'
        }`}
      >
        {saving ? 'Saving...' : 'Save Analysis'}
      </button>
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}
    </div>
  );
} 