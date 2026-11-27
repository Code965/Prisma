CREATE TABLE `editorial_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`month` text NOT NULL,
	`model` text NOT NULL,
	`summary` text NOT NULL,
	`pillars` text NOT NULL,
	`frequencies` text NOT NULL,
	`items` text NOT NULL,
	`review_comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `editorial_plans_brand_month` ON `editorial_plans` (`brand_id`,`month`);--> statement-breakpoint
ALTER TABLE `ideas` ADD `planned_day` text;