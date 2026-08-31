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
          push_dispatched_at: string | null;
          push_dispatch_claim_id: string | null;
          push_dispatch_claimed_at: string | null;
          push_dispatch_attempted_at: string | null;
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
          push_dispatched_at?: string | null;
          push_dispatch_claim_id?: string | null;
          push_dispatch_claimed_at?: string | null;
          push_dispatch_attempted_at?: string | null;
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
          phone_e164: string | null;
          preferred_channel: 'sms' | 'whatsapp';
          priority: number;
          linked_profile_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          phone?: string | null;
          phone_e164?: string | null;
          preferred_channel?: 'sms' | 'whatsapp';
          priority: number;
          linked_profile_id?: string | null;
        };
        Update: {
          name?: string;
          phone?: string | null;
          phone_e164?: string | null;
          preferred_channel?: 'sms' | 'whatsapp';
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
      radar_presence: {
        Row: {
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy: number | null;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy?: number | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          latitude?: number;
          longitude?: number;
          accuracy?: number | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      sos_network_presence: {
        Row: {
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy: number;
          source: 'foreground' | 'background';
          observed_at: string;
          updated_at: string;
          is_active: boolean;
        };
        Insert: {
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy: number;
          source: 'foreground' | 'background';
          observed_at: string;
          updated_at?: string;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['sos_network_presence']['Insert']>;
        Relationships: [];
      };
      radar_preferences: {
        Row: {
          user_id: string;
          radar_enabled: boolean;
          visible_to_nearby: boolean;
          show_nickname: boolean;
          public_nickname: string | null;
          sos_network_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          radar_enabled?: boolean;
          visible_to_nearby?: boolean;
          show_nickname?: boolean;
          public_nickname?: string | null;
          sos_network_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          radar_enabled?: boolean;
          visible_to_nearby?: boolean;
          show_nickname?: boolean;
          public_nickname?: string | null;
          sos_network_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      emergency_profiles: {
        Row: {
          user_id: string;
          declared_blood_group: string | null;
          severe_allergies: string | null;
          important_conditions: string | null;
          relevant_medications: string | null;
          lifesaving_medications: string | null;
          ice_contact: string | null;
          emergency_notes: string | null;
          share_medical_data_during_sos: boolean;
          share_ice_contact_during_sos: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          declared_blood_group?: string | null;
          severe_allergies?: string | null;
          important_conditions?: string | null;
          relevant_medications?: string | null;
          lifesaving_medications?: string | null;
          ice_contact?: string | null;
          emergency_notes?: string | null;
          share_medical_data_during_sos?: boolean;
          share_ice_contact_during_sos?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          declared_blood_group?: string | null;
          severe_allergies?: string | null;
          important_conditions?: string | null;
          relevant_medications?: string | null;
          lifesaving_medications?: string | null;
          ice_contact?: string | null;
          emergency_notes?: string | null;
          share_medical_data_during_sos?: boolean;
          share_ice_contact_during_sos?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      initialize_my_account: {
        Args: Record<string, never>;
        Returns: {
          profile_id: string;
          radar_enabled: boolean;
          visible_to_nearby: boolean;
          show_nickname: boolean;
        }[];
      };
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
      claim_my_device_push_token: {
        Args: {
          target_expo_push_token: string;
          target_platform: 'android' | 'ios';
          target_device_name: string | null;
        };
        Returns: {
          id: string;
          user_id: string;
          active: boolean;
          updated_at: string;
        }[];
      };
      claim_sos_push_dispatch: {
        Args: { target_sos_id: string; requested_claim_id: string };
        Returns:
          | 'claimed'
          | 'already_dispatched'
          | 'attempt_in_progress'
          | 'in_progress'
          | 'rate_limited'
          | 'unavailable';
      };
      mark_sos_push_dispatch_attempted: {
        Args: { target_sos_id: string; expected_claim_id: string };
        Returns: boolean;
      };
      complete_sos_push_dispatch: {
        Args: { target_sos_id: string; expected_claim_id: string };
        Returns: boolean;
      };
      release_sos_push_dispatch: {
        Args: { target_sos_id: string; expected_claim_id: string };
        Returns: boolean;
      };
      prepare_sos_delivery: {
        Args: { target_sos_id: string };
        Returns: {
          recipient_user_id: string;
          is_trusted: boolean;
          is_nearby: boolean;
          distance_meters: number | null;
        }[];
      };
      get_received_sos: {
        Args: { target_sos_id: string };
        Returns: {
          sos_id: string;
          sender_display_name: string;
          sos_status: SosStatus;
          latitude: number;
          longitude: number;
          accuracy: number | null;
          event_time: string;
        }[];
      };
      get_sos_status: {
        Args: { target_sos_id: string };
        Returns: {
          sos_id: string;
          sos_status: SosStatus;
          is_owner: boolean;
          accepted_by_me: boolean;
          sos_updated_at: string;
          sos_closed_at: string | null;
        }[];
      };
      accept_sos: {
        Args: { target_sos_id: string };
        Returns: Database['public']['Functions']['get_sos_status']['Returns'];
      };
      close_my_sos: {
        Args: { target_sos_id: string };
        Returns: Database['public']['Functions']['get_sos_status']['Returns'];
      };
      cancel_my_sos: {
        Args: { target_sos_id: string };
        Returns: Database['public']['Functions']['get_sos_status']['Returns'];
      };
      update_my_radar_presence: {
        Args: {
          position_latitude: number;
          position_longitude: number;
          position_accuracy?: number | null;
        };
        Returns: string;
      };
      deactivate_my_radar_presence: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      list_my_active_received_sos: {
        Args: Record<string, never>;
        Returns: {
          sos_id: string;
          event_time: string;
        }[];
      };
      get_my_sos_network_preference: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      update_my_sos_network_preference: {
        Args: { next_enabled: boolean };
        Returns: boolean;
      };
      update_my_sos_network_presence: {
        Args: {
          position_latitude: number;
          position_longitude: number;
          position_accuracy: number;
          position_observed_at: string;
          update_source: 'foreground' | 'background';
        };
        Returns: string;
      };
      deactivate_my_sos_network_presence: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      find_nearby_users: {
        Args: {
          search_radius_meters?: number;
          result_limit?: number;
        };
        Returns: {
          anonymous_id: string;
          public_nickname: string | null;
          distance_meters: number;
          category: 'user' | 'guardian';
          recently_active: boolean;
        }[];
      };
      get_my_radar_preferences: {
        Args: Record<string, never>;
        Returns: {
          radar_enabled: boolean;
          visible_to_nearby: boolean;
          show_nickname: boolean;
          public_nickname: string | null;
          preferences_updated_at: string;
        }[];
      };
      update_my_radar_preferences: {
        Args: {
          next_radar_enabled: boolean;
          next_visible_to_nearby: boolean;
          next_show_nickname: boolean;
          next_public_nickname?: string | null;
        };
        Returns: {
          radar_enabled: boolean;
          visible_to_nearby: boolean;
          show_nickname: boolean;
          public_nickname: string | null;
          preferences_updated_at: string;
        }[];
      };
      get_my_emergency_profile: {
        Args: Record<string, never>;
        Returns: {
          declared_blood_group: string | null;
          severe_allergies: string | null;
          important_conditions: string | null;
          relevant_medications: string | null;
          lifesaving_medications: string | null;
          ice_contact: string | null;
          emergency_notes: string | null;
          share_medical_data_during_sos: boolean;
          share_ice_contact_during_sos: boolean;
          profile_updated_at: string;
        }[];
      };
      update_my_emergency_profile: {
        Args: {
          next_declared_blood_group: string | null;
          next_severe_allergies: string | null;
          next_important_conditions: string | null;
          next_relevant_medications: string | null;
          next_lifesaving_medications: string | null;
          next_ice_contact: string | null;
          next_emergency_notes: string | null;
          next_share_medical_data_during_sos: boolean;
          next_share_ice_contact_during_sos: boolean;
        };
        Returns: {
          declared_blood_group: string | null;
          severe_allergies: string | null;
          important_conditions: string | null;
          relevant_medications: string | null;
          lifesaving_medications: string | null;
          ice_contact: string | null;
          emergency_notes: string | null;
          share_medical_data_during_sos: boolean;
          share_ice_contact_during_sos: boolean;
          profile_updated_at: string;
        }[];
      };
      get_received_sos_emergency_profile: {
        Args: { target_sos_id: string };
        Returns: {
          sos_id: string;
          declared_blood_group: string | null;
          severe_allergies: string | null;
          important_conditions: string | null;
          relevant_medications: string | null;
          lifesaving_medications: string | null;
          ice_contact: string | null;
          emergency_notes: string | null;
          medical_data_shared: boolean;
          ice_contact_shared: boolean;
          declared_by_user: boolean;
        }[];
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
