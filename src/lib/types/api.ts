import { Email } from '@/types/email';

export interface ResponseData {
  emails: Email[];
  hasMore: boolean;
  nextPage: number | null;
  nextPageToken: string | null;
  total: number;
  currentPage: number;
  pageSize: number;
}

// ... rest of the file ...
