CREATE TABLE `competitor_analyses` (
	`brand_id` integer PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`analysis` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `competitor_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competitor_id` integer NOT NULL,
	`external_id` text,
	`title` text,
	`text` text,
	`url` text NOT NULL,
	`published_at` integer NOT NULL,
	`format` text NOT NULL,
	`duration_sec` integer,
	`likes` integer,
	`comments` integer,
	`shares` integer,
	`views` integer,
	`followers` integer,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`competitor_id`) REFERENCES `competitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `competitor_posts_time` ON `competitor_posts` (`competitor_id`,`published_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `competitor_posts_external` ON `competitor_posts` (`competitor_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`handle` text NOT NULL,
	`url` text,
	`notes` text,
	`external_id` text,
	`uploads_id` text,
	`followers` integer,
	`last_fetched_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `competitors_brand` ON `competitors` (`brand_id`);