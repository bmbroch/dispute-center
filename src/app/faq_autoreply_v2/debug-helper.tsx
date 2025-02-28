import { ExtendedEmail } from "@/types/email";
import { toast } from "react-hot-toast";

// Safe date string conversion utility
const safeISOString = (date: any): string => {
  try {
    if (!date) return 'N/A';
    if (typeof date === 'number') {
      // Check if timestamp is valid
      if (isNaN(date) || date <= 0 || !isFinite(date)) return 'Invalid Timestamp';
      return new Date(date).toISOString();
    }
    if (date instanceof Date) {
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toISOString();
    }
    if (typeof date === 'string') {
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) return 'Invalid Date String';
      return parsed.toISOString();
    }
    return 'Unknown Format';
  } catch (err) {
    console.error('Date conversion error:', err);
    return 'Date Error';
  }
};

/**
 * Debug function to help troubleshoot timestamp issues
 */
export const debugCheckTimestamp = (emails: ExtendedEmail[], user: any) => {
  if (!user) {
    console.log('DEBUG: No user logged in, aborting timestamp check');
    return;
  }

  console.log('DEBUG: Running timestamp check for user:', user.email);

  try {
    // 1. Find all Feb 28 emails if any
    const feb28 = new Date('2025-02-28').getTime();
    console.log(`DEBUG: Looking for Feb 28 emails (${safeISOString(feb28)})`);

    const feb28Emails = emails.filter(e => {
      // Check receivedAt
      let receivedTime = 0;
      if (typeof e.receivedAt === 'number') receivedTime = e.receivedAt;
      else if (typeof e.receivedAt === 'string') receivedTime = new Date(e.receivedAt).getTime();

      // Check sortTimestamp
      const sortTime = typeof e.sortTimestamp === 'number' ? e.sortTimestamp : 0;

      // Check if either timestamp is Feb 28 (within the day)
      const isReceivedFeb28 = receivedTime > 0 &&
        new Date(receivedTime).toDateString() === new Date(feb28).toDateString();
      const isSortFeb28 = sortTime > 0 &&
        new Date(sortTime).toDateString() === new Date(feb28).toDateString();

      return isReceivedFeb28 || isSortFeb28;
    });

    console.log(`DEBUG: Found ${feb28Emails.length} emails from Feb 28:`);
    feb28Emails.forEach((e, i) => {
      console.log(`DEBUG: Feb 28 Email #${i + 1}:`);
      console.log(`  - ID: ${e.id}`);
      console.log(`  - ThreadID: ${e.threadId}`);
      console.log(`  - Subject: ${e.subject || 'Unknown'}`);
      console.log(`  - receivedAt: ${e.receivedAt} (${typeof e.receivedAt === 'number' || !e.receivedAt ? '' : safeISOString(e.receivedAt)})`);
      console.log(`  - sortTimestamp: ${e.sortTimestamp} (${e.sortTimestamp ? safeISOString(e.sortTimestamp) : 'N/A'})`);
      console.log(`  - In emails array: ${emails.some(email => email.id === e.id)}`);
      console.log(`  - Thread ID in emails: ${emails.filter(email => email.threadId).map(email => email.threadId).includes(e.threadId)}`);
    });

    // 2. Find the latest email timestamp
    let latestTimestamp = 0;
    let latestEmail: ExtendedEmail | null = null;

    for (const email of emails) {
      // Get timestamp from receivedAt (preferred) or sortTimestamp
      let timestamp = 0;
      if (typeof email.receivedAt === 'number') {
        timestamp = email.receivedAt;
      } else if (typeof email.receivedAt === 'string') {
        timestamp = new Date(email.receivedAt).getTime();
      } else if (typeof email.sortTimestamp === 'number') {
        timestamp = email.sortTimestamp;
      }

      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latestEmail = email;
      }
    }

    if (latestEmail) {
      console.log('DEBUG: Latest email found:');
      console.log(`  - ID: ${latestEmail.id}`);
      console.log(`  - ThreadID: ${latestEmail.threadId}`);
      console.log(`  - Subject: ${latestEmail.subject || 'Unknown'}`);
      console.log(`  - receivedAt: ${latestEmail.receivedAt} (${typeof latestEmail.receivedAt === 'number' || !latestEmail.receivedAt ? '' : safeISOString(latestEmail.receivedAt)})`);
      console.log(`  - sortTimestamp: ${latestEmail.sortTimestamp} (${latestEmail.sortTimestamp ? safeISOString(latestEmail.sortTimestamp) : 'N/A'})`);
      console.log(`  - Latest timestamp used: ${latestTimestamp} (${safeISOString(latestTimestamp)})`);

      console.log(`DEBUG: Timestamp that would be sent to check-new API: ${latestTimestamp} (${safeISOString(latestTimestamp)})`);
    } else {
      console.log('DEBUG: No emails found to check timestamp');
    }

    toast.success('Timestamp check complete - see console for details');
  } catch (err) {
    console.error('Error in debugCheckTimestamp:', err);
    toast.error('Error checking timestamps, see console');
  }
};

