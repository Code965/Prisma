CREATE TABLE `trend_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`model` text NOT NULL,
	`keywords` text NOT NULL,
	`sources` text NOT NULL,
	`items` text NOT NULL,
	`trends` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trend_reports_brand_time` ON `trend_reports` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trend_settings` (
	`brand_id` integer PRIMARY KEY NOT NULL,
	`keywords` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
