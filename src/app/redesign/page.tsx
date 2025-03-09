"use client";

import { useState, useEffect, useCallback, Fragment } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {
  Settings,
  MessageSquareText,
  Home,
  BookOpen,
  Shield,
  Send,
  ThumbsDown,
  Edit,
  CheckCircle,
  Circle,
  RefreshCw,
  MessageSquare,
  Lightbulb,
  ChevronDown,
  DownloadCloud,
  ChevronLeft,
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
    setActiveTab(tab);
    
    // On mobile, when changing tabs, show the list view first
    setMobileView('list');
    
    // Restore the previously selected email for this tab if available
    const previousSelection = tabSelections[tab];
    
    // If we have a previous selection for this tab and it still exists in the current email list
    if (previousSelection) {
      // Find the email in the current list (it might have been updated)
      let emailList: ExtendedEmail[] = [];
      switch (tab) {
        case "unanswered":
          emailList = unansweredEmails;
          break;
        case "ready":
          emailList = readyEmails;
          break;
        case "not-relevant":
          emailList = notRelevantEmails;
          break;
        case "answered":
          emailList = answeredEmails;
          break;
      }
      
      // Find the email in the current list by ID
      const currentEmail = emailList.find(e => e.id === previousSelection.id);
      
      // If found, select it, otherwise clear the selection
      if (currentEmail) {
        setSelectedEmail(currentEmail);
      } else {
        setSelectedEmail(null);
      }
    } else {
      // No previous selection, clear the selection
      setSelectedEmail(null);
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

  // FAQ data
  const faqLibrary = [
    {
      id: 1,
      question: "How do I cancel my subscription?",
      answer:
        "You can cancel your subscription at any time from your account settings. Once canceled, you will still have access to the service until the end of your billing period.",
    },
    {
      id: 2,
      question: "How to reset your password",
      answer:
        "To reset your password, please click on the 'Forgot Password' link on the login page. You will receive an email with instructions to create a new password.",
    },
  ]

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

  // Email detail component with back button for mobile
  const EmailDetail = ({ email, showReply = false }: { email: ExtendedEmail; showReply?: boolean }) => {
    const [quickReply, setQuickReply] = useState("")

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

    // Customer data that would come from Stripe - this is just mock data
    const customerData = {
      name: getSenderName(),
      email: email.sender,
      subscription: "Premium Plan",
      status: "Active",
      since: "Jan 2023",
      billingCycle: "Monthly",
      nextBilling: "Aug 15, 2023",
    }

    return (
      <div className="h-full flex flex-col p-3 max-w-4xl mx-auto">
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

          <h2 className="text-lg font-semibold text-gray-900 mb-1">{email.subject}</h2>

          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all"
                >
                  <svg className="h-4 w-4 mr-1" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M32 13.414v5.172L28.414 22H3.586L0 18.586v-5.172L3.586 10h24.828L32 13.414z"
                      fill="#6772e5"
                    />
                    <path d="M21.5 20.5h-11v-9h11v9zm-7-3h4v-3h-4v3z" fill="#6772e5" />
                  </svg>
                  Customer Info
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl border-0 shadow-lg p-0 overflow-hidden">
                <DialogHeader className="bg-indigo-600 text-white p-6">
                  <DialogTitle className="text-xl font-medium">Customer Information</DialogTitle>
                </DialogHeader>
                <div className="p-6">
                  <div className="flex items-center gap-4 mb-8">
                    <Avatar className="h-16 w-16 border-4 border-white shadow-md -mt-12">
                      <AvatarFallback className="bg-blue-100 text-indigo-600 text-lg">
                        {customerData.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-lg">{customerData.name}</div>
                      <div className="text-sm text-gray-500">{customerData.email}</div>
                    </div>
                  </div>
                  <div className="space-y-5">
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Plan</span>
                      <span className="text-gray-900">{customerData.subscription}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Status</span>
                      <Badge className="bg-green-50 text-green-700 rounded-full px-3 py-0.5">
                        {customerData.status}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Customer since</span>
                      <span className="text-gray-900">{customerData.since}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Billing cycle</span>
                      <span className="text-gray-900">{customerData.billingCycle}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Next billing</span>
                      <span className="text-gray-900">{customerData.nextBilling}</span>
                    </div>
                  </div>
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

        {/* Email Content - Give maximum space */}
        <div className="flex-grow overflow-auto flex flex-col bg-white rounded-lg border border-gray-200 mt-2 hover:shadow-sm transition-shadow">
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
  const FAQLibraryContent = () => (
    <div className="p-4 md:p-8 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900">FAQ Library</h2>
          <Button 
            variant="outline"
            className="rounded-full border-gray-200 shadow-sm hover:shadow hover:border-gray-300 transition-all text-xs md:text-sm py-1 px-3 md:py-2 md:px-4"
          >
            <Edit className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
            Add New FAQ
          </Button>
        </div>
        
        <div className="space-y-6">
          {faqLibrary.map((faq, index) => (
            <Card key={index} className="overflow-hidden border-0 shadow-sm">
              <CardHeader className="bg-gray-50 py-2 px-4">
                <CardTitle className="text-base md:text-lg font-medium flex items-center justify-between">
                  <span className="flex-1">{faq.question}</span>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full">
                    <Edit className="h-4 w-4 text-gray-500" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 px-4 pb-4 text-sm md:text-base">
                <p>{faq.answer}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )

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

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden md:pl-64">
        <header className="bg-white shadow-sm px-4 md:px-8 py-4 md:py-5 flex justify-between items-center">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-gray-900">FAQ Auto Reply</h1>
            <p className="text-xs md:text-sm text-gray-500 mt-1">Automatically match and reply to customer support emails</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-gray-200 shadow-sm hover:shadow hover:border-gray-300 transition-all"
            >
              <Settings className="h-4 w-4 md:mr-2" />
              <span className="hidden md:inline">Settings</span>
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow rounded-full transition-all"
              onClick={handleRefreshEmails}
            >
              <RefreshCw className="h-4 w-4 md:mr-2" />
              <span className="hidden md:inline">Refresh Emails</span>
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="unanswered" value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
            <div className="px-2 md:px-8 pb-0">
              <TabsList className="bg-transparent border-b border-gray-200 w-full max-w-full p-0 h-auto overflow-x-auto">
                <TabsTrigger
                  value="unanswered"
                  className="px-3 md:px-6 py-2 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  Unanswered
                </TabsTrigger>
                <TabsTrigger
                  value="ready"
                  className="px-3 md:px-6 py-2 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  Ready to Reply
                </TabsTrigger>
                <TabsTrigger
                  value="faq"
                  className="px-3 md:px-6 py-2 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  FAQ Library
                </TabsTrigger>
                <TabsTrigger
                  value="not-relevant"
                  className="px-3 md:px-6 py-2 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  Not Relevant
                </TabsTrigger>
                <TabsTrigger
                  value="answered"
                  className="px-3 md:px-6 py-2 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  Answered
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden mt-0">
              <TabsContent value="unanswered" className="h-full flex flex-col md:flex-row">
                {/* Email List - Show on desktop and on mobile in list view */}
                <div className={`${mobileView === 'detail' ? 'hidden md:block' : 'block'} w-full md:w-1/3 border-r border-gray-100 overflow-y-auto p-2`}>
                  <div className="mb-2 flex justify-between items-center">
                    <h3 className="font-medium text-gray-700">Unanswered Emails ({unansweredEmails.length})</h3>
                    {dataRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />}
                  </div>
                  <EmailList emails={unansweredEmails} />
                </div>
                
                {/* Email Detail - Show on desktop and on mobile in detail view */}
                <div className={`${mobileView === 'list' ? 'hidden md:block' : 'block'} w-full md:w-2/3 overflow-y-auto`}>
                  {selectedEmail ? (
                    <EmailDetail email={selectedEmail} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                        <p className="text-lg">Select an email to view details</p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ready" className="h-full flex flex-col md:flex-row">
                <div className={`${mobileView === 'detail' ? 'hidden md:block' : 'block'} w-full md:w-1/3 border-r border-gray-100 overflow-y-auto p-2`}>
                  <div className="mb-2 flex justify-between items-center">
                    <h3 className="font-medium text-gray-700">Ready to Reply ({readyEmails.length})</h3>
                    {dataRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />}
                  </div>
                  <EmailList emails={readyEmails} />
                </div>
                <div className={`${mobileView === 'list' ? 'hidden md:block' : 'block'} w-full md:w-2/3 overflow-y-auto`}>
                  {selectedEmail ? (
                    <EmailDetail email={selectedEmail} showReply={true} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                        <p className="text-lg">Select an email to view details</p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="faq" className="h-full overflow-auto">
                <FAQLibraryContent />
              </TabsContent>

              <TabsContent value="not-relevant" className="h-full flex flex-col md:flex-row">
                <div className={`${mobileView === 'detail' ? 'hidden md:block' : 'block'} w-full md:w-1/3 border-r border-gray-100 overflow-y-auto p-2`}>
                  <div className="mb-2 flex justify-between items-center">
                    <h3 className="font-medium text-gray-700">Not Relevant ({notRelevantEmails.length})</h3>
                    {dataRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />}
                  </div>
                  <EmailList emails={notRelevantEmails} />
                </div>
                <div className={`${mobileView === 'list' ? 'hidden md:block' : 'block'} w-full md:w-2/3 overflow-y-auto`}>
                  {selectedEmail ? (
                    <EmailDetail email={selectedEmail} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                        <p className="text-lg">Select an email to view details</p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="answered" className="h-full flex flex-col md:flex-row">
                <div className={`${mobileView === 'detail' ? 'hidden md:block' : 'block'} w-full md:w-1/3 border-r border-gray-100 overflow-y-auto p-2`}>
                  <div className="mb-2 flex justify-between items-center">
                    <h3 className="font-medium text-gray-700">Answered Emails ({answeredEmails.length})</h3>
                    {dataRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />}
                  </div>
                  <EmailList emails={answeredEmails} />
                </div>
                <div className={`${mobileView === 'list' ? 'hidden md:block' : 'block'} w-full md:w-2/3 overflow-y-auto`}>
                  {selectedEmail ? (
                    <EmailDetail email={selectedEmail} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                        <p className="text-lg">Select an email to view details</p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
} 