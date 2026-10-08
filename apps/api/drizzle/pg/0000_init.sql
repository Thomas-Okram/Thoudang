CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"reason" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"applicant_name" text,
	"district" text,
	"status" text DEFAULT 'OFFICER_ATTENTION' NOT NULL,
	"processing_state" text DEFAULT 'RECEIVED' NOT NULL,
	"priority_score" integer DEFAULT 0 NOT NULL,
	"priority_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aadhaar_last4" text,
	"applicant_dob" text,
	"source" text DEFAULT 'desk' NOT NULL,
	"batch_id" text,
	"packet_name" text,
	"received_at" bigint NOT NULL,
	"decided_by" text,
	"decided_at" bigint,
	"screened_at" bigint,
	"forwarded_by" text,
	"forwarded_at" bigint,
	"correction_requested_at" bigint,
	"notice_sent_at" bigint,
	"notice_sent_by" text,
	"first_screen_status" text,
	"historical" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "cases_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"detected_type" text,
	"type_confidence" text,
	"type_source" text,
	"state" text DEFAULT 'UPLOADED' NOT NULL,
	"original_name" text NOT NULL,
	"stored_path" text NOT NULL,
	"processed_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width_px" integer NOT NULL,
	"height_px" integer NOT NULL,
	"sha256" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"result_json" jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"document_id" text NOT NULL,
	"stage" text NOT NULL,
	"detected_type" text,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"result_json" jsonb,
	"error_message" text,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"resolution" text DEFAULT 'OPEN' NOT NULL,
	"resolved_by" text,
	"resolved_at" bigint,
	"resolution_reason" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "name_gazetteer" (
	"id" serial PRIMARY KEY NOT NULL,
	"surname" text NOT NULL,
	"community" text NOT NULL,
	"abbreviations_json" jsonb NOT NULL,
	"source" text DEFAULT 'starter' NOT NULL,
	"confidence" text,
	"tribe" text,
	CONSTRAINT "name_gazetteer_surname_unique" UNIQUE("surname")
);
--> statement-breakpoint
CREATE TABLE "officers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"district" text
);
--> statement-breakpoint
CREATE TABLE "session_files" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"original_name" text NOT NULL,
	"path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"from_device" text NOT NULL,
	"doc_type" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"submitted_at" bigint,
	"case_id" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_files" ADD CONSTRAINT "session_files_session_id_upload_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_case_idx" ON "audit_log" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "cases_status_priority_idx" ON "cases" USING btree ("status","priority_score");--> statement-breakpoint
CREATE INDEX "cases_batch_idx" ON "cases" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "documents_case_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "extractions_case_idx" ON "extractions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "flags_case_idx" ON "flags" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "session_files_session_idx" ON "session_files" USING btree ("session_id");