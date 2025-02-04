import { useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { addDoc, collection } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { User } from 'firebase/auth';

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
  onSave: () => void;
  className?: string;
  children?: React.ReactNode;
}

export default function SaveAnalysisButton({ analysis, onSave, className, children }: SaveAnalysisButtonProps) {
  const { user } = useAuth();
  const db = getFirebaseDB();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!user?.email || !db) return;

    setSaving(true);
    setError(null);

    try {
      const analysesRef = collection(db, 'emailAnalyses');
      await addDoc(analysesRef, {
        userId: user.email,
        createdAt: new Date().toISOString(),
        ...analysis,
        updatedAt: new Date().toISOString()
      });

      const savedAnalyses = JSON.parse(localStorage.getItem('savedAnalyses') || '[]');
      savedAnalyses.unshift({
        ...analysis,
        userId: user.email,
        createdAt: new Date().toISOString()
      });
      localStorage.setItem('savedAnalyses', JSON.stringify(savedAnalyses.slice(0, 5))); // Keep last 5

      onSave();
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
        } ${className || ''}`}
      >
        {saving ? 'Saving...' : children || 'Save Analysis'}
      </button>
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}
    </div>
  );
} 