export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SosStatus = 'open' | 'accepted' | 'closed' | 'cancelled';
export type GuardianStatus = 'pending' | 'accepted' | 'rejected' | 'revoked';
export type NearbyAlertStatus = 'detected' | 'acknowledged' | 'expired';
export type NetworkReportCategory =
  | 'SUSPICIOUS_ACTIVITY'
  | 'DISTURBANCE_OR_DANGER'
  | 'UNSAFE_AREA'
  | 'URBAN_HAZARD'
  | 'OTHER_SAFETY';
export type NetworkReportStatus = 'ACTIVE' | 'RESOLVED' | 'EXPIRED' | 'HIDDEN';
export type NetworkConfirmationKind = 'CONFIRMED' | 'NO_LONGER_PRESENT';
export type NetworkContentReportReason =
  | 'FALSE_INFORMATION'
  | 'PERSONAL_ACCUSATION'
  | 'PERSONAL_DATA'
  | 'OFFENSIVE_CONTENT'
  | 'SPAM'
  | 'IRRELEVANT'
  | 'OTHER';

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
          location_updated_at: string | null;
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
          location_updated_at?: string | null;
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
      neighborhood_networks: {
        Row: {
          id: string;
          name: string;
          created_by: string;
          status: 'active' | 'disabled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_by: string;
          status?: 'active' | 'disabled';
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['neighborhood_networks']['Insert']>;
        Relationships: [];
      };
      neighborhood_members: {
        Row: {
          id: string;
          network_id: string;
          user_id: string;
          role: 'admin' | 'member';
          joined_at: string;
        };
        Insert: {
          id?: string;
          network_id: string;
          user_id: string;
          role?: 'admin' | 'member';
          joined_at?: string;
        };
        Update: { role?: 'admin' | 'member' };
        Relationships: [];
      };
      neighborhood_invitations: {
        Row: {
          id: string;
          network_id: string;
          invited_user_id: string;
          invited_by: string;
          status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
          created_at: string;
          responded_at: string | null;
          expires_at: string;
        };
        Insert: {
          id?: string;
          network_id: string;
          invited_user_id: string;
          invited_by: string;
          status?: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
          created_at?: string;
          responded_at?: string | null;
          expires_at?: string;
        };
        Update: {
          status?: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
          responded_at?: string | null;
        };
        Relationships: [];
      };
      neighborhood_invite_tokens: {
        Row: {
          user_id: string;
          token_hash: string;
          created_at: string;
          expires_at: string;
          used_at: string | null;
        };
        Insert: {
          user_id: string;
          token_hash: string;
          created_at?: string;
          expires_at: string;
          used_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['neighborhood_invite_tokens']['Insert']>;
        Relationships: [];
      };
      neighborhood_invite_attempts: {
        Row: { id: number; actor_user_id: string; attempted_at: string };
        Insert: { id?: never; actor_user_id: string; attempted_at?: string };
        Update: never;
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
      create_neighborhood_network: {
        Args: { target_name: string };
        Returns: { network_id: string }[];
      };
      get_my_neighborhood_overview: {
        Args: Record<string, never>;
        Returns: {
          network_id: string;
          network_name: string;
          my_role: 'admin' | 'member';
          member_count: number;
          created_at: string;
        }[];
      };
      list_my_neighborhood_members: {
        Args: { target_network_id: string };
        Returns: {
          membership_id: string;
          nickname: string;
          member_role: 'admin' | 'member';
          joined_at: string;
          is_me: boolean;
        }[];
      };
      list_my_neighborhood_invitations: {
        Args: Record<string, never>;
        Returns: {
          invitation_id: string;
          direction: 'received' | 'sent';
          network_id: string;
          network_name: string;
          counterpart_nickname: string;
          invitation_status: 'pending';
          created_at: string;
          expires_at: string;
        }[];
      };
      create_neighborhood_invitation: {
        Args: { target_network_id: string; target_invite_token: string };
        Returns: { invitation_id: string | null; invitation_created: boolean }[];
      };
      generate_my_neighborhood_invite_token: {
        Args: Record<string, never>;
        Returns: { invite_token: string; expires_at: string }[];
      };
      respond_to_neighborhood_invitation: {
        Args: { target_invitation_id: string; accept_invitation: boolean };
        Returns: {
          network_id: string | null;
          invitation_status:
            | 'accepted'
            | 'declined'
            | 'expired'
            | 'cancelled'
            | 'unavailable';
        }[];
      };
      cancel_neighborhood_invitation: {
        Args: { target_invitation_id: string };
        Returns: 'cancelled' | 'expired' | 'unavailable';
      };
      remove_neighborhood_member: {
        Args: { target_network_id: string; target_membership_id: string };
        Returns: undefined;
      };
      leave_neighborhood_network: {
        Args: { target_network_id: string };
        Returns: undefined;
      };
      accept_network_terms: {
        Args: { target_terms_version: string; target_feed_radius_meters?: number | null };
        Returns: undefined;
      };
      get_my_network_onboarding_status: {
        Args: Record<string, never>;
        Returns: {
          email_verified: boolean;
          nickname_present: boolean;
          phone_verified: boolean;
          current_terms_version: string;
          accepted_terms_version: string | null;
          terms_accepted: boolean;
          eligible: boolean;
          restriction_status:
            | 'NONE'
            | 'READ_ONLY'
            | 'PUBLISH_BLOCKED'
            | 'INTERACTIONS_BLOCKED'
            | 'FULL_NETWORK_BLOCKED';
          nickname: string | null;
        }[];
      };
      create_network_report: {
        Args: {
          target_category: NetworkReportCategory;
          target_description: string;
          target_latitude: number;
          target_longitude: number;
          target_accuracy?: number | null;
        };
        Returns: {
          report_id: string;
          category: NetworkReportCategory;
          description: string;
          author_nickname: string;
          public_area: string;
          created_at: string;
          expires_at: string;
          confirmation_count: number;
          no_longer_present_count: number;
        }[];
      };
      list_nearby_network_reports: {
        Args: {
          viewer_latitude: number;
          viewer_longitude: number;
          radius_meters?: number | null;
          cursor_status_bucket?: number | null;
          cursor_created_at?: string | null;
          cursor_report_id?: string | null;
          requested_page_size?: number | null;
        };
        Returns: {
          report_id: string;
          report_status: NetworkReportStatus;
          category: NetworkReportCategory;
          description: string;
          author_nickname: string;
          public_area: string;
          distance_bucket_meters: number;
          report_created_at: string;
          report_expires_at: string;
          confirmation_count: number;
          no_longer_present_count: number;
          my_confirmation: NetworkConfirmationKind | null;
        }[];
      };
      get_network_report: {
        Args: { target_report_id: string };
        Returns: {
          report_id: string;
          category: NetworkReportCategory;
          description: string;
          author_nickname: string;
          public_area: string;
          report_status: NetworkReportStatus;
          report_created_at: string;
          report_expires_at: string;
          confirmation_count: number;
          no_longer_present_count: number;
          my_confirmation: NetworkConfirmationKind | null;
          updates: Json;
        }[];
      };
      respond_to_network_report: {
        Args: { target_report_id: string; target_kind: NetworkConfirmationKind };
        Returns: undefined;
      };
      add_network_report_update: {
        Args: { target_report_id: string; target_body: string };
        Returns: string;
      };
      resolve_my_network_report: {
        Args: { target_report_id: string };
        Returns: undefined;
      };
      report_network_content: {
        Args: {
          target_report_id?: string | null;
          target_update_id?: string | null;
          target_reason?: NetworkContentReportReason | null;
          target_details?: string | null;
        };
        Returns: string;
      };
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
          location_updated_at: string;
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
      update_my_active_sos_location: {
        Args: {
          target_sos_id: string;
          position_latitude: number;
          position_longitude: number;
          position_accuracy: number;
          position_observed_at: string;
        };
        Returns: boolean;
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
      network_report_category: NetworkReportCategory;
      network_report_status: NetworkReportStatus;
      network_confirmation_kind: NetworkConfirmationKind;
      network_content_report_reason: NetworkContentReportReason;
    };
    CompositeTypes: Record<string, never>;
  };
};
