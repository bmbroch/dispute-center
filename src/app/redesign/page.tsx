"use client";

import { useState, useEffect, useCallback, Fragment, useMemo, useRef } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  MessageSquare,
  ChevronLeft,
  RefreshCw,
  MessageSquareText,
  Circle,
  CheckCircle,
  DownloadCloud,
  AlertCircle,
  Settings,
  MoreHorizontal,
  User,
  UserCircle,
  Mail,
  Clock,
  Search,
  ShieldCheck,
  Link2,
  ExternalLink,
  Trash,
  Plus,
  Menu,
  X,
  MailPlus,
  Download,
  ChevronDown,
  Filter,
  ThumbsDown,
  Send,
  Edit,
  Lightbulb,
  Ban,
  FileText,
  Loader,
  PlusCircle,
  Trash2
} from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import Link from "next/link"
import { Sidebar } from "@/app/components/Sidebar"
import { useAuth } from '@/lib/hooks/useAuth'
import { getFirebaseDB } from '@/lib/firebase/firebase'
import { collection, doc, setDoc, getDoc, getDocs, query, where, deleteDoc, writeBatch } from 'firebase/firestore'
import type { Email, ExtendedEmail, EmailContent, BaseEmail } from '@/types/email'
import { toast } from 'sonner'
import EmailRenderNew from '@/app/components/EmailRenderNew'
import { Label } from "@/components/ui/label"

// Add a StripeSubscriptionInfo interface 
interface StripeSubscriptionInfo {
  found: boolean;
  error?: string;
  hasActiveSubscription?: boolean;
  customer?: {
    id: string;
    email: string;
    created: number;
    name?: string;
    metadata?: Record<string, any>;
  };
  subscription?: {
    id: string;
    status: string;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    plan: {
      id: string;
      name: string;
      amount: number;
      currency: string;
      interval: string;
      intervalCount: number;
    };
    paymentMethod?: any;
  };
  recentInvoices?: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    date: number;
    pdfUrl?: string;
  }>;
  upcomingInvoice?: {
    amount: number;
    currency: string;
    date?: number;
  };
}

export default function RedesignPage() {
  const { user } = useAuth();
  const [selectedEmail, setSelectedEmail] = useState<ExtendedEmail | null>(null)
  const [editingReply, setEditingReply] = useState(false)
  const [emails, setEmails] = useState<ExtendedEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("unanswered")
  const [dataRefreshing, setDataRefreshing] = useState(false)
  const [newEmailsCount, setNewEmailsCount] = useState(0)
  const [newThreadIds, setNewThreadIds] = useState<string[]>([])
  const [showNewEmailsButton, setShowNewEmailsButton] = useState(false)
  const [loadingNewEmails, setLoadingNewEmails] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  
  // Store the last selected email for each tab to preserve selection when switching tabs
  const [tabSelections, setTabSelections] = useState<{[key: string]: ExtendedEmail | null}>({
    "unanswered": null,
    "ready": null,
    "faq": null,
    "not-relevant": null,
    "answered": null
  });
  
  // Helper function to check if the user was the last to send a message
  const isUserLastSender = (email: ExtendedEmail, currentUser: any) => {
    if (!email || !email.threadMessages || email.threadMessages.length === 0) {
      return false;
    }
    
    // Sort messages by date
    const sortedMessages = [...email.threadMessages].sort((a, b) => {
      const dateA = new Date(a.receivedAt || 0);
      const dateB = new Date(b.receivedAt || 0);
      return dateB.getTime() - dateA.getTime();
    });
    
    // Check if the latest message is from the current user
    const latestMessage = sortedMessages[0];
    return latestMessage && latestMessage.sender?.includes(currentUser?.email);
  };
  
  // Filter emails by status based on FAQ autoreply v2 logic
  const unansweredEmails = emails.filter(email => 
    !email.isReplied && 
    email.status !== 'not_relevant' && 
    !email.isNotRelevant &&
    !isUserLastSender(email, user) // Don't include emails where the user was last to reply
  )
  
  const readyEmails = emails.filter(email => 
    email.status === 'processed' && 
    email.suggestedReply && 
    !email.isReplied && 
    !isUserLastSender(email, user)
  )
  
  const answeredEmails = emails.filter(email => 
    isUserLastSender(email, user) // Emails where the user was the last to reply
  )
  
  const notRelevantEmails = emails.filter(email => 
    email.status === 'not_relevant' || 
    email.isNotRelevant
  )

  // Handle selecting an email without triggering loading state
  const handleSelectEmail = (email: ExtendedEmail) => {
    // Clear any isNew animation flag from the email being selected
    // to prevent unwanted animation when clicking
    if (email.isNew) {
      // First update the emails array to remove the isNew flag from all emails
      setEmails(prevEmails => 
        prevEmails.map(e => ({
          ...e,
          isNew: false // Remove animation flag
        }))
      );
    }
    
    setSelectedEmail(email);
    // Also store this selection for the current tab
    setTabSelections(prev => ({
      ...prev,
      [activeTab]: email
    }));
    
    // On mobile, switch to detail view when an email is selected
    setMobileView('detail');
  };
  
  // Function to go back to email list on mobile
  const handleBackToList = () => {
    setMobileView('list');
  };
  
  // Utility function to clear all isNew flags, used when loading new emails
  const clearNewEmailAnimations = useCallback(() => {
    setEmails(prevEmails => 
      prevEmails.map(email => ({
        ...email,
        isNew: false
      }))
    );
  }, []);

  // Handle tab changes - preserve email selections for each tab
  const handleTabChange = (tab: string) => {
    console.log("Tab changed to:", tab);
    
    // Always clear the selected email when changing tabs
    // This ensures we don't show an email from a different tab
    setSelectedEmail(null);
    
    // Set the active tab
    setActiveTab(tab);
    
    // For email tabs, reset to list view on mobile
    if (tab !== "faq") {
      setMobileView('list');
    }
  };

  // Load emails from Firebase
  const loadEmailsFromFirebase = useCallback(async () => {
    const loadingId = Date.now().toString(); // Generate unique ID for this load operation
    console.log(`[${loadingId}] Starting to load emails from Firebase`);
    try {
      // We don't need to reset the loading state here since it's now handled in the useEffect
      const db = getFirebaseDB();
      if (!db || !user?.email) {
        console.log(`[${loadingId}] DB or user email not available`);
        setDataRefreshing(false);
        setLoading(false);
        return [];
      }

      // Get emails from user's subcollections
      const userEmailsRef = collection(db, `users/${user.email}/emails`);
      const userThreadCacheRef = collection(db, `users/${user.email}/thread_cache`);
      const userEmailContentRef = collection(db, `users/${user.email}/email_content`);

      console.log(`[${loadingId}] Fetching email data from Firestore collections`);
      const [emailsSnapshot, threadCacheSnapshot, emailContentSnapshot] = await Promise.all([
        getDocs(userEmailsRef),
        getDocs(userThreadCacheRef),
        getDocs(userEmailContentRef)
      ]);

      console.log(`[${loadingId}] Found ${emailsSnapshot.size} email documents, ${threadCacheSnapshot.size} thread cache documents, and ${emailContentSnapshot.size} email content documents`);

      // Create maps to merge data
      const emailMap = new Map<string, ExtendedEmail>();
      const threadToEmailMap = new Map<string, string>(); // Maps threadId to emailId
      const contentMap = new Map<string, any>();
      const threadMap = new Map<string, { lastMessageTimestamp: number }>();

      // Process thread cache documents first to get latest timestamps
      threadCacheSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const lastMessageTimestamp = typeof data.lastMessageTimestamp === 'number' ?
          data.lastMessageTimestamp :
          (typeof data.lastMessageTimestamp === 'string' ? parseInt(data.lastMessageTimestamp) : Date.now());

        threadMap.set(doc.id, {
          lastMessageTimestamp
        });

        // If thread cache has emailId, track the relationship
        if (data.emailId) {
          threadToEmailMap.set(doc.id, data.emailId);
        }
      });

      // Process email content documents
      emailContentSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        contentMap.set(doc.id, data.content);
      });

      // First pass: Process regular emails
      emailsSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const docId = doc.id;

        // Skip documents that don't have basic email properties
        if (!data.subject || !data.sender) {
          return;
        }

        // Check if this document ID is a threadId or an emailId
        const isThreadId = data.id && data.id !== docId;
        const threadId = isThreadId ? docId : data.threadId;
        const emailId = isThreadId ? data.id : docId;

        // Ensure receivedAt is a number
        const receivedAt = typeof data.receivedAt === 'number' ?
          data.receivedAt :
          (typeof data.receivedAt === 'string' ? parseInt(data.receivedAt) : Date.now());

        // Get thread timestamp
        const threadInfo = threadMap.get(threadId || '');

        // Determine sortTimestamp with proper fallbacks
        const sortTimestamp = data.sortTimestamp && typeof data.sortTimestamp === 'number' ?
          data.sortTimestamp :
          threadInfo?.lastMessageTimestamp ||
          receivedAt;

        const email: ExtendedEmail = {
          ...data,
          id: emailId,
          threadId: threadId || emailId, // Fallback to emailId if no threadId
          subject: data.subject,
          sender: data.sender,
          content: contentMap.get(emailId) || data.content,
          receivedAt,
          sortTimestamp,
          status: data.status || 'pending',
          isRefreshing: false // Make sure this is initialized properly
        };

        // Use threadId as the key for deduplication - emails with same threadId are the same conversation
        const existingEmail = emailMap.get(email.threadId);

        if (existingEmail) {
          // If we already have an email with this threadId, keep the most recently updated one
          const existingLastUpdated = (existingEmail as any).lastUpdated || 0;
          const newLastUpdated = (email as any).lastUpdated || 0;

          if (newLastUpdated > existingLastUpdated) {
            emailMap.set(email.threadId, email);
          }
        } else {
          emailMap.set(email.threadId, email);
        }
      });

      // Convert map to array and sort by sortTimestamp
      const sortedEmails = Array.from(emailMap.values())
        .sort((a, b) => {
          const aTimestamp = a.sortTimestamp || 0;
          const bTimestamp = b.sortTimestamp || 0;
          return bTimestamp - aTimestamp;
        });

      console.log(`[${loadingId}] Processed ${sortedEmails.length} unique emails from Firebase`);
      
      // Update state with sorted emails
      setEmails(sortedEmails);
      
      // If there's a selected email, try to find the updated version of it
      if (selectedEmail) {
        const updatedSelectedEmail = sortedEmails.find(email => email.id === selectedEmail.id);
        if (updatedSelectedEmail) {
          console.log(`[${loadingId}] Updating selected email: ${updatedSelectedEmail.id}`);
          setSelectedEmail(updatedSelectedEmail);
          
          // Also update the tab selections state
          setTabSelections(prev => ({
            ...prev,
            [activeTab]: updatedSelectedEmail
          }));
        }
      } 
      // If no email is selected and we have emails, select the first one
      else if (sortedEmails.length > 0 && !selectedEmail) {
        console.log(`[${loadingId}] No email selected, selecting first email: ${sortedEmails[0].id}`);
        setSelectedEmail(sortedEmails[0]);
        
        // Also update the tab selections state
        setTabSelections(prev => ({
          ...prev,
          [activeTab]: sortedEmails[0]
        }));
      }

      // Return the sorted emails so the Promise resolves with them
      console.log(`[${loadingId}] Email loading completed successfully`);
      return sortedEmails;
    } catch (error) {
      console.error(`[${loadingId}] Error loading emails from Firebase:`, error);
      toast.error('Failed to load emails');
      // Re-throw the error so the Promise is rejected
      throw error;
    } finally {
      // Always ensure both states are reset
      console.log(`[${loadingId}] Resetting loading states in finally block`);
      setDataRefreshing(false);
      setLoading(false);
    }
  }, [user, selectedEmail, activeTab]);

  // Update the useEffect hook to handle initial loading
  useEffect(() => {
    let mounted = true;
    const loadInitialData = async () => {
      if (user?.email) {
        console.log('Starting initial data load');
        try {
          // Reset both loading states at the start to avoid stale state
          if (mounted) {
            // On first load, show the loading indicator
            if (emails.length === 0) {
              setLoading(true);
            } else {
              // If we already have emails, just refresh without showing full loading state
              setDataRefreshing(true);
            }
          }
          
          const result = await loadEmailsFromFirebase();
          console.log('Initial data loaded successfully', result ? result.length : 0, 'emails');
          
          // Ensure we're on the unanswered tab by default
          if (mounted) {
            setActiveTab("unanswered");
            
            // Select the first unanswered email if available
            const filteredUnanswered = result.filter(email => 
              !email.isReplied && 
              email.status !== 'not_relevant' && 
              !email.isNotRelevant &&
              !isUserLastSender(email, user)
            );
            
            if (filteredUnanswered.length > 0) {
              setSelectedEmail(filteredUnanswered[0]);
              // Update the tab selections
              setTabSelections(prev => ({
                ...prev,
                "unanswered": filteredUnanswered[0]
              }));
            }
          }
        } catch (error) {
          console.error('Error loading initial data:', error);
        } finally {
          // Only update state if component is still mounted
          if (mounted) {
            console.log('Resetting loading states after initial load');
            setLoading(false);
            setDataRefreshing(false);
          }
        }
      }
    };
    
    loadInitialData();
    
    // When component unmounts, reset loading states and set mounted flag to false
    return () => {
      console.log('Component unmounting, cleaning up loading states');
      mounted = false; 
      setLoading(false);
      setDataRefreshing(false);
    };
  }, [user?.email]); // Remove loadEmailsFromFirebase from dependencies to avoid infinite loops

  // Format the received time/date
  const formatEmailTime = (timestamp: string | number | undefined) => {
    if (!timestamp) return '';
    
    const date = new Date(typeof timestamp === 'string' ? parseInt(timestamp) : timestamp);
    const now = new Date();
    const diffInHours = Math.abs(now.getTime() - date.getTime()) / 36e5;
    
    if (diffInHours < 24 && now.getDate() === date.getDate()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 48) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Enhanced email preview component
  const EmailPreview = ({ content }: { content: string | EmailContent | undefined }) => {
    if (!content) return <p className="text-sm text-gray-400 italic">No content available</p>;
    
    // Function to clean up HTML content
    const cleanHtml = (html: string) => {
      // Remove HTML tags but keep line breaks
      const cleanedText = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<div>/gi, '\n')
        .replace(/<\/div>/gi, '')
        .replace(/<p>/gi, '\n')
        .replace(/<\/p>/gi, '')
        .replace(/<[^>]*>?/gm, '');
      
      // Decode HTML entities
      const div = document.createElement('div');
      div.innerHTML = cleanedText;
      return div.textContent || div.innerText || '';
    };
    
    // Get clean preview text
    const getPreviewText = () => {
      if (typeof content === 'string') {
        return cleanHtml(content);
      } else if (content.html) {
        return cleanHtml(content.html);
      } else if (content.text) {
        return content.text;
      }
      return '';
    };
    
    // Get the cleaned text and trim it
    const text = getPreviewText();
    // Get first non-empty lines, up to 3 lines
    const lines = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('>'))  // Skip quoted lines
      .slice(0, 2);  // Show max 2 lines to keep it compact
    
    if (lines.length === 0) {
      return <p className="text-sm text-gray-400 italic">No preview available</p>;
    }
    
    return (
      <div>
        {lines.map((line, i) => (
          <p key={i} className={`text-xs ${i === 0 ? 'text-gray-700 font-normal' : 'text-gray-500'} line-clamp-1`}>
            {line}
          </p>
        ))}
      </div>
    );
  };

  // Extract text from complex content structure for search and filtering
  const getEmailPreview = (content: string | EmailContent | undefined) => {
    if (!content) return '';
    
    if (typeof content === 'string') {
      return content.substring(0, 100) + '...';
    } else if (content.text) {
      return content.text.substring(0, 100) + '...';
    } else if (content.html) {
      const div = document.createElement('div');
      div.innerHTML = content.html;
      const text = div.textContent || div.innerText || '';
      return text.substring(0, 100) + '...';
    }
    
    return '';
  };
  
  // Handle refreshing emails
  const handleRefreshEmails = () => {
    console.log('Manual refresh triggered');
    setDataRefreshing(true);
    loadEmailsFromFirebase()
      .then((emails) => {
        console.log('Manual refresh completed successfully', emails ? emails.length : 0, 'emails');
        toast.success('Emails refreshed successfully');
      })
      .catch((error) => {
        console.error('Error refreshing emails:', error);
        toast.error('Failed to refresh emails');
      })
      .finally(() => {
        // Ensure dataRefreshing is always reset
        console.log('Resetting dataRefreshing state after manual refresh');
        setDataRefreshing(false); 
      });
  };

  // Refresh a single email
  const refreshSingleEmail = async (email: ExtendedEmail) => {
    try {
      if (!user?.accessToken) {
        throw new Error('User access token not available');
      }

      // Set loading state for this specific email
      setEmails((prevEmails) => {
        return prevEmails.map((e) => {
          if (e.threadId === email.threadId) {
            return { ...e, isRefreshing: true };
          }
          return e;
        });
      });

      const makeRequest = async (token: string) => {
        const response = await fetch('/api/emails/refresh-single', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            threadId: email.threadId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to refresh email');
        }

        return response;
      };

      const response = await makeRequest(user.accessToken);
      const data = await response.json();

      // Update the email content and preserve the original timestamp for sorting
      setEmails((prevEmails) => {
        const updatedEmails = prevEmails.map((e) => {
          if (e.threadId === email.threadId) {
            // Use the receivedAt timestamp from the API response for sorting
            const receivedAt = data.receivedAt || e.receivedAt;
            const sortTimestamp = typeof receivedAt === 'number'
              ? receivedAt
              : typeof receivedAt === 'string'
                ? new Date(receivedAt).getTime()
                : e.sortTimestamp;

            return {
              ...e,
              ...data,
              isRefreshing: false,
              receivedAt: receivedAt,
              sortTimestamp: sortTimestamp,
              lastRefreshed: Date.now() // Track when it was refreshed separately
            };
          }
          return e;
        });

        // If the email we've refreshed is the currently selected email, update it
        if (selectedEmail && selectedEmail.threadId === email.threadId) {
          const updatedEmail = updatedEmails.find(e => e.threadId === email.threadId);
          if (updatedEmail) {
            setSelectedEmail(updatedEmail);
            
            // Also update the tab selections state
            setTabSelections(prev => ({
              ...prev,
              [activeTab]: updatedEmail
            }));
          }
        }

        return updatedEmails;
      });

      // Save to Firebase
      const firebaseDB = getFirebaseDB();
      if (firebaseDB && user?.email) {
        // Use email for the path instead of uid
        const emailsRef = collection(firebaseDB, `users/${user.email}/emails`);
        const emailDoc = doc(emailsRef, email.threadId);

        // Preserve the original receivedAt timestamp
        const receivedAt = data.receivedAt || email.receivedAt;
        const sortTimestamp = typeof receivedAt === 'number'
          ? receivedAt
          : typeof receivedAt === 'string'
            ? new Date(receivedAt).getTime()
            : email.sortTimestamp;

        await setDoc(emailDoc, {
          ...email,
          ...data,
          receivedAt: receivedAt,
          sortTimestamp: sortTimestamp,
          lastRefreshed: Date.now()
        }, { merge: true });
      }

      toast.success('Email refreshed successfully');
    } catch (error) {
      console.error('Error refreshing email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to refresh email');
    } finally {
      // Reset loading states
      setEmails((prevEmails) => {
        return prevEmails.map((e) => {
          if (e.threadId === email.threadId) {
            return { ...e, isRefreshing: false };
          }
          return e;
        });
      });
    }
  };

  // FAQ state management
  const [faqLibrary, setFaqLibrary] = useState([
    {
      id: "1",
      question: "How do I cancel my subscription?",
      answer:
        "You can cancel your subscription at any time from your account settings. Once canceled, you will still have access to the service until the end of your billing period.",
    },
    {
      id: "2",
      question: "How to reset your password",
      answer:
        "To reset your password, please click on the 'Forgot Password' link on the login page. You will receive an email with instructions to create a new password.",
    },
  ])
  const [showAddFAQModal, setShowAddFAQModal] = useState(false)
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null)
  const [newFAQ, setNewFAQ] = useState({ question: '', answer: '' })

  // Load FAQs from localStorage on mount
  useEffect(() => {
    const savedFaqs = localStorage.getItem('redesign_faqs');
    if (savedFaqs) {
      setFaqLibrary(JSON.parse(savedFaqs));
    } else {
      // Initialize with default FAQs
      localStorage.setItem('redesign_faqs', JSON.stringify(faqLibrary));
    }
  }, []);

  // Update localStorage whenever FAQs change
  useEffect(() => {
    localStorage.setItem('redesign_faqs', JSON.stringify(faqLibrary));
  }, [faqLibrary]);
  
  // Function to generate a reply based on FAQ
  const generateReplyFromFAQ = (email: ExtendedEmail) => {
    // Use existing suggestedReply if available
    if (email.suggestedReply) return email.suggestedReply;
    
    // For emails without a suggested reply, use matchedFAQ if available
    if (email.matchedFAQ) {
      return `Dear ${email.sender.split('@')[0].split('.').map((name: string) => 
        name.charAt(0).toUpperCase() + name.slice(1)).join(' ')},

Thank you for reaching out to our support team.

${email.matchedFAQ.answer}

If you have any further questions, please don't hesitate to contact us.

Best regards,
Support Team`;
    }
    
    return null;
  }

  // Function to handle generating a reply
  const handleGenerateReply = () => {
    if (!selectedEmail) return;

    const generatedReply = generateReplyFromFAQ(selectedEmail);
    if (generatedReply) {
      // Update the selected email to include the suggested reply
      setSelectedEmail({
        ...selectedEmail,
        suggestedReply: generatedReply,
        status: 'processed',
      });
    }
  }

  // Safe date string conversion helper (from FAQ autoreply v2)
  const safeISOString = (date: any): string => {
    try {
      if (typeof date === 'number') {
        return new Date(date).toISOString();
      } else if (date instanceof Date) {
        return date.toISOString();
      } else if (typeof date === 'string') {
        return new Date(date).toISOString();
      }
      return 'Invalid Date';
    } catch (err) {
      console.error('Invalid date value:', date, err);
      return 'Invalid Date';
    }
  };

  // Function to automatically check for new emails (adapted from FAQ autoreply v2)
  const autoCheckNewEmails = async () => {
    if (!user) return;

    try {
      // Check if emails array is valid and ready to use
      if (!Array.isArray(emails)) {
        console.warn('Emails not yet initialized for autoCheckNewEmails');
        return;
      }

      // Get the timestamp of the most recent email we have
      let latestEmailTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000; // Default: 30 days ago
      
      if (emails.length > 0) {
        try {
          // Safely calculate the maximum timestamp - check both sortTimestamp AND receivedAt
          const emailsWithTimestamps = emails
            .filter(e => e && (e.receivedAt || e.sortTimestamp)) 
            .map(e => {
              // First check sortTimestamp which is usually more reliable
              if (typeof e.sortTimestamp === 'number' && e.sortTimestamp > 0) {
                return {
                  id: e.id,
                  threadId: e.threadId,
                  timestamp: e.sortTimestamp,
                };
              }

              // Fall back to receivedAt if no valid sortTimestamp
              const timestamp = typeof e.receivedAt === 'number'
                ? e.receivedAt
                : new Date(e.receivedAt).getTime();

              return {
                id: e.id,
                threadId: e.threadId,
                timestamp: isNaN(timestamp) ? 0 : timestamp,
              };
            })
            .filter(item => item.timestamp > 0);

          // Sort by timestamp (newest first)
          emailsWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);

          if (emailsWithTimestamps.length > 0) {
            latestEmailTimestamp = emailsWithTimestamps[0].timestamp;
          }
        } catch (err) {
          console.error('Error calculating latest email timestamp:', err);
          // Continue with the default timestamp
        }
      }

      // Safely extract thread IDs
      const existingThreadIds = emails
        .filter(e => e && e.threadId)
        .map(e => e.threadId)
        .filter(Boolean);

      const response = await fetch('/api/emails/check-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          lastEmailTimestamp: latestEmailTimestamp,
          existingThreadIds
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to check for new emails:', errorData.error);
        return;
      }

      const data = await response.json();

      if (data.newEmailsCount > 0) {
        console.log(`Found ${data.newEmailsCount} new emails out of ${data.totalFound} total emails`);
        setNewEmailsCount(data.newEmailsCount);
        setNewThreadIds(data.newThreadIds || []);
        setShowNewEmailsButton(true);
      }
    } catch (error) {
      console.error('Error checking for new emails:', error);
    }
  };

  // Function to load new emails when the button is clicked
  const handleLoadNewEmails = async () => {
    if (newEmailsCount > 0) {
      try {
        setLoadingNewEmails(true);
        // Short delay to show loading state
        await new Promise(resolve => setTimeout(resolve, 300));

        // Clear any existing 'isNew' flags first to avoid stale animations
        clearNewEmailAnimations();

        if (!user?.accessToken) {
          toast.error("Authentication error. Please sign in again.");
          setLoadingNewEmails(false);
          return;
        }

        // Use the refresh-batch endpoint which accepts thread IDs
        const response = await fetch('/api/emails/refresh-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.accessToken}`
          },
          body: JSON.stringify({
            threadIds: newThreadIds
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch new emails: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.refreshedEmails && data.refreshedEmails.length > 0) {
          // Format the emails in the same structure as our existing emails
          const newEmails = data.refreshedEmails.map((email: any) => {
            // Ensure we always use the actual received timestamp from Gmail
            const receivedTimestamp = typeof email.receivedAt === 'number'
              ? email.receivedAt
              : new Date(email.receivedAt).getTime();

            return {
              ...email,
              receivedAt: receivedTimestamp,
              sortTimestamp: receivedTimestamp,
              status: email.status || 'pending',
              isRefreshing: false,
              isNew: true // Mark as new for animation
            } as ExtendedEmail;
          });

          // Merge with existing emails, preserving existing data
          setEmails(prevEmails => {
            const combinedEmails = [...prevEmails];
            
            newEmails.forEach((newEmail: ExtendedEmail) => {
              const existingIndex = combinedEmails.findIndex(e => 
                e.threadId === newEmail.threadId || e.id === newEmail.id
              );
              
              if (existingIndex >= 0) {
                // Update existing email
                combinedEmails[existingIndex] = {
                  ...combinedEmails[existingIndex],
                  ...newEmail,
                  isNew: true // Mark for animation
                };
              } else {
                // Add new email
                combinedEmails.push(newEmail);
              }
            });
            
            // Sort by timestamp (newest first)
            return combinedEmails.sort((a, b) => 
              (b.sortTimestamp || 0) - (a.sortTimestamp || 0)
            );
          });

          // Save new emails to Firebase
          const firebaseDB = getFirebaseDB();
          if (firebaseDB && user?.email) {
            const batch = writeBatch(firebaseDB);
            const emailsRef = collection(firebaseDB, `users/${user.email}/emails`);
            
            newEmails.forEach((email: ExtendedEmail) => {
              const emailDoc = doc(emailsRef, email.threadId);
              batch.set(emailDoc, {
                ...email,
                lastUpdated: Date.now()
              }, { merge: true });
            });
            
            await batch.commit();
          }

          toast.success(`Loaded ${newEmails.length} new emails`);
          
          // Clear animation flag after 2 seconds
          setTimeout(() => {
            clearNewEmailAnimations();
          }, 2000);
        }

        // Reset state
        setNewEmailsCount(0);
        setNewThreadIds([]);
        setShowNewEmailsButton(false);
      } catch (error) {
        console.error('Error loading new emails:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to load new emails');
      } finally {
        setLoadingNewEmails(false);
      }
    }
  };

  // Add a useEffect to track emails with isNew flag and clear them after animation completes
  useEffect(() => {
    // Find any emails that have the isNew flag set
    const hasNewEmails = emails.some(email => email.isNew === true);
    
    // If we have new emails, set a timeout to clear the animation flag
    if (hasNewEmails) {
      const timer = setTimeout(() => {
        clearNewEmailAnimations();
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [emails, clearNewEmailAnimations]);

  // Email list component with mobile-friendly improvements
  const EmailList = ({ emails }: { emails: ExtendedEmail[] }) => {
    // Show loading skeletons only when initially loading
    if (loading && emails.length === 0) {
      return (
        <div className="space-y-3">
          {Array(3).fill(0).map((_, index) => (
            <div key={index} className="p-5 rounded-xl animate-pulse bg-white">
              <div className="flex gap-3">
                <div className="h-10 w-10 bg-gray-200 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    
    // Show empty state when there are no emails
    if (emails.length === 0) {
      if (dataRefreshing) {
        // If we're refreshing but have no emails, show a simple loading message
        return (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <RefreshCw className="h-8 w-8 text-indigo-600 animate-spin mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-1">Loading emails...</h3>
          </div>
        );
      }
      
      return (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <MessageSquareText className="h-12 w-12 text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-1">No emails found</h3>
          <p className="text-sm text-gray-500">There are no emails in this category</p>
        </div>
      );
    }
    
    return (
      <div className="space-y-2">
        {/* Load More Emails Button */}
        {showNewEmailsButton && (
          <div className="sticky top-0 z-10 bg-white dark:bg-gray-950 py-2 border-b mb-2">
            <Button 
              variant="outline" 
              className="w-full flex items-center justify-center gap-2"
              onClick={handleLoadNewEmails}
              disabled={loadingNewEmails}
            >
              {loadingNewEmails ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="h-4 w-4" />
              )}
              {loadingNewEmails ? 'Loading...' : `Load ${newEmailsCount} New Email${newEmailsCount !== 1 ? 's' : ''}`}
            </Button>
          </div>
        )}
        
        {/* Skeleton loaders for new emails being loaded */}
        {loadingNewEmails && (
          <div className="space-y-2 mb-2">
            {Array.from({ length: Math.min(newEmailsCount, 5) }).map((_, i) => (
              <div key={`skeleton-${i}`} className="p-3 rounded-lg animate-pulse bg-white">
                <div className="flex gap-3">
                  <div className="h-10 w-10 bg-gray-200 rounded-full"></div>
                  <div className="flex-1">
                    <div className="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Existing email list with original styling */}
        {emails.map((email: ExtendedEmail) => {
          const hasQuestions = email.questions && email.questions.length > 0;
          const hasMatchingFAQ = email.matchedFAQ != null;
          const preview = getEmailPreview(email.content);
          const isSelected = selectedEmail?.id === email.id;
          
          return (
            <div
              key={email.id}
              className={`p-3 md:p-3 rounded-lg cursor-pointer transition-all hover:bg-white touch-manipulation ${
                isSelected
                  ? "bg-white border-l-4 border-indigo-600 shadow-sm"
                  : "bg-gray-50 border-l-4 border-transparent"
              } ${email.isNew ? 'animate-slide-down' : ''}`}
              onClick={() => handleSelectEmail(email)}
            >
              <div className="flex gap-3">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="bg-blue-100 text-indigo-600">
                    {email.sender.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="text-base font-medium truncate text-gray-800">{email.subject}</h3>
                    <div className="flex items-center shrink-0 whitespace-nowrap">
                      {email.isRefreshing && (
                        <RefreshCw className="h-3 w-3 text-indigo-600 animate-spin mr-1" />
                      )}
                      <span className="text-xs text-gray-500">
                        {formatEmailTime(email.receivedAt)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-1 truncate">
                    <span className="font-medium">{email.sender.split('@')[0]}</span>
                    <span className="text-gray-400"> &lt;{email.sender}&gt;</span>
                  </div>
                  
                  <div className="mb-1">
                    <EmailPreview content={email.content} />
                  </div>
                  
                  <div className="flex justify-between items-center mt-1">
                    <div className="flex flex-wrap items-center gap-1">
                      {email.status === 'pending' && (
                        <Badge className="bg-indigo-50 text-indigo-600 hover:bg-indigo-50 px-2 rounded-full font-normal text-xs py-0">
                          New
                        </Badge>
                      )}
                      {email.status === 'processed' && email.suggestedReply && (
                        <Badge className="bg-green-50 text-green-700 hover:bg-green-50 px-2 rounded-full font-normal text-xs py-0">
                          Ready
                        </Badge>
                      )}
                      {hasMatchingFAQ && (
                        <Badge className="bg-indigo-50 text-indigo-600 hover:bg-indigo-50 px-2 rounded-full font-normal text-xs py-0">
                          FAQ
                        </Badge>
                      )}
                    </div>
                    <div>
                      {email.status === 'answered' || email.isReplied ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <Circle className="h-4 w-4 text-gray-300" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Utility function to truncate text with specified maximum length
  const truncateText = (text: string, maxLength: number = 60): string => {
    if (!text) return '';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  };

  // Add a utility function to format dates
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Add a utility function to format currency
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  // Email detail component with back button for mobile
  const EmailDetail = ({ email, showReply = false }: { email: ExtendedEmail; showReply?: boolean }) => {
    const [quickReply, setQuickReply] = useState("")
    const [isLoadingStripe, setIsLoadingStripe] = useState(false)
    const [stripeInfo, setStripeInfo] = useState<StripeSubscriptionInfo | null>(null)
    const [showStripeInfo, setShowStripeInfo] = useState(false)
    const { user } = useAuth(); // Get the current user from auth context

    if (!email) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
          <MessageSquareText className="h-16 w-16 text-gray-300 mb-4" />
          <h3 className="text-xl font-medium text-gray-700 mb-2">No email selected</h3>
          <p className="text-sm text-gray-500">Select an email from the list to view its details</p>
        </div>
      );
    }

    // Extract sender name from email
    const getSenderName = () => {
      try {
        return email.sender
          .split("@")[0]
          .split(".")
          .map((name: string) => name.charAt(0).toUpperCase() + name.slice(1))
          .join(" ");
      } catch (error) {
        return email.sender;
      }
    };

    // Function to extract clean email from sender format
    const extractEmail = (sender: string): string => {
      // Check if it's in the format "Name <email@example.com>"
      const emailRegex = /<([^>]+)>/;
      const match = sender.match(emailRegex);
      
      if (match && match[1]) {
        return match[1].trim();
      }
      
      // If not in that format, return the original (or attempt to find an email)
      const anyEmailRegex = /[\w.-]+@[\w.-]+\.\w+/;
      const anyMatch = sender.match(anyEmailRegex);
      
      if (anyMatch) {
        return anyMatch[0].trim();
      }
      
      // Just return the input if we can't extract anything
      return sender.trim();
    };

    // Function to fetch Stripe subscription data
    const checkStripeStatus = async () => {
      setIsLoadingStripe(true);
      try {
        // Extract just the email part from the sender field
        const senderEmail = extractEmail(email.sender);
        
        // Check if user is available
        if (!user || !user.email) {
          toast.error('User information not available. Please try again after logging in.');
          return;
        }
        
        // Log the request details for debugging
        console.log('Checking Stripe status for email:', {
          originalSender: email.sender,
          extractedEmail: senderEmail,
          currentUserEmail: user.email
        });
        
        // We need to pass the current user's email to get their Stripe API key
        const apiUrl = `/api/stripe/check-subscription?customerEmail=${encodeURIComponent(senderEmail)}&userEmail=${encodeURIComponent(user.email)}`;
        console.log('Fetching from:', apiUrl);
        
        const response = await fetch(apiUrl);
        
        // Log the response status and headers for debugging
        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries([...response.headers.entries()]));
        
        // If response is not OK, handle the error more carefully
        if (!response.ok) {
          // Check if the response is JSON or HTML
          const contentType = response.headers.get('content-type') || '';
          
          if (contentType.includes('application/json')) {
            // If it's JSON, parse it as usual
            const errorData = await response.json();
            console.error('API error response:', errorData);
            throw new Error(errorData.error || errorData.details || 'Failed to check Stripe status');
          } else {
            // If it's not JSON (probably HTML), get the text and log it
            const errorText = await response.text();
            console.error('Non-JSON error response:', {
              status: response.status,
              contentType,
              errorTextPreview: errorText.slice(0, 500) + '...'
            });
            throw new Error(`Server error: ${response.status} - Response was not JSON`);
          }
        }

        // Try to parse the response as JSON with error handling
        let data;
        try {
          const responseText = await response.text();
          console.log('Response preview:', responseText.slice(0, 100) + '...');
          data = JSON.parse(responseText);
        } catch (parseError) {
          console.error('Error parsing JSON response:', parseError);
          throw new Error('Failed to parse response from server');
        }
        
        console.log('Stripe data:', data);
        setStripeInfo(data);
        
        if (!data.found) {
          // Show toast and don't open dialog if no customer found
          toast.info('No Stripe customer found for this email address');
        } else {
          // Only open dialog if customer found, no toast needed
          setShowStripeInfo(true);
        }
      } catch (error: any) {
        console.error('Error checking Stripe status:', error);
        toast.error(error.message || 'Error checking Stripe status');
        // Clear stripeInfo in case of errors
        setStripeInfo(null);
      } finally {
        setIsLoadingStripe(false);
      }
    };

    // Get customer data only if a Stripe customer was found
    const getCustomerData = () => {
      if (stripeInfo?.found) {
        // Get next billing date - prefer upcoming invoice date if available
        let nextBillingDate = 'N/A';
        if (stripeInfo.upcomingInvoice?.date) {
          nextBillingDate = formatDate(stripeInfo.upcomingInvoice.date);
        } else if (stripeInfo.subscription?.currentPeriodEnd) {
          nextBillingDate = formatDate(stripeInfo.subscription.currentPeriodEnd);
        }
  
        return {
          name: stripeInfo.customer?.name || getSenderName(),
          email: stripeInfo.customer?.email || email.sender,
          subscription: stripeInfo.subscription?.plan?.name || 'No active plan',
          status: stripeInfo.hasActiveSubscription ? 'Active' : (stripeInfo.subscription?.status || 'Inactive'),
          since: stripeInfo.customer?.created ? formatDate(stripeInfo.customer.created) : 'Unknown',
          billingCycle: stripeInfo.subscription?.plan ? 
            `${stripeInfo.subscription.plan.intervalCount > 1 ? stripeInfo.subscription.plan.intervalCount : ''} ${stripeInfo.subscription.plan.interval}${stripeInfo.subscription.plan.intervalCount > 1 ? 's' : ''}` : 
            'N/A',
          nextBilling: nextBillingDate,
          amount: stripeInfo.subscription?.plan?.amount ? 
            formatCurrency(stripeInfo.subscription.plan.amount, stripeInfo.subscription.plan.currency) : 
            'N/A'
        };
      }

      // Return basic information when no Stripe customer is found
      return {
        name: getSenderName(),
        email: email.sender,
      };
    };

    const customerData = getCustomerData();

    // Helper function to get initials from a name
    const getInitials = (name: string): string => {
      if (!name) return '?';
      return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
    };

    // The dialog content
    const dialogContent = () => {
      if (!stripeInfo) {
        return (
          <div className="p-6 text-center">
            <Loader className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading customer information...</p>
          </div>
        );
      }

      if (!stripeInfo.found) {
        // Display appropriate error message
        return (
          <div className="p-6 text-center">
            <Ban className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">No Customer Information</h2>
            <p className="text-gray-500 mb-4">
              {stripeInfo.error || "No Stripe customer was found for this email address."}
            </p>
            {stripeInfo.error?.includes('Stripe API key') && (
              <div className="mt-2 text-sm">
                <p className="font-medium mb-1">Need to set up Stripe?</p>
                <Link 
                  href="/settings" 
                  className="text-blue-500 hover:text-blue-700 inline-flex items-center"
                >
                  <Settings className="h-4 w-4 mr-1" />
                  Go to Settings
                </Link>
              </div>
            )}
          </div>
        );
      }

      // Customer was found, display the information
      const customer = stripeInfo.customer;
      const subscription = stripeInfo.subscription;
      const hasActiveSubscription = !!stripeInfo.hasActiveSubscription;

      return (
        <div className="p-6">
          {/* Customer Information Section */}
          <div className="mb-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center">
                <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-lg mr-3">
                  {customer?.name ? getInitials(customer.name) : '?'}
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{customer?.name || 'Customer'}</h2>
                  <p className="text-gray-500">{customer?.email}</p>
                </div>
              </div>
              {hasActiveSubscription ? (
                <span className="inline-flex items-center bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Active
                </span>
              ) : (
                <span className="inline-flex items-center bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full">
                  <Clock className="w-3 h-3 mr-1" />
                  Inactive
                </span>
              )}
            </div>
            <div className="mt-2 text-sm text-gray-500">
              Customer since {formatDate(customer?.created || 0)}
            </div>
            {customer?.metadata?.company && (
              <div className="mt-2 text-sm">
                <span className="font-medium">Company:</span> {customer.metadata.company}
              </div>
            )}
          </div>

          {/* Subscription Details Section */}
          <div className="mb-6">
            <h3 className="text-md font-semibold uppercase text-gray-500 border-b pb-2 mb-3">
              SUBSCRIPTION DETAILS
            </h3>
            
            <div className="grid grid-cols-2 gap-y-3">
              <div className="text-sm font-medium">Plan</div>
              <div className="text-sm">{subscription?.plan?.name || 'No active plan'}</div>
              
              <div className="text-sm font-medium">Status</div>
              <div className="text-sm capitalize">{subscription?.status || 'Inactive'}</div>
              
              <div className="text-sm font-medium">Customer since</div>
              <div className="text-sm">{formatDate(customer?.created || 0)}</div>
              
              <div className="text-sm font-medium">Billing cycle</div>
              <div className="text-sm">
                {subscription?.plan?.interval 
                  ? `${subscription.plan.intervalCount} ${subscription.plan.interval}${subscription.plan.intervalCount > 1 ? 's' : ''}`
                  : 'N/A'}
              </div>
              
              <div className="text-sm font-medium">Payment method</div>
              <div className="text-sm">
                {getPaymentMethodDetails()}
              </div>
              
              <div className="text-sm font-medium">Amount</div>
              <div className="text-sm">
                {subscription?.plan?.amount 
                  ? formatCurrency(subscription.plan.amount, subscription.plan.currency)
                  : 'N/A'}
              </div>
            </div>
          </div>
          
          {/* Recent Payments Section */}
          {stripeInfo.recentInvoices && stripeInfo.recentInvoices.length > 0 && (
            <div>
              <h3 className="text-md font-semibold uppercase text-gray-500 border-b pb-2 mb-3">
                RECENT PAYMENTS
              </h3>
              
              <div className="space-y-2">
                {stripeInfo.recentInvoices.map(invoice => (
                  <div key={invoice.id} className="flex justify-between items-center py-1 border-b border-gray-100">
                    <div className="text-sm">{formatDate(invoice.date)}</div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${invoice.status === 'paid' ? 'text-green-600' : 'text-orange-500'}`}>
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 capitalize">
                        {invoice.status}
                      </span>
                      {invoice.pdfUrl && (
                        <a 
                          href={invoice.pdfUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-gray-500 hover:text-blue-600"
                        >
                          <FileText className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    };

    // Get payment method details if available
    const getPaymentMethodDetails = () => {
      const paymentMethod = stripeInfo?.subscription?.paymentMethod;
      if (!paymentMethod) return "Not available";
      
      if (paymentMethod.type === 'card') {
        return `${paymentMethod.card.brand.toUpperCase()} •••• ${paymentMethod.card.last4}`;
      }
      return paymentMethod.type;
    };

    return (
      <div className="h-full flex flex-col p-3 max-w-4xl mx-auto overflow-hidden">
        {/* Mobile Back Button - Only show on mobile */}
        <div className="md:hidden mb-3 sticky top-0 z-10 bg-white py-2 border-b">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleBackToList}
            className="rounded-full flex items-center text-gray-600 hover:text-gray-900 px-4 py-2 h-10"
          >
            <ChevronLeft className="h-5 w-5 mr-1" /> Back to emails
          </Button>
        </div>
        
        {/* Email Header - Keep compact */}
        <div className="flex-shrink-0 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-1">
            <Avatar className="h-8 w-8 border border-gray-200 shadow-sm">
              <AvatarFallback className="bg-blue-100 text-indigo-600">
                {email.sender.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-gray-800">
                  {getSenderName()}
                </span>
                <span className="text-sm text-gray-500">&lt;{email.sender}&gt;</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {formatEmailTime(email.receivedAt)}
                </span>
              </div>
              <div className="text-sm text-gray-500">to me</div>
            </div>
          </div>

          <h2 
            className="text-lg font-semibold text-gray-900 mb-1 cursor-help truncate" 
            title={email.subject} // Full subject shown on hover
          >
            {truncateText(email.subject, 80)}
          </h2>

          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all"
                  onClick={checkStripeStatus}
                >
                  <svg className={`h-4 w-4 mr-1 ${isLoadingStripe ? 'animate-spin' : ''}`} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M32 13.414v5.172L28.414 22H3.586L0 18.586v-5.172L3.586 10h24.828L32 13.414z"
                      fill="#6772e5"
                    />
                    <path d="M21.5 20.5h-11v-9h11v9zm-7-3h4v-3h-4v3z" fill="#6772e5" />
                  </svg>
                  {isLoadingStripe ? 'Loading...' : 'Customer Info'}
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl border-0 shadow-lg p-0 overflow-hidden">
                <DialogHeader className="bg-indigo-600 text-white p-6">
                  <DialogTitle className="text-xl font-medium">Customer Information</DialogTitle>
                </DialogHeader>
                <div className="p-6">
                  {dialogContent()}
                </div>
              </DialogContent>
            </Dialog>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all"
              onClick={() => refreshSingleEmail(email)}
              disabled={email.isRefreshing}
            >
              <RefreshCw 
                className={`h-4 w-4 mr-1 ${email.isRefreshing ? 'animate-spin text-indigo-600' : ''}`} 
              />
              {email.isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all"
              onClick={() => handleGenerateReply()}
            >
              <MessageSquare className="h-4 w-4 mr-1" />
              Reply
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all ml-auto"
            >
              <ThumbsDown className="h-4 w-4 mr-1" />
              Not Relevant
            </Button>
          </div>
        </div>

        {/* Email Content - Give maximum space but leave room for reply section */}
        <div className="flex-grow flex flex-col bg-white rounded-lg border border-gray-200 mt-2 hover:shadow-sm transition-shadow" style={{ minHeight: "200px", maxHeight: "calc(100vh - 400px)", overflow: "auto" }}>
          <EmailRenderNew 
            content={email.content} 
            showDebugInfo={false} 
            className="email-content flex-grow" 
            isLoading={email.isRefreshing} 
          />
        </div>

        {/* Questions Section - Only show if there are questions */}
        {email.questions && email.questions.length > 0 && (
          <div className="flex-shrink-0 mt-2">
            <h3 className="text-sm font-medium mb-1 flex items-center text-gray-800">
              <Lightbulb className="h-4 w-4 mr-1 text-amber-500" />
              Extracted Questions
            </h3>
            <div className="space-y-1">
              {email.questions.map((questionItem, index) => (
                <div key={index} className="bg-indigo-50 p-2 rounded text-sm text-indigo-800 shadow-sm">
                  {questionItem.question}
                  {email.matchedFAQ && index === 0 && (
                    <Badge className="ml-2 bg-indigo-100 text-indigo-700 hover:bg-indigo-100 rounded-full text-xs">
                      FAQ Match
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Reply Section - Minimize space used */}
        <div className="mt-2 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-medium text-gray-800">Quick Reply</h3>
            <Button
              size="sm"
              className="h-7 px-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow rounded-full transition-all"
              disabled={!quickReply.trim()}
            >
              <Send className="h-3 w-3 mr-1" />
              Send
            </Button>
          </div>
          <Textarea
            placeholder="Type a quick reply..."
            className="min-h-[60px] rounded-lg border-gray-200 resize-none focus:ring-indigo-600 focus:border-indigo-600"
            value={quickReply}
            onChange={(e) => setQuickReply(e.target.value)}
          />
        </div>

        {/* Suggested Reply Section - Only show if needed */}
        {(showReply || email.suggestedReply) && (
          <div className="mt-2 flex-shrink-0">
            <div className="flex justify-between items-center mb-1">
              <h3 className="text-sm font-medium flex items-center text-gray-800">
                <MessageSquare className="h-4 w-4 mr-1 text-green-600" />
                Suggested Reply
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingReply(!editingReply)}
                className="h-7 px-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-full"
              >
                <Edit className="h-4 w-4 mr-1" />
                {editingReply ? "Cancel" : "Edit"}
              </Button>
            </div>

            {editingReply ? (
              <div className="space-y-3">
                <Textarea
                  className="min-h-[200px] rounded-lg border-gray-200 resize-none focus:ring-indigo-600 focus:border-indigo-600"
                  defaultValue={
                    email.suggestedReply ||
                    `Dear ${email.sender
                      .split("@")[0]
                      .split(".")
                      .map((name: string) => name.charAt(0).toUpperCase() + name.slice(1))
                      .join(" ")},

Thank you for reaching out to our support team.

${email.matchedFAQ && email.questions && email.questions.length > 0 && email.questions[0]?.question ? 
  faqLibrary.find((faq) => faq.question.toLowerCase().includes(email.questions?.[0]?.question?.toLowerCase?.()?.split(" ")?.pop?.() || ''))?.answer || 
  "I'll look into this issue for you right away." : 
  "I'll look into this issue for you right away."}

If you have any further questions, please don't hesitate to contact us.

Best regards,
Support Team`
                  }
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" className="rounded-full">
                    Cancel
                  </Button>
                  <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow rounded-full transition-all">
                    <Send className="h-4 w-4 mr-2" />
                    Send Reply
                  </Button>
                </div>
              </div>
            ) : (
              <Card className="p-4 rounded-lg border-0 shadow-sm overflow-hidden">
                <div className="font-mono text-sm whitespace-pre-wrap">
                  {email.suggestedReply || `Dear ${getSenderName()},

Thank you for reaching out to our support team.

${email.matchedFAQ && email.questions && email.questions.length > 0 && email.questions[0]?.question ? 
  faqLibrary.find((faq) => faq.question.toLowerCase().includes(email.questions?.[0]?.question?.toLowerCase?.()?.split(" ")?.pop?.() || ''))?.answer || 
  "I'll look into this issue for you right away." : 
  "I'll look into this issue for you right away."}

If you have any further questions, please don't hesitate to contact us.

Best regards,
Support Team`}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    )
  }

  // FAQ Library content
  const FAQLibraryContent = () => {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">FAQ Library</h2>
          <Button 
            variant="outline"
            className="rounded-full border-gray-200 shadow-sm hover:shadow hover:border-gray-300 transition-all text-xs md:text-sm py-1 px-3 md:py-2 md:px-4"
            onClick={() => {
              setNewFAQ({ question: '', answer: '' });
              setEditingFaqId(null);
              setShowAddFAQModal(true);
            }}
          >
            <PlusCircle className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
            Add New FAQ
          </Button>
        </div>
        
        {Array.isArray(faqLibrary) && faqLibrary.length > 0 ? (
          <div className="space-y-6">
            {faqLibrary.map((faq) => (
              <Card key={faq.id} className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-all">
                <CardHeader className="bg-gray-50 py-2 px-4">
                  <CardTitle className="text-base md:text-lg font-medium flex items-center justify-between">
                    <span className="flex-1">{faq.question}</span>
                    <div className="flex space-x-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 w-8 p-0 rounded-full text-gray-500 hover:text-blue-600 hover:bg-blue-50"
                        onClick={() => handleEditFAQ(faq)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 w-8 p-0 rounded-full text-gray-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDeleteFAQ(faq.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-3 px-4 pb-4 text-sm md:text-base">
                  <p className="whitespace-pre-line">{faq.answer}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 px-4">
            <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <div className="text-gray-400">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.09 9C9.3251 8.33167 9.78915 7.76811 10.4 7.40913C11.0108 7.05016 11.7289 6.91894 12.4272 7.03871C13.1255 7.15849 13.7588 7.52152 14.2151 8.06353C14.6713 8.60553 14.9211 9.29152 14.92 10C14.92 12 11.92 13 11.92 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="17" r="1" fill="currentColor"/>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                </svg>
              </div>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No FAQs available</h3>
            <p className="text-gray-500 mb-6">Add your first FAQ to start building your library</p>
            <Button 
              variant="outline"
              className="rounded-full border-gray-200 shadow-sm hover:shadow hover:border-gray-300 transition-all"
              onClick={() => {
                setNewFAQ({ question: '', answer: '' });
                setEditingFaqId(null);
                setShowAddFAQModal(true);
              }}
            >
              <PlusCircle className="h-4 w-4 mr-2" />
              Add Your First FAQ
            </Button>
          </div>
        )}
      </div>
    );
  };

  // Set up the periodic check for new emails
  useEffect(() => {
    // Check for new emails periodically if we have emails loaded
    if (user && emails.length > 0) {
      // Initial check after 10 seconds
      const initialTimer = setTimeout(() => {
        autoCheckNewEmails();
      }, 10000);
      
      // Then check every 60 seconds
      const intervalTimer = setInterval(() => {
        autoCheckNewEmails();
      }, 60000);
      
      return () => {
        clearTimeout(initialTimer);
        clearInterval(intervalTimer);
      };
    }
  }, [user, emails.length]);

  // Add a useEffect to track window resize for mobile/desktop layouts
  useEffect(() => {
    // Function to handle resize events
    const handleResize = () => {
      // If we're on desktop (wider than 768px), no need to manage mobile view
      // as both panels will show on desktop
      if (window.innerWidth >= 768) {
        // On desktop we'll show both panels (handled by CSS)
      } else {
        // On mobile, if an email is selected, show the detail view
        // otherwise show the list view
        if (selectedEmail) {
          setMobileView('detail');
        } else {
          setMobileView('list');
        }
      }
    };

    // Run once on mount
    handleResize();

    // Add event listener
    window.addEventListener('resize', handleResize);

    // Clean up
    return () => window.removeEventListener('resize', handleResize);
  }, [selectedEmail]);

  // FAQ management functions
  const handleAddFAQ = () => {
    if (!newFAQ.question.trim() || !newFAQ.answer.trim()) {
      toast.error('Please provide both a question and an answer');
      return;
    }

    if (editingFaqId) {
      // Update existing FAQ
      setFaqLibrary(prev => prev.map(faq =>
        faq.id === editingFaqId
          ? {
            ...faq,
            question: newFAQ.question.trim(),
            answer: newFAQ.answer.trim(),
          }
          : faq
      ));
      toast.success('FAQ updated successfully!');
    } else {
      // Add new FAQ
      const newFaqEntry = {
        id: Date.now().toString(),
        question: newFAQ.question.trim(),
        answer: newFAQ.answer.trim(),
      };

      setFaqLibrary(prev => [...prev, newFaqEntry]);
      toast.success('New FAQ added successfully!');
    }

    setNewFAQ({ question: '', answer: '' });
    setEditingFaqId(null);
    setShowAddFAQModal(false);
  };

  const handleEditFAQ = (faq: typeof faqLibrary[0]) => {
    setNewFAQ({
      question: faq.question,
      answer: faq.answer,
    });
    setEditingFaqId(faq.id);
    setShowAddFAQModal(true);
  };

  const handleDeleteFAQ = (id: string) => {
    if (confirm('Are you sure you want to delete this FAQ?')) {
      setFaqLibrary(prev => prev.filter(faq => faq.id !== id));
      toast.success('FAQ deleted successfully!');
    }
  };

  // Add a useEffect to ensure the FAQ tab renders properly
  useEffect(() => {
    // When the activeTab is set to "faq", force a re-render after a small delay
    if (activeTab === "faq") {
      console.log("FAQ tab selected, forcing refresh");
      // This delay helps ensure the tab has time to become visible before we force a refresh
      const timer = setTimeout(() => {
        // Force a re-render by making a small state update
        setFaqLibrary(prev => [...prev]);
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  // Add useEffect to force re-render of the entire tabs container based on active tab
  useEffect(() => {
    // Set a flag in the DOM to make CSS selectors easier
    document.documentElement.setAttribute('data-active-tab', activeTab);
    
    // Special handling for FAQ tab
    if (activeTab === 'faq') {
      // Force a re-render with a small state update
      setFaqLibrary(prev => [...prev]);
    }
  }, [activeTab]);

  // Implement a custom tab selector component that is more reliable but matches original UI
  const CustomTabSelector = () => {
    return (
      <div className="px-2 md:px-8 pb-0">
        <div className="bg-transparent border-b border-gray-200 w-full max-w-full p-0 h-auto overflow-x-auto flex">
          {[
            { id: "unanswered", label: "Unanswered" },
            { id: "ready", label: "Ready to Reply" },
            { id: "faq", label: "FAQ Library" },
            { id: "not-relevant", label: "Not Relevant" },
            { id: "answered", label: "Answered" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                console.log(`Custom tab clicked: ${tab.id}`);
                // Clear selected email when changing tabs to prevent showing email details from a different tab
                setSelectedEmail(null);
                // Then change the tab
                setActiveTab(tab.id);
              }}
              className={`
                px-3 md:px-6 py-2 rounded-t-2xl transition-all border-b-2 whitespace-nowrap
                ${activeTab === tab.id 
                  ? "bg-indigo-600 text-white shadow-lg border-indigo-600" 
                  : "border-transparent text-gray-600 hover:text-gray-900"}
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Custom tab content renderer that handles each tab type appropriately
  const CustomTabContent = () => {
    // Return different content based on active tab
    switch (activeTab) {
      case "faq":
        return (
          <div className="h-full overflow-auto">
            <div className="p-4 md:p-8 h-full">
              <div className="max-w-4xl mx-auto">
                <FAQLibraryContent />
              </div>
            </div>
            
            {/* Add/Edit FAQ Modal */}
            <Dialog open={showAddFAQModal} onOpenChange={setShowAddFAQModal}>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>{editingFaqId ? 'Edit FAQ' : 'Add New FAQ'}</DialogTitle>
                  <DialogDescription>
                    {editingFaqId 
                      ? 'Update this FAQ question and answer template.' 
                      : 'Create a new FAQ to add to your library.'}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="question">Question</Label>
                    <Textarea
                      id="question"
                      placeholder="Enter the frequently asked question"
                      value={newFAQ.question}
                      onChange={(e) => setNewFAQ(prev => ({ ...prev, question: e.target.value }))}
                      className="min-h-[80px]"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="answer">Answer Template</Label>
                    <Textarea
                      id="answer"
                      placeholder="Enter the answer template"
                      value={newFAQ.answer}
                      onChange={(e) => setNewFAQ(prev => ({ ...prev, answer: e.target.value }))}
                      className="min-h-[160px]"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddFAQModal(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddFAQ} disabled={!newFAQ.question.trim() || !newFAQ.answer.trim()}>
                    {editingFaqId ? 'Update FAQ' : 'Add FAQ'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        );
      case "unanswered":
        return (
          <div className="h-full flex flex-col md:flex-row">
            <div className={`${mobileView === 'detail' ? 'hidden md:block' : 'block'} w-full md:w-1/3 border-r border-gray-100 overflow-y-auto p-2 h-full`}>
              <div className="mb-2 flex justify-between items-center">
                <h3 className="font-medium text-gray-700">Unanswered Emails ({unansweredEmails.length})</h3>
                {dataRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />}
              </div>
              <div className="h-[calc(100vh-220px)] overflow-y-auto">
                <EmailList emails={unansweredEmails} />
              </div>
            </div>
            <div className={`${mobileView === 'list' ? 'hidden md:block' : 'block'} w-full md:w-2/3 overflow-y-auto h-full`}>
              {selectedEmail ? (
                <div className="p-4 h-full overflow-y-auto">
                  <EmailDetail email={selectedEmail} showReply={true} />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                    <p>Select an email to view details</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case "ready":
        return (
          <div className="h-full flex flex-col md:flex-row">
            <div className={`${mobileView === 'detail' ? 'hidden md:block' : 'block'} w-full md:w-1/3 border-r border-gray-100 overflow-y-auto p-2 h-full`}>
              <div className="mb-2 flex justify-between items-center">
                <h3 className="font-medium text-gray-700">Ready to Reply ({readyEmails.length})</h3>
                {dataRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />}
              </div>
              <div className="h-[calc(100vh-220px)] overflow-y-auto">
                <EmailList emails={readyEmails} />
              </div>
            </div>
            <div className={`${mobileView === 'list' ? 'hidden md:block' : 'block'} w-full md:w-2/3 overflow-y-auto h-full`}>
              {selectedEmail ? (
                <div className="p-4 h-full overflow-y-auto">
                  <EmailDetail email={selectedEmail} showReply={true} />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                    <p>Select an email to view details</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case "not-relevant":
        return (
          <div className="h-full flex flex-col md:flex-row">
            <div className={`${mobileView === 'detail' ? 'hidden md:block' : 'block'} w-full md:w-1/3 border-r border-gray-100 overflow-y-auto p-2 h-full`}>
              <div className="mb-2 flex justify-between items-center">
                <h3 className="font-medium text-gray-700">Not Relevant ({notRelevantEmails.length})</h3>
                {dataRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />}
              </div>
              <div className="h-[calc(100vh-220px)] overflow-y-auto">
                <EmailList emails={notRelevantEmails} />
              </div>
            </div>
            <div className={`${mobileView === 'list' ? 'hidden md:block' : 'block'} w-full md:w-2/3 overflow-y-auto h-full`}>
              {selectedEmail ? (
                <div className="p-4 h-full overflow-y-auto">
                  <EmailDetail email={selectedEmail} showReply={true} />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                    <p>Select an email to view details</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case "answered":
        return (
          <div className="h-full flex flex-col md:flex-row">
            <div className={`${mobileView === 'detail' ? 'hidden md:block' : 'block'} w-full md:w-1/3 border-r border-gray-100 overflow-y-auto p-2 h-full`}>
              <div className="mb-2 flex justify-between items-center">
                <h3 className="font-medium text-gray-700">Answered ({answeredEmails.length})</h3>
                {dataRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />}
              </div>
              <div className="h-[calc(100vh-220px)] overflow-y-auto">
                <EmailList emails={answeredEmails} />
              </div>
            </div>
            <div className={`${mobileView === 'list' ? 'hidden md:block' : 'block'} w-full md:w-2/3 overflow-y-auto h-full`}>
              {selectedEmail ? (
                <div className="p-4 h-full overflow-y-auto">
                  <EmailDetail email={selectedEmail} showReply={true} />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                    <p>Select an email to view details</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  // Replace the renderTabContent function
  const renderTabContent = () => {
    return (
      <div className="flex-1 overflow-hidden flex flex-col">
        <CustomTabSelector />
        <div className="flex-1 overflow-hidden">
          <CustomTabContent />
        </div>
      </div>
    );
  };

  // Add effect to handle tab changes and ensure content refreshes properly
  useEffect(() => {
    // Log active tab for debugging
    console.log("Active tab changed to:", activeTab);
    
    // Special handling for FAQ tab
    if (activeTab === 'faq') {
      // Force a refresh of the faqLibrary state to ensure rendering
      const timer = setTimeout(() => {
        console.log("Refreshing FAQ library state");
        setFaqLibrary(prev => [...prev]);
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  // In the return section, use the renderTabContent function
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden md:pl-64">
        <header className="border-b border-gray-100 shadow-sm p-2 md:p-4 flex items-center justify-between bg-white">
          <div className="flex items-center">
            <h1 className="text-xl md:text-2xl font-semibold text-gray-900">FAQ Auto Reply</h1>
            <Button
              variant="outline"
              className="ml-4 text-xs"
              onClick={() => {
                console.log("Direct to FAQ tab button clicked");
                setActiveTab("faq");
              }}
            >
              Debug: Go to FAQ Tab
            </Button>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 rounded-full p-0"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              className="rounded-full gap-1 md:gap-2 shadow-md bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-600"
              onClick={handleRefreshEmails}
            >
              {dataRefreshing ? (
                <Loader className="animate-spin h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Refresh Emails</span>
            </Button>
          </div>
        </header>

        {/* Use the renderTabContent function */}
        {renderTabContent()}
      </div>
    </div>
  )
} 