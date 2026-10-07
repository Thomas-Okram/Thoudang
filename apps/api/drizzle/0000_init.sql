CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_case_idx` ON `audit_log` (`case_id`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`applicant_name` text,
	`district` text,
	`status` text DEFAULT 'OFFICER_ATTENTION' NOT NULL,
	`processing_state` text DEFAULT 'RECEIVED' NOT NULL,
	`priority_score` integer DEFAULT 0 NOT NULL,
	`priority_reasons` text DEFAULT '[]' NOT NULL,
	`aadhaar_last4` text,
	`applicant_dob` text,
	`received_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cases_reference_unique` ON `cases` (`reference`);--> statement-breakpoint
CREATE INDEX `cases_status_priority_idx` ON `cases` (`status`,`priority_score`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`original_name` text NOT NULL,
	`stored_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width_px` integer,
	`height_px` integer,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_case_idx` ON `documents` (`case_id`);--> statement-breakpoint
CREATE TABLE `extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`document_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`fields_json` text,
	`error_message` text,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`mean_confidence` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `extractions_case_idx` ON `extractions` (`case_id`);--> statement-breakpoint
CREATE TABLE `flags` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`evidence_json` text NOT NULL,
	`resolution` text DEFAULT 'OPEN' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`resolution_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `flags_case_idx` ON `flags` (`case_id`);--> statement-breakpoint
CREATE TABLE `name_gazetteer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`surname` text NOT NULL,
	`community` text NOT NULL,
	`abbreviations_json` text NOT NULL,
	`source` text DEFAULT 'starter' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `name_gazetteer_surname_unique` ON `name_gazetteer` (`surname`);