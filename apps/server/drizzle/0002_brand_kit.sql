CREATE TABLE `voice_examples` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`brand_id` bigint unsigned NOT NULL,
	`platform` enum('linkedin','instagram','tiktok','youtube','blog') NOT NULL,
	`text` text NOT NULL,
	`note` varchar(200) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `voice_examples_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `brands` ADD `kit` json;--> statement-breakpoint
ALTER TABLE `voice_examples` ADD CONSTRAINT `voice_examples_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `voice_examples_brand` ON `voice_examples` (`brand_id`,`created_at`);