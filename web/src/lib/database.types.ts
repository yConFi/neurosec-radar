// Generated from the live schema with the Supabase MCP (generate_typescript_types),
// trimmed to the Database type. Regenerate after every migration.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_batches: {
        Row: {
          canceled: number | null
          collected_at: string | null
          created_at: string
          errored: number | null
          expired: number | null
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          request_count: number
          status: string
          succeeded: number | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      article_states: {
        Row: {
          article_id: number
          favorite: boolean
          note: string | null
          read_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          article_id: number
          favorite?: boolean
          note?: string | null
          read_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          article_id?: number
          favorite?: boolean
          note?: string | null
          read_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_states_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          attempts: number
          author: string | null
          batch_id: string | null
          body: string | null
          category: string | null
          content: string | null
          cves: string[]
          detail_es: string | null
          duplicate_of: number | null
          external_id: string | null
          extra: Json
          fetched_at: string
          figures: Json
          highlight: string | null
          id: number
          image_candidates: string[]
          image_url: string | null
          importance: number | null
          is_curious: boolean | null
          is_urgent: boolean | null
          key_points: string[]
          lang: string
          last_error: string | null
          model: string | null
          processed_at: string | null
          published_at: string | null
          search: unknown
          source_id: string
          status: string
          subtopics: string[]
          summary_es: string | null
          title: string
          title_norm: string
          urgent_reason: string | null
          url: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      collector_runs: {
        Row: {
          errors: Json
          finished_at: string | null
          id: number
          ok: boolean | null
          started_at: string
          stats: Json
        }
        Insert: never
        Update: never
        Relationships: []
      }
      sources: {
        Row: {
          category_hint: string | null
          consecutive_failures: number
          created_at: string
          enabled: boolean
          etag: string | null
          id: string
          kind: string
          lang: string
          last_error: string | null
          last_error_at: string | null
          last_modified: string | null
          last_success_at: string | null
          name: string
          updated_at: string
          url: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      vulnerabilities: {
        Row: {
          created_at: string
          cve_id: string
          cvss_score: number | null
          cvss_severity: string | null
          cvss_version: string | null
          description: string | null
          has_public_exploit: boolean
          in_kev: boolean
          kev_date_added: string | null
          kev_due_date: string | null
          kev_ransomware: boolean | null
          nvd_last_modified_at: string | null
          nvd_published_at: string | null
          product: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: {
      feed: {
        Row: {
          category: string | null
          cves: string[] | null
          detail_es: string | null
          duplicate_of: number | null
          external_id: string | null
          extra: Json | null
          favorite: boolean | null
          fetched_at: string | null
          figures: Json | null
          highlight: string | null
          id: number | null
          image_url: string | null
          importance: number | null
          is_curious: boolean | null
          is_urgent: boolean | null
          key_points: string[] | null
          lang: string | null
          note: string | null
          published_at: string | null
          read_at: string | null
          search: unknown
          sort_at: string | null
          source_id: string | null
          source_kind: string | null
          source_name: string | null
          subtopics: string[] | null
          summary_es: string | null
          title: string | null
          urgent_reason: string | null
          url: string | null
        }
        Relationships: []
      }
    }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type FeedRow = Database["public"]["Views"]["feed"]["Row"]
export type Vulnerability = Database["public"]["Tables"]["vulnerabilities"]["Row"]
