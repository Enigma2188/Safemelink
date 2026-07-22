export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SosStatus = 'open' | 'accepted' | 'closed' | 'cancelled';
export type GuardianStatus = 'pending' | 'accepted' | 'rejected' | 'revoked';
export type NearbyAlertStatus = 'detected' | 'acknowledged' | 'expired';

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          nickname: string | null;
          phone: string | null;
          avatar: string | null;
          available: boolean;
          last_position: unknown | null;
          last_online: string | null;
          created_at: string;
          public_code: string;
        };
        Insert: {
          id: string;
          nickname?: string | null;
          phone?: string | null;
          avatar?: string | null;
          available?: boolean;
          last_position?: unknown | null;
          last_online?: string | null;
          created_at?: string;
          public_code?: string;
        };
        Update: {
          nickname?: string | null;
          phone?: string | null;
          avatar?: string | null;
          available?: boolean;
          last_position?: unknown | null;
          last_online?: string | null;
          public_code?: string;
        };
        Relationships: [];
      };
      sos: {
        Row: {
          id: string;
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy: number | null;
          device_time: string | null;
          created_at: string;
          updated_at: string;
          status: SosStatus;
          accepted_by: string | null;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy?: number | null;
          device_time?: string | null;
          created_at?: string;
          updated_at?: string;
          status?: SosStatus;
          accepted_by?: string | null;
          closed_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['sos']['Insert']>;
        Relationships: [];
      };
      trusted_contacts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          phone: string | null;
          priority: number;
          linked_profile_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          phone?: string | null;
          priority: number;
          linked_profile_id?: string | null;
        };
        Update: {
          name?: string;
          phone?: string | null;
          priority?: number;
          linked_profile_id?: string | null;
        };
        Relationships: [];
      };
      trusted_contact_requests: {
        Row: {
          id: string;
          requester_user_id: string;
          recipient_user_id: string;
          status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          requester_user_id: string;
          recipient_user_id: string;
          status?: 'pending' | 'accepted' | 'rejected' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: 'pending' | 'accepted' | 'rejected' | 'cancelled';
          updated_at?: string;
        };
        Relationships: [];
      };
      device_push_tokens: {
        Row: {
          id: string;
          user_id: string;
          expo_push_token: string;
          platform: 'android' | 'ios';
          device_name: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          expo_push_token: string;
          platform: 'android' | 'ios';
          device_name?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          expo_push_token?: string;
          platform?: 'android' | 'ios';
          device_name?: string | null;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      guardian: {
        Row: { id: string; user_id: string; guardian_id: string; status: GuardianStatus };
        Insert: { id?: string; user_id: string; guardian_id: string; status?: GuardianStatus };
        Update: { status?: GuardianStatus };
        Relationships: [];
      };
      nearby_alerts: {
        Row: {
          id: string;
          sos_id: string;
          source_user_id: string;
          nearby_user_id: string;
          distance_meters: number;
          status: NearbyAlertStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          sos_id: string;
          source_user_id: string;
          nearby_user_id: string;
          distance_meters: number;
          status?: NearbyAlertStatus;
          created_at?: string;
        };
        Update: { status?: NearbyAlertStatus };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_my_public_code: {
        Args: Record<string, never>;
        Returns: string;
      };
      create_trusted_contact_request: {
        Args: { target_public_code: string };
        Returns: string;
      };
      list_my_trusted_contact_requests: {
        Args: Record<string, never>;
        Returns: {
          request_id: string;
          direction: 'sent' | 'received';
          request_status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
          display_name: string;
          counterpart_code: string;
          request_created_at: string;
          request_updated_at: string;
        }[];
      };
      respond_to_trusted_contact_request: {
        Args: { target_request_id: string; accept_request: boolean };
        Returns: undefined;
      };
      cancel_trusted_contact_request: {
        Args: { target_request_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      sos_status: SosStatus;
      guardian_status: GuardianStatus;
      nearby_alert_status: NearbyAlertStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
