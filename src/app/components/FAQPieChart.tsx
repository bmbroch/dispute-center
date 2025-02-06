import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';

interface FAQ {
  question: string;
  frequency: number;
  category?: string;
}

interface FAQPieChartProps {
  faqs: FAQ[];
  totalEmails: number;
  supportEmails: number;
}

const CHART_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEEAD', // Yellow
  '#D4A5A5', // Pink
  '#9FA8DA', // Purple
  '#80DEEA', // Cyan
];

const SUPPORT_COLOR = '#4CAF50'; // Green for support emails
const NON_SUPPORT_COLOR = '#9E9E9E'; // Gray for non-support emails
const OTHER_SUPPORT_COLOR = '#81C784'; // Light green for other support emails

export default function FAQPieChart({ faqs, totalEmails, supportEmails }: FAQPieChartProps) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);
  const [showSupportOnly, setShowSupportOnly] = useState(false);

  useEffect(() => {
    if (!chartRef.current) return;

    // Cleanup previous chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Calculate total frequency of all FAQs
    const totalFAQFrequency = faqs.reduce((sum, faq) => sum + faq.frequency, 0);

    // Calculate "Other Support Emails" count
    const otherSupportCount = supportEmails - totalFAQFrequency;
    const nonSupportCount = totalEmails - supportEmails;

    // Prepare data for the chart
    const faqData = faqs.map((faq, index) => ({
      label: faq.question,
      value: faq.frequency,
      color: CHART_COLORS[index % CHART_COLORS.length]
    }));

    // Add "Other Support Emails" category if there are any
    if (otherSupportCount > 0) {
      faqData.push({
        label: 'Other Support Emails',
        value: otherSupportCount,
        color: OTHER_SUPPORT_COLOR
      });
    }

    // Only add non-support emails if not in support-only mode
    if (!showSupportOnly && nonSupportCount > 0) {
      faqData.push({
        label: 'Non-Support Emails',
        value: nonSupportCount,
        color: NON_SUPPORT_COLOR
      });
    }

    // Create the chart
    const ctx = chartRef.current.getContext('2d');
    if (!ctx) return;

    // Calculate total for percentage based on view mode
    const totalForPercentage = showSupportOnly ? supportEmails : totalEmails;

    chartInstance.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: faqData.map(d => d.label),
        datasets: [{
          data: faqData.map(d => d.value),
          backgroundColor: faqData.map(d => d.color),
          borderColor: 'white',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              usePointStyle: true,
              padding: 20,
              font: {
                size: 12
              },
              color: '#374151' // Dark gray text for better visibility
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.raw as number;
                const percentage = ((value / totalForPercentage) * 100).toFixed(1);
                return `${context.label}: ${value} (${percentage}%)`;
              }
            }
          }
        },
        layout: {
          padding: 20
        }
      }
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [faqs, totalEmails, supportEmails, showSupportOnly]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Email Distribution</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSupportOnly(false)}
            className={`px-3 py-1 text-sm rounded-lg ${
              !showSupportOnly 
                ? 'bg-blue-100 text-blue-700' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Emails
          </button>
          <button
            onClick={() => setShowSupportOnly(true)}
            className={`px-3 py-1 text-sm rounded-lg ${
              showSupportOnly 
                ? 'bg-blue-100 text-blue-700' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Support Only
          </button>
        </div>
      </div>
      <div className="h-[400px]">
        <canvas ref={chartRef} />
      </div>
    </div>
  );
} 