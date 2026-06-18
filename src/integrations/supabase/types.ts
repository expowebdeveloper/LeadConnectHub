export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_alerts: {
        Row: {
          body: Json
          created_at: string
          id: string
          kind: string
          resolved_at: string | null
          severity: string
          title: string
        }
        Insert: {
          body?: Json
          created_at?: string
          id?: string
          kind: string
          resolved_at?: string | null
          severity?: string
          title: string
        }
        Update: {
          body?: Json
          created_at?: string
          id?: string
          kind?: string
          resolved_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: []
      }
      ai_audit_log: {
        Row: {
          action_taken: string | null
          confidence: string | null
          conversation_id: string | null
          created_at: string
          data_sources: string[] | null
          id: string
          question: string | null
          tool_input: Json | null
          tool_name: string | null
          tool_output_summary: string | null
          user_id: string | null
        }
        Insert: {
          action_taken?: string | null
          confidence?: string | null
          conversation_id?: string | null
          created_at?: string
          data_sources?: string[] | null
          id?: string
          question?: string | null
          tool_input?: Json | null
          tool_name?: string | null
          tool_output_summary?: string | null
          user_id?: string | null
        }
        Update: {
          action_taken?: string | null
          confidence?: string | null
          conversation_id?: string | null
          created_at?: string
          data_sources?: string[] | null
          id?: string
          question?: string | null
          tool_input?: Json | null
          tool_name?: string | null
          tool_output_summary?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_audit_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          context_id: string | null
          context_kind: string
          created_at: string
          id: string
          owner_id: string
          title: string
          updated_at: string
        }
        Insert: {
          context_id?: string | null
          context_kind?: string
          created_at?: string
          id?: string
          owner_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          context_id?: string | null
          context_kind?: string
          created_at?: string
          id?: string
          owner_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message_id: string | null
          parts: Json
          role: string
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message_id?: string | null
          parts?: Json
          role: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message_id?: string | null
          parts?: Json
          role?: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_pinned_insights: {
        Row: {
          body: Json
          id: string
          pinned_at: string
          source_conversation_id: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          body?: Json
          id?: string
          pinned_at?: string
          source_conversation_id?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          body?: Json
          id?: string
          pinned_at?: string
          source_conversation_id?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_pinned_insights_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          close_rate_target: number
          id: number
          monthly_auto_goal: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          close_rate_target?: number
          id?: number
          monthly_auto_goal?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          close_rate_target?: number
          id?: number
          monthly_auto_goal?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          workspace_id?: string | null
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          agent_id: string | null
          answered_at: string | null
          created_at: string
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          from_number: string | null
          hangup_cause: string | null
          id: string
          lead_activity_id: string | null
          lead_id: string | null
          lead_table: string | null
          notes: string | null
          outcome: string | null
          raw_event: Json | null
          recording_url: string | null
          started_at: string | null
          status: string | null
          to_number: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          answered_at?: string | null
          created_at?: string
          direction: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          hangup_cause?: string | null
          id?: string
          lead_activity_id?: string | null
          lead_id?: string | null
          lead_table?: string | null
          notes?: string | null
          outcome?: string | null
          raw_event?: Json | null
          recording_url?: string | null
          started_at?: string | null
          status?: string | null
          to_number?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          answered_at?: string | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          hangup_cause?: string | null
          id?: string
          lead_activity_id?: string | null
          lead_id?: string | null
          lead_table?: string | null
          notes?: string | null
          outcome?: string | null
          raw_event?: Json | null
          recording_url?: string | null
          started_at?: string | null
          status?: string | null
          to_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chat_announcement_acks: {
        Row: {
          acknowledged_at: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_announcement_acks_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_attachments: {
        Row: {
          conversation_id: string
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          message_id: string
          uploaded_by: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          message_id: string
          uploaded_by?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          message_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          metadata: Json
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      chat_conversation_members: {
        Row: {
          conversation_id: string
          id: string
          joined_at: string
          last_read_at: string
          muted: boolean
          notification_level: string
          role: Database["public"]["Enums"]["chat_member_role"]
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          joined_at?: string
          last_read_at?: string
          muted?: boolean
          notification_level?: string
          role?: Database["public"]["Enums"]["chat_member_role"]
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string
          muted?: boolean
          notification_level?: string
          role?: Database["public"]["Enums"]["chat_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_private: boolean
          last_message_at: string | null
          name: string | null
          type: Database["public"]["Enums"]["chat_conversation_type"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_private?: boolean
          last_message_at?: string | null
          name?: string | null
          type?: Database["public"]["Enums"]["chat_conversation_type"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_private?: boolean
          last_message_at?: string | null
          name?: string | null
          type?: Database["public"]["Enums"]["chat_conversation_type"]
          updated_at?: string
        }
        Relationships: []
      }
      chat_lead_conversations: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string | null
          lead_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by?: string | null
          lead_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_lead_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_mentions: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          mention_type: string
          mentioned_user_id: string | null
          message_id: string
          read_at: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          mention_type?: string
          mentioned_user_id?: string | null
          message_id: string
          read_at?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          mention_type?: string
          mentioned_user_id?: string | null
          message_id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_mentions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_mentions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          is_high_priority: boolean
          is_pinned_announcement: boolean
          message_type: Database["public"]["Enums"]["chat_message_type"]
          parent_message_id: string | null
          requires_ack: boolean
          sender_id: string | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_high_priority?: boolean
          is_pinned_announcement?: boolean
          message_type?: Database["public"]["Enums"]["chat_message_type"]
          parent_message_id?: string | null
          requires_ack?: boolean
          sender_id?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_high_priority?: boolean
          is_pinned_announcement?: boolean
          message_type?: Database["public"]["Enums"]["chat_message_type"]
          parent_message_id?: string | null
          requires_ack?: boolean
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_pinned_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message_id: string
          pinned_by: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message_id: string
          pinned_by?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message_id?: string
          pinned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_pinned_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_pinned_messages_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_tasks: {
        Row: {
          assignee: string | null
          completed_at: string | null
          conversation_id: string
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          id: string
          lead_id: string | null
          message_id: string | null
          priority: string
          status: string
          title: string
        }
        Insert: {
          assignee?: string | null
          completed_at?: string | null
          conversation_id: string
          created_at?: string
          created_by: string
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          message_id?: string | null
          priority?: string
          status?: string
          title: string
        }
        Update: {
          assignee?: string | null
          completed_at?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string | null
          message_id?: string | null
          priority?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_tasks_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_shared: boolean
          owner: string | null
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_shared?: boolean
          owner?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_shared?: boolean
          owner?: string | null
          title?: string
        }
        Relationships: []
      }
      dispo_options: {
        Row: {
          created_at: string
          enabled: boolean
          is_system: boolean
          label: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          is_system?: boolean
          label: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          is_system?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      goals: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          metric: string
          period: string
          scope: string
          target: number
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          metric: string
          period: string
          scope: string
          target?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          metric?: string
          period?: string
          scope?: string
          target?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          action: string
          created_at: string
          details: Json
          id: string
          lead_id: string
          lead_table: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          id?: string
          lead_id: string
          lead_table: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          id?: string
          lead_id?: string
          lead_table?: string
          user_id?: string | null
        }
        Relationships: []
      }
      lead_disputes: {
        Row: {
          admin_notes: string | null
          created_at: string
          evidence_paths: string[]
          id: string
          lead_id: string
          lead_source: string
          reason_category: string
          reason_details: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          submitted_by: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          evidence_paths?: string[]
          id?: string
          lead_id: string
          lead_source: string
          reason_category: string
          reason_details?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          submitted_by: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          evidence_paths?: string[]
          id?: string
          lead_id?: string
          lead_source?: string
          reason_category?: string
          reason_details?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          submitted_by?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: []
      }
      lead_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: string
          lead_id: string
          lead_table: string
          line_key: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          lead_id: string
          lead_table: string
          line_key?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          lead_id?: string
          lead_table?: string
          line_key?: string | null
        }
        Relationships: []
      }
      lead_shares: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          lead_table: string
          line_id: string | null
          shared_by: string
          shared_with: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          lead_table: string
          line_id?: string | null
          shared_by: string
          shared_with: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          lead_table?: string
          line_id?: string | null
          shared_by?: string
          shared_with?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          agent_id: string | null
          agent_notes: string | null
          archived_at: string | null
          auto_archive: Json | null
          auto_motor_club_premium: number | null
          auto_policies_count: number
          auto_sale_type: Database["public"]["Enums"]["sale_type"] | null
          auto_score: number | null
          billable_override: boolean | null
          city: string
          claimed_at: string | null
          claimed_by: string | null
          claims_last_5y: number | null
          composite_score: number | null
          construction_type: string | null
          county: string
          created_at: string
          current_carrier: string | null
          current_home_carrier: string | null
          current_premium: number | null
          date_of_birth: string | null
          dispo: Database["public"]["Enums"]["lead_dispo"] | null
          dwelling_value: number | null
          email: string | null
          existing_client_lines: string[] | null
          first_name: string
          flood_zone: string | null
          follow_up_at: string | null
          has_pool: boolean | null
          has_trampoline: boolean | null
          home_agent_notes: string | null
          home_claimed_at: string | null
          home_claimed_by: string | null
          home_dispo: Database["public"]["Enums"]["lead_dispo"] | null
          home_follow_up_at: string | null
          home_policies_count: number
          home_quoted_premium: number | null
          home_sale_type: Database["public"]["Enums"]["sale_type"] | null
          home_score: number | null
          home_x_date: string | null
          housing_status: string | null
          id: string
          last_contacted_at: string | null
          last_name: string
          last_no_connect_at: string | null
          last_released_at: string | null
          lead_lines: Json
          lead_source: string
          lead_type: Database["public"]["Enums"]["lead_type"]
          lead_types: string[]
          litigator: boolean
          lob_order: string[] | null
          mortgage_company: string | null
          no_connect_calls: number
          num_bathrooms: number | null
          num_bedrooms: number | null
          num_stories: number | null
          num_vehicles: number | null
          optin_proof_path: string | null
          phone: string
          quoted_premium: number | null
          referred_by: string | null
          release_count: number
          requires_dispo_call_activity_id: string | null
          roof_type: string | null
          roof_year: number | null
          score_breakdown: Json | null
          score_tier: string | null
          scored_at: string | null
          square_feet: number | null
          state: string
          street: string
          transferred_by: string | null
          updated_at: string
          vehicles: Json
          vendor_id: string | null
          vendor_notes: string | null
          vendor_payout: number | null
          x_date: string | null
          year_built: number | null
          zip: string
        }
        Insert: {
          agent_id?: string | null
          agent_notes?: string | null
          archived_at?: string | null
          auto_archive?: Json | null
          auto_motor_club_premium?: number | null
          auto_policies_count?: number
          auto_sale_type?: Database["public"]["Enums"]["sale_type"] | null
          auto_score?: number | null
          billable_override?: boolean | null
          city: string
          claimed_at?: string | null
          claimed_by?: string | null
          claims_last_5y?: number | null
          composite_score?: number | null
          construction_type?: string | null
          county: string
          created_at?: string
          current_carrier?: string | null
          current_home_carrier?: string | null
          current_premium?: number | null
          date_of_birth?: string | null
          dispo?: Database["public"]["Enums"]["lead_dispo"] | null
          dwelling_value?: number | null
          email?: string | null
          existing_client_lines?: string[] | null
          first_name: string
          flood_zone?: string | null
          follow_up_at?: string | null
          has_pool?: boolean | null
          has_trampoline?: boolean | null
          home_agent_notes?: string | null
          home_claimed_at?: string | null
          home_claimed_by?: string | null
          home_dispo?: Database["public"]["Enums"]["lead_dispo"] | null
          home_follow_up_at?: string | null
          home_policies_count?: number
          home_quoted_premium?: number | null
          home_sale_type?: Database["public"]["Enums"]["sale_type"] | null
          home_score?: number | null
          home_x_date?: string | null
          housing_status?: string | null
          id?: string
          last_contacted_at?: string | null
          last_name: string
          last_no_connect_at?: string | null
          last_released_at?: string | null
          lead_lines?: Json
          lead_source?: string
          lead_type?: Database["public"]["Enums"]["lead_type"]
          lead_types?: string[]
          litigator?: boolean
          lob_order?: string[] | null
          mortgage_company?: string | null
          no_connect_calls?: number
          num_bathrooms?: number | null
          num_bedrooms?: number | null
          num_stories?: number | null
          num_vehicles?: number | null
          optin_proof_path?: string | null
          phone: string
          quoted_premium?: number | null
          referred_by?: string | null
          release_count?: number
          requires_dispo_call_activity_id?: string | null
          roof_type?: string | null
          roof_year?: number | null
          score_breakdown?: Json | null
          score_tier?: string | null
          scored_at?: string | null
          square_feet?: number | null
          state: string
          street: string
          transferred_by?: string | null
          updated_at?: string
          vehicles?: Json
          vendor_id?: string | null
          vendor_notes?: string | null
          vendor_payout?: number | null
          x_date?: string | null
          year_built?: number | null
          zip: string
        }
        Update: {
          agent_id?: string | null
          agent_notes?: string | null
          archived_at?: string | null
          auto_archive?: Json | null
          auto_motor_club_premium?: number | null
          auto_policies_count?: number
          auto_sale_type?: Database["public"]["Enums"]["sale_type"] | null
          auto_score?: number | null
          billable_override?: boolean | null
          city?: string
          claimed_at?: string | null
          claimed_by?: string | null
          claims_last_5y?: number | null
          composite_score?: number | null
          construction_type?: string | null
          county?: string
          created_at?: string
          current_carrier?: string | null
          current_home_carrier?: string | null
          current_premium?: number | null
          date_of_birth?: string | null
          dispo?: Database["public"]["Enums"]["lead_dispo"] | null
          dwelling_value?: number | null
          email?: string | null
          existing_client_lines?: string[] | null
          first_name?: string
          flood_zone?: string | null
          follow_up_at?: string | null
          has_pool?: boolean | null
          has_trampoline?: boolean | null
          home_agent_notes?: string | null
          home_claimed_at?: string | null
          home_claimed_by?: string | null
          home_dispo?: Database["public"]["Enums"]["lead_dispo"] | null
          home_follow_up_at?: string | null
          home_policies_count?: number
          home_quoted_premium?: number | null
          home_sale_type?: Database["public"]["Enums"]["sale_type"] | null
          home_score?: number | null
          home_x_date?: string | null
          housing_status?: string | null
          id?: string
          last_contacted_at?: string | null
          last_name?: string
          last_no_connect_at?: string | null
          last_released_at?: string | null
          lead_lines?: Json
          lead_source?: string
          lead_type?: Database["public"]["Enums"]["lead_type"]
          lead_types?: string[]
          litigator?: boolean
          lob_order?: string[] | null
          mortgage_company?: string | null
          no_connect_calls?: number
          num_bathrooms?: number | null
          num_bedrooms?: number | null
          num_stories?: number | null
          num_vehicles?: number | null
          optin_proof_path?: string | null
          phone?: string
          quoted_premium?: number | null
          referred_by?: string | null
          release_count?: number
          requires_dispo_call_activity_id?: string | null
          roof_type?: string | null
          roof_year?: number | null
          score_breakdown?: Json | null
          score_tier?: string | null
          scored_at?: string | null
          square_feet?: number | null
          state?: string
          street?: string
          transferred_by?: string | null
          updated_at?: string
          vehicles?: Json
          vendor_id?: string | null
          vendor_notes?: string | null
          vendor_payout?: number | null
          x_date?: string | null
          year_built?: number | null
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_requires_dispo_call_activity_id_fkey"
            columns: ["requires_dispo_call_activity_id"]
            isOneToOne: false
            referencedRelation: "lead_activities"
            referencedColumns: ["id"]
          },
        ]
      }
      list_leads: {
        Row: {
          agent_id: string | null
          agent_notes: string | null
          archived_at: string | null
          auto_archive: Json | null
          auto_motor_club_premium: number | null
          auto_policies_count: number
          auto_sale_type: Database["public"]["Enums"]["sale_type"] | null
          auto_score: number | null
          billable_override: boolean | null
          city: string | null
          claimed_at: string | null
          claimed_by: string | null
          claims_last_5y: number | null
          composite_score: number | null
          construction_type: string | null
          county: string | null
          created_at: string
          current_carrier: string | null
          current_home_carrier: string | null
          current_premium: number | null
          date_of_birth: string | null
          dispo: Database["public"]["Enums"]["lead_dispo"] | null
          dwelling_value: number | null
          email: string | null
          existing_client_lines: string[] | null
          first_name: string | null
          flood_zone: string | null
          follow_up_at: string | null
          has_pool: boolean | null
          has_trampoline: boolean | null
          home_agent_notes: string | null
          home_claimed_at: string | null
          home_claimed_by: string | null
          home_dispo: Database["public"]["Enums"]["lead_dispo"] | null
          home_follow_up_at: string | null
          home_policies_count: number
          home_quoted_premium: number | null
          home_sale_type: Database["public"]["Enums"]["sale_type"] | null
          home_score: number | null
          home_x_date: string | null
          housing_status: string | null
          id: string
          import_batch_id: string | null
          last_contacted_at: string | null
          last_name: string | null
          last_no_connect_at: string | null
          last_released_at: string | null
          lead_lines: Json
          lead_source: string
          lead_type: Database["public"]["Enums"]["lead_type"]
          lead_types: string[]
          list_type: string | null
          list_type_priority: number | null
          litigator: boolean
          mortgage_company: string | null
          no_connect_calls: number
          not_billable: boolean
          num_bathrooms: number | null
          num_bedrooms: number | null
          num_stories: number | null
          num_vehicles: number | null
          phone: string | null
          quoted_premium: number | null
          referred_by: string | null
          release_count: number
          requires_dispo_call_activity_id: string | null
          roof_type: string | null
          roof_year: number | null
          score_breakdown: Json | null
          score_tier: string | null
          scored_at: string | null
          shark_tank_side: string | null
          source_row: Json | null
          square_feet: number | null
          state: string | null
          street: string | null
          transferred_at: string | null
          transferred_by: string | null
          transferred_lead_id: string | null
          updated_at: string
          vehicles: Json
          vendor_id: string | null
          vendor_notes: string | null
          vendor_payout: number | null
          x_date: string | null
          year_built: number | null
          zip: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_notes?: string | null
          archived_at?: string | null
          auto_archive?: Json | null
          auto_motor_club_premium?: number | null
          auto_policies_count?: number
          auto_sale_type?: Database["public"]["Enums"]["sale_type"] | null
          auto_score?: number | null
          billable_override?: boolean | null
          city?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          claims_last_5y?: number | null
          composite_score?: number | null
          construction_type?: string | null
          county?: string | null
          created_at?: string
          current_carrier?: string | null
          current_home_carrier?: string | null
          current_premium?: number | null
          date_of_birth?: string | null
          dispo?: Database["public"]["Enums"]["lead_dispo"] | null
          dwelling_value?: number | null
          email?: string | null
          existing_client_lines?: string[] | null
          first_name?: string | null
          flood_zone?: string | null
          follow_up_at?: string | null
          has_pool?: boolean | null
          has_trampoline?: boolean | null
          home_agent_notes?: string | null
          home_claimed_at?: string | null
          home_claimed_by?: string | null
          home_dispo?: Database["public"]["Enums"]["lead_dispo"] | null
          home_follow_up_at?: string | null
          home_policies_count?: number
          home_quoted_premium?: number | null
          home_sale_type?: Database["public"]["Enums"]["sale_type"] | null
          home_score?: number | null
          home_x_date?: string | null
          housing_status?: string | null
          id?: string
          import_batch_id?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          last_no_connect_at?: string | null
          last_released_at?: string | null
          lead_lines?: Json
          lead_source?: string
          lead_type?: Database["public"]["Enums"]["lead_type"]
          lead_types?: string[]
          list_type?: string | null
          list_type_priority?: number | null
          litigator?: boolean
          mortgage_company?: string | null
          no_connect_calls?: number
          not_billable?: boolean
          num_bathrooms?: number | null
          num_bedrooms?: number | null
          num_stories?: number | null
          num_vehicles?: number | null
          phone?: string | null
          quoted_premium?: number | null
          referred_by?: string | null
          release_count?: number
          requires_dispo_call_activity_id?: string | null
          roof_type?: string | null
          roof_year?: number | null
          score_breakdown?: Json | null
          score_tier?: string | null
          scored_at?: string | null
          shark_tank_side?: string | null
          source_row?: Json | null
          square_feet?: number | null
          state?: string | null
          street?: string | null
          transferred_at?: string | null
          transferred_by?: string | null
          transferred_lead_id?: string | null
          updated_at?: string
          vehicles?: Json
          vendor_id?: string | null
          vendor_notes?: string | null
          vendor_payout?: number | null
          x_date?: string | null
          year_built?: number | null
          zip?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_notes?: string | null
          archived_at?: string | null
          auto_archive?: Json | null
          auto_motor_club_premium?: number | null
          auto_policies_count?: number
          auto_sale_type?: Database["public"]["Enums"]["sale_type"] | null
          auto_score?: number | null
          billable_override?: boolean | null
          city?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          claims_last_5y?: number | null
          composite_score?: number | null
          construction_type?: string | null
          county?: string | null
          created_at?: string
          current_carrier?: string | null
          current_home_carrier?: string | null
          current_premium?: number | null
          date_of_birth?: string | null
          dispo?: Database["public"]["Enums"]["lead_dispo"] | null
          dwelling_value?: number | null
          email?: string | null
          existing_client_lines?: string[] | null
          first_name?: string | null
          flood_zone?: string | null
          follow_up_at?: string | null
          has_pool?: boolean | null
          has_trampoline?: boolean | null
          home_agent_notes?: string | null
          home_claimed_at?: string | null
          home_claimed_by?: string | null
          home_dispo?: Database["public"]["Enums"]["lead_dispo"] | null
          home_follow_up_at?: string | null
          home_policies_count?: number
          home_quoted_premium?: number | null
          home_sale_type?: Database["public"]["Enums"]["sale_type"] | null
          home_score?: number | null
          home_x_date?: string | null
          housing_status?: string | null
          id?: string
          import_batch_id?: string | null
          last_contacted_at?: string | null
          last_name?: string | null
          last_no_connect_at?: string | null
          last_released_at?: string | null
          lead_lines?: Json
          lead_source?: string
          lead_type?: Database["public"]["Enums"]["lead_type"]
          lead_types?: string[]
          list_type?: string | null
          list_type_priority?: number | null
          litigator?: boolean
          mortgage_company?: string | null
          no_connect_calls?: number
          not_billable?: boolean
          num_bathrooms?: number | null
          num_bedrooms?: number | null
          num_stories?: number | null
          num_vehicles?: number | null
          phone?: string | null
          quoted_premium?: number | null
          referred_by?: string | null
          release_count?: number
          requires_dispo_call_activity_id?: string | null
          roof_type?: string | null
          roof_year?: number | null
          score_breakdown?: Json | null
          score_tier?: string | null
          scored_at?: string | null
          shark_tank_side?: string | null
          source_row?: Json | null
          square_feet?: number | null
          state?: string | null
          street?: string | null
          transferred_at?: string | null
          transferred_by?: string | null
          transferred_lead_id?: string | null
          updated_at?: string
          vehicles?: Json
          vendor_id?: string | null
          vendor_notes?: string | null
          vendor_payout?: number | null
          x_date?: string | null
          year_built?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "list_leads_requires_dispo_call_activity_id_fkey"
            columns: ["requires_dispo_call_activity_id"]
            isOneToOne: false
            referencedRelation: "lead_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_leads_transferred_lead_id_fkey"
            columns: ["transferred_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      litigator_cache: {
        Row: {
          checked_at: string
          is_litigator: boolean
          phone: string
          raw_response: Json | null
        }
        Insert: {
          checked_at?: string
          is_litigator?: boolean
          phone: string
          raw_response?: Json | null
        }
        Update: {
          checked_at?: string
          is_litigator?: boolean
          phone?: string
          raw_response?: Json | null
        }
        Relationships: []
      }
      plivo_calls: {
        Row: {
          answered_at: string | null
          call_uuid: string
          created_at: string
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          from_number: string | null
          hangup_cause: string | null
          lead_id: string | null
          lead_table: string | null
          raw: Json
          recording_duration: number | null
          recording_url: string | null
          started_at: string | null
          status: string | null
          to_number: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          answered_at?: string | null
          call_uuid: string
          created_at?: string
          direction: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          hangup_cause?: string | null
          lead_id?: string | null
          lead_table?: string | null
          raw?: Json
          recording_duration?: number | null
          recording_url?: string | null
          started_at?: string | null
          status?: string | null
          to_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          answered_at?: string | null
          call_uuid?: string
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          hangup_cause?: string | null
          lead_id?: string | null
          lead_table?: string | null
          raw?: Json
          recording_duration?: number | null
          recording_url?: string | null
          started_at?: string | null
          status?: string | null
          to_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      plivo_endpoints: {
        Row: {
          caller_id: string | null
          created_at: string
          endpoint_alias: string | null
          endpoint_password: string
          endpoint_username: string
          updated_at: string
          user_id: string
        }
        Insert: {
          caller_id?: string | null
          created_at?: string
          endpoint_alias?: string | null
          endpoint_password?: string
          endpoint_username: string
          updated_at?: string
          user_id: string
        }
        Update: {
          caller_id?: string | null
          created_at?: string
          endpoint_alias?: string | null
          endpoint_password?: string
          endpoint_username?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      presence_events: {
        Row: {
          id: number
          started_at: string
          status: Database["public"]["Enums"]["chat_presence_status"]
          user_id: string
        }
        Insert: {
          id?: number
          started_at?: string
          status: Database["public"]["Enums"]["chat_presence_status"]
          user_id: string
        }
        Update: {
          id?: number
          started_at?: string
          status?: Database["public"]["Enums"]["chat_presence_status"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          agent_type: string | null
          avatar_url: string | null
          bypass_litigator: boolean
          company_name: string | null
          created_at: string
          date_of_birth: string | null
          default_lead_rate: number | null
          direct_phone: string | null
          email: string
          frozen: boolean
          frozen_at: string | null
          frozen_reason: string | null
          full_name: string | null
          id: string
          last_active_at: string | null
          manual_status: string | null
          manual_status_note: string | null
          manual_status_until: string | null
          max_age: number | null
          min_vehicles: number | null
          notification_prefs: Json
          parent_vendor_id: string | null
          requested_role: string | null
          start_date: string | null
          telemarketer_goal_calls: number | null
          telemarketer_goal_period: string | null
          telemarketer_goal_transfers: number | null
          updated_at: string
        }
        Insert: {
          agent_type?: string | null
          avatar_url?: string | null
          bypass_litigator?: boolean
          company_name?: string | null
          created_at?: string
          date_of_birth?: string | null
          default_lead_rate?: number | null
          direct_phone?: string | null
          email: string
          frozen?: boolean
          frozen_at?: string | null
          frozen_reason?: string | null
          full_name?: string | null
          id: string
          last_active_at?: string | null
          manual_status?: string | null
          manual_status_note?: string | null
          manual_status_until?: string | null
          max_age?: number | null
          min_vehicles?: number | null
          notification_prefs?: Json
          parent_vendor_id?: string | null
          requested_role?: string | null
          start_date?: string | null
          telemarketer_goal_calls?: number | null
          telemarketer_goal_period?: string | null
          telemarketer_goal_transfers?: number | null
          updated_at?: string
        }
        Update: {
          agent_type?: string | null
          avatar_url?: string | null
          bypass_litigator?: boolean
          company_name?: string | null
          created_at?: string
          date_of_birth?: string | null
          default_lead_rate?: number | null
          direct_phone?: string | null
          email?: string
          frozen?: boolean
          frozen_at?: string | null
          frozen_reason?: string | null
          full_name?: string | null
          id?: string
          last_active_at?: string | null
          manual_status?: string | null
          manual_status_note?: string | null
          manual_status_until?: string | null
          max_age?: number | null
          min_vehicles?: number | null
          notification_prefs?: Json
          parent_vendor_id?: string | null
          requested_role?: string | null
          start_date?: string | null
          telemarketer_goal_calls?: number | null
          telemarketer_goal_period?: string | null
          telemarketer_goal_transfers?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sale_events: {
        Row: {
          agent_avatar_url: string | null
          agent_id: string | null
          agent_name: string | null
          created_at: string
          id: string
          items_count: number | null
          lead_id: string
          lead_name: string | null
          lead_table: string
          premium: number | null
          side: string
          source: string | null
        }
        Insert: {
          agent_avatar_url?: string | null
          agent_id?: string | null
          agent_name?: string | null
          created_at?: string
          id?: string
          items_count?: number | null
          lead_id: string
          lead_name?: string | null
          lead_table: string
          premium?: number | null
          side: string
          source?: string | null
        }
        Update: {
          agent_avatar_url?: string | null
          agent_id?: string | null
          agent_name?: string | null
          created_at?: string
          id?: string
          items_count?: number | null
          lead_id?: string
          lead_name?: string | null
          lead_table?: string
          premium?: number | null
          side?: string
          source?: string | null
        }
        Relationships: []
      }
      scoring_weights: {
        Row: {
          id: number
          updated_at: string
          updated_by: string | null
          weights: Json
        }
        Insert: {
          id?: number
          updated_at?: string
          updated_by?: string | null
          weights: Json
        }
        Update: {
          id?: number
          updated_at?: string
          updated_by?: string | null
          weights?: Json
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          custom_status: string | null
          last_seen_at: string
          status: Database["public"]["Enums"]["chat_presence_status"]
          status_clear_at: string | null
          status_emoji: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          custom_status?: string | null
          last_seen_at?: string
          status?: Database["public"]["Enums"]["chat_presence_status"]
          status_clear_at?: string | null
          status_emoji?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          custom_status?: string | null
          last_seen_at?: string
          status?: Database["public"]["Enums"]["chat_presence_status"]
          status_clear_at?: string | null
          status_emoji?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_invites: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          label: string | null
          token: string
          used_at: string | null
          used_by: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          label?: string | null
          token: string
          used_at?: string | null
          used_by?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          label?: string | null
          token?: string
          used_at?: string | null
          used_by?: string | null
          vendor_id?: string
        }
        Relationships: []
      }
      vendor_post_rejections: {
        Row: {
          created_at: string
          details: Json
          endpoint: string
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          reason: string
          token_id: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          endpoint: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          reason: string
          token_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          endpoint?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          reason?: string
          token_id?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_post_rejections_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "vendor_post_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_post_rejections_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_post_tokens: {
        Row: {
          active: boolean
          created_at: string
          destination: string
          id: string
          label: string | null
          last_used_at: string | null
          post_count: number
          token: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          destination?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          post_count?: number
          token: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          destination?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          post_count?: number
          token?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_post_tokens_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      zillow_property_data: {
        Row: {
          address_key: string | null
          annual_tax: number | null
          baths: number | null
          beds: number | null
          construction_type: string | null
          created_at: string
          fetch_error: string | null
          fetched_at: string
          flood_zone: string | null
          has_pool: boolean | null
          id: string
          last_sold_date: string | null
          last_sold_price: number | null
          lead_id: string
          listing_url: string | null
          lot_sqft: number | null
          photo_url: string | null
          raw: Json | null
          rent_zestimate: number | null
          roof_year: number | null
          source: string
          sqft: number | null
          tax_assessed_value: number | null
          updated_at: string
          year_built: number | null
          zestimate: number | null
        }
        Insert: {
          address_key?: string | null
          annual_tax?: number | null
          baths?: number | null
          beds?: number | null
          construction_type?: string | null
          created_at?: string
          fetch_error?: string | null
          fetched_at?: string
          flood_zone?: string | null
          has_pool?: boolean | null
          id?: string
          last_sold_date?: string | null
          last_sold_price?: number | null
          lead_id: string
          listing_url?: string | null
          lot_sqft?: number | null
          photo_url?: string | null
          raw?: Json | null
          rent_zestimate?: number | null
          roof_year?: number | null
          source?: string
          sqft?: number | null
          tax_assessed_value?: number | null
          updated_at?: string
          year_built?: number | null
          zestimate?: number | null
        }
        Update: {
          address_key?: string | null
          annual_tax?: number | null
          baths?: number | null
          beds?: number | null
          construction_type?: string | null
          created_at?: string
          fetch_error?: string | null
          fetched_at?: string
          flood_zone?: string | null
          has_pool?: boolean | null
          id?: string
          last_sold_date?: string | null
          last_sold_price?: number | null
          lead_id?: string
          listing_url?: string | null
          lot_sqft?: number | null
          photo_url?: string | null
          raw?: Json | null
          rent_zestimate?: number | null
          roof_year?: number | null
          source?: string
          sqft?: number | null
          tax_assessed_value?: number | null
          updated_at?: string
          year_built?: number | null
          zestimate?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _format_list_type: { Args: { t: string }; Returns: string }
      add_dispo_option: {
        Args: { p_label: string; p_sort?: number; p_value: string }
        Returns: {
          created_at: string
          enabled: boolean
          is_system: boolean
          label: string
          sort_order: number
          updated_at: string
          value: string
        }
        SetofOptions: {
          from: "*"
          to: "dispo_options"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calc_lead_score:
        | {
            Args: {
              p_auto_carrier: string
              p_created_at: string
              p_date_of_birth: string
              p_dispo: string
              p_dwelling_value: number
              p_email: string
              p_home_carrier: string
              p_home_dispo: string
              p_housing_status: string
              p_is_aged_source: boolean
              p_is_list_source: boolean
              p_lead_types: string[]
              p_list_type?: string
              p_num_vehicles: number
              p_phone: string
              p_square_feet: number
              p_vendor_id: string
              p_year_built: number
            }
            Returns: {
              auto_score: number
              breakdown: Json
              composite_score: number
              home_score: number
              score_tier: string
            }[]
          }
        | {
            Args: {
              p_auto_carrier: string
              p_construction_type?: string
              p_created_at: string
              p_date_of_birth: string
              p_dispo: string
              p_dwelling_value: number
              p_email: string
              p_flood_zone?: string
              p_has_pool?: boolean
              p_has_trampoline?: boolean
              p_home_carrier: string
              p_home_dispo: string
              p_housing_status: string
              p_is_aged_source: boolean
              p_is_list_source: boolean
              p_lead_types: string[]
              p_list_type?: string
              p_num_vehicles: number
              p_phone: string
              p_roof_type?: string
              p_roof_year?: number
              p_square_feet: number
              p_vendor_id: string
              p_year_built: number
            }
            Returns: {
              auto_score: number
              breakdown: Json
              composite_score: number
              home_score: number
              score_tier: string
            }[]
          }
      chat_is_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      claim_list_lead: {
        Args: { p_id: string }
        Returns: {
          agent_id: string | null
          agent_notes: string | null
          archived_at: string | null
          auto_archive: Json | null
          auto_motor_club_premium: number | null
          auto_policies_count: number
          auto_sale_type: Database["public"]["Enums"]["sale_type"] | null
          auto_score: number | null
          billable_override: boolean | null
          city: string | null
          claimed_at: string | null
          claimed_by: string | null
          claims_last_5y: number | null
          composite_score: number | null
          construction_type: string | null
          county: string | null
          created_at: string
          current_carrier: string | null
          current_home_carrier: string | null
          current_premium: number | null
          date_of_birth: string | null
          dispo: Database["public"]["Enums"]["lead_dispo"] | null
          dwelling_value: number | null
          email: string | null
          existing_client_lines: string[] | null
          first_name: string | null
          flood_zone: string | null
          follow_up_at: string | null
          has_pool: boolean | null
          has_trampoline: boolean | null
          home_agent_notes: string | null
          home_claimed_at: string | null
          home_claimed_by: string | null
          home_dispo: Database["public"]["Enums"]["lead_dispo"] | null
          home_follow_up_at: string | null
          home_policies_count: number
          home_quoted_premium: number | null
          home_sale_type: Database["public"]["Enums"]["sale_type"] | null
          home_score: number | null
          home_x_date: string | null
          housing_status: string | null
          id: string
          import_batch_id: string | null
          last_contacted_at: string | null
          last_name: string | null
          last_no_connect_at: string | null
          last_released_at: string | null
          lead_lines: Json
          lead_source: string
          lead_type: Database["public"]["Enums"]["lead_type"]
          lead_types: string[]
          list_type: string | null
          list_type_priority: number | null
          litigator: boolean
          mortgage_company: string | null
          no_connect_calls: number
          not_billable: boolean
          num_bathrooms: number | null
          num_bedrooms: number | null
          num_stories: number | null
          num_vehicles: number | null
          phone: string | null
          quoted_premium: number | null
          referred_by: string | null
          release_count: number
          requires_dispo_call_activity_id: string | null
          roof_type: string | null
          roof_year: number | null
          score_breakdown: Json | null
          score_tier: string | null
          scored_at: string | null
          shark_tank_side: string | null
          source_row: Json | null
          square_feet: number | null
          state: string | null
          street: string | null
          transferred_at: string | null
          transferred_by: string | null
          transferred_lead_id: string | null
          updated_at: string
          vehicles: Json
          vendor_id: string | null
          vendor_notes: string | null
          vendor_payout: number | null
          x_date: string | null
          year_built: number | null
          zip: string | null
        }
        SetofOptions: {
          from: "*"
          to: "list_leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clean_dob: { Args: { d: string }; Returns: string }
      daily_archive_and_move_leads: { Args: never; Returns: undefined }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_health: {
        Args: { stall_minutes?: number }
        Returns: {
          auth_depth: number
          oldest_age_seconds: number
          stalled_count: number
          transactional_depth: number
        }[]
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      finalize_stale_initiated_calls: { Args: never; Returns: number }
      fuzzy_lead_ids: {
        Args: { lim?: number; q: string }
        Returns: {
          id: string
          score: number
        }[]
      }
      fuzzy_list_lead_ids: {
        Args: { lim?: number; q: string }
        Returns: {
          id: string
          score: number
        }[]
      }
      get_parent_vendor_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_lead_claimer: {
        Args: { _lead_id: string; _lead_table: string; _user_id: string }
        Returns: boolean
      }
      is_lead_shared_with: {
        Args: { _lead_id: string; _lead_table: string; _user_id: string }
        Returns: boolean
      }
      is_line_claimer: {
        Args: {
          _lead_id: string
          _lead_table: string
          _line_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_line_shared_with: {
        Args: {
          _lead_id: string
          _lead_table: string
          _line_id: string
          _user_id: string
        }
        Returns: boolean
      }
      lead_line_remove: {
        Args: { p_lead_id: string; p_line_id: string; p_table: string }
        Returns: Json
      }
      lead_line_upsert: {
        Args: { p_lead_id: string; p_line: Json; p_table: string }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalize_carrier: { Args: { raw: string }; Returns: string }
      notify_sale_event:
        | {
            Args: {
              p_agent_id: string
              p_first: string
              p_last: string
              p_lead_id: string
              p_lead_table: string
              p_premium: number
              p_side: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_agent_id: string
              p_first: string
              p_items?: number
              p_last: string
              p_lead_id: string
              p_lead_table: string
              p_premium: number
              p_side: string
            }
            Returns: undefined
          }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      user_can_access_lead_for_notes: {
        Args: { _lead_id: string; _lead_table: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "sales" | "vendor" | "pending" | "telemarketer"
      chat_conversation_type: "channel" | "dm" | "group_dm" | "announcement"
      chat_member_role: "owner" | "admin" | "member"
      chat_message_type: "text" | "file" | "system" | "announcement"
      chat_presence_status:
        | "online"
        | "away"
        | "busy"
        | "offline"
        | "on_call"
        | "quoting"
        | "follow_up"
        | "lunch"
        | "break"
        | "meeting"
        | "dnd"
      lead_dispo:
        | "quoted"
        | "sold"
        | "not_quoted"
        | "follow_up"
        | "wrong_number"
        | "x_date"
        | "dead"
        | "dnc"
        | "already_has_allstate"
        | "already_a_client"
        | "voicemail"
      lead_type:
        | "auto"
        | "home"
        | "both"
        | "umbrella"
        | "flood"
        | "boat"
        | "motorcycle"
        | "golf_cart"
        | "rv"
      sale_type: "monoline" | "bundled" | "bundled_preferred"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "sales", "vendor", "pending", "telemarketer"],
      chat_conversation_type: ["channel", "dm", "group_dm", "announcement"],
      chat_member_role: ["owner", "admin", "member"],
      chat_message_type: ["text", "file", "system", "announcement"],
      chat_presence_status: [
        "online",
        "away",
        "busy",
        "offline",
        "on_call",
        "quoting",
        "follow_up",
        "lunch",
        "break",
        "meeting",
        "dnd",
      ],
      lead_dispo: [
        "quoted",
        "sold",
        "not_quoted",
        "follow_up",
        "wrong_number",
        "x_date",
        "dead",
        "dnc",
        "already_has_allstate",
        "already_a_client",
        "voicemail",
      ],
      lead_type: [
        "auto",
        "home",
        "both",
        "umbrella",
        "flood",
        "boat",
        "motorcycle",
        "golf_cart",
        "rv",
      ],
      sale_type: ["monoline", "bundled", "bundled_preferred"],
    },
  },
} as const
