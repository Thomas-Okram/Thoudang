CREATE TABLE `officers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`district` text
);
--> statement-breakpoint
ALTER TABLE `cases` ADD `screened_at` integer;--> statement-breakpoint
ALTER TABLE `cases` ADD `forwarded_by` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `forwarded_at` integer;--> statement-breakpoint
ALTER TABLE `cases` ADD `correction_requested_at` integer;