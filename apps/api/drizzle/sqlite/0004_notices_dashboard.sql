ALTER TABLE `cases` ADD `notice_sent_at` integer;--> statement-breakpoint
ALTER TABLE `cases` ADD `notice_sent_by` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `first_screen_status` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `historical` integer DEFAULT false NOT NULL;