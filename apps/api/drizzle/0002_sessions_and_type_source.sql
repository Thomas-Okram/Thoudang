CREATE TABLE `session_files` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`original_name` text NOT NULL,
	`path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`from_device` text NOT NULL,
	`doc_type` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `upload_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_files_session_idx` ON `session_files` (`session_id`);--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`submitted_at` integer,
	`case_id` text
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `type_source` text;