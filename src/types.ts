export type Platform = 'whatsapp' | 'telegram';

export interface StoredMessage {
  id?: number;
  platform: Platform;
  groupId: string;
  groupName?: string | null;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
}

export interface SummaryResult {
  text: string;
  messageCount: number;
  windowStart: number;
  windowEnd: number;
}
