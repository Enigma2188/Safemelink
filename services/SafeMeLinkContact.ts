export type PreferredSosChannel = 'sms' | 'whatsapp';

export type SafeMeLinkContact = {
  id: string;
  remoteId?: string;
  name: string;
  phone: string;
  phoneE164: string | null;
  priority: number;
  hasApp: boolean;
  userId?: string;
  preferredChannel: PreferredSosChannel;
  isLegacyLocal?: boolean;
};
