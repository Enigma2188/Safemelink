export type PreferredSosChannel = 'sms' | 'whatsapp';

export type SafeMeLinkContact = {
  id: string;
  remoteId?: string;
  name: string;
  phone: string;
  hasApp: boolean;
  userId?: string;
  preferredChannel: PreferredSosChannel;
};
