CREATE TABLE `analytics_insights` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`brand_id` bigint unsigned NOT NULL,
	`week_start` varchar(10) NOT NULL,
	`model` varchar(120) NOT NULL,
	`based_on` int unsigned NOT NULL,
	`tips` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `analytics_insights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `analytics_insights` ADD CONSTRAINT `analytics_insights_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `analytics_insights_brand_time` ON `analytics_insights` (`brand_id`,`created_at`);