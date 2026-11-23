CREATE TABLE `account_metric_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`social_account_id` bigint unsigned NOT NULL,
	`captured_at` datetime(3) NOT NULL,
	`followers` int unsigned,
	`raw` json,
	CONSTRAINT `account_metric_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`brand_id` bigint unsigned NOT NULL,
	`kind` enum('image','pdf','video','audio') NOT NULL,
	`local_path` varchar(1024),
	`remote_key` varchar(512),
	`remote_url` varchar(1024),
	`mime` varchar(127) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`width` int unsigned,
	`height` int unsigned,
	`duration_ms` int unsigned,
	`checksum_sha256` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`initials` varchar(3) NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'Europe/Rome',
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `brands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`content_id` bigint unsigned NOT NULL,
	`variant_id` bigint unsigned,
	`role` enum('user','assistant') NOT NULL,
	`text` text NOT NULL,
	`revision_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contents` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`brand_id` bigint unsigned NOT NULL,
	`idea_id` bigint unsigned,
	`title` varchar(200) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `contents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `idea_tags` (
	`idea_id` bigint unsigned NOT NULL,
	`tag_id` bigint unsigned NOT NULL,
	CONSTRAINT `idea_tags_idea_id_tag_id_pk` PRIMARY KEY(`idea_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`brand_id` bigint unsigned NOT NULL,
	`text` text NOT NULL,
	`source` enum('scritta','vocale','suggerita') NOT NULL DEFAULT 'scritta',
	`status` enum('nuova','in_lavorazione','usata','archiviata') NOT NULL DEFAULT 'nuova',
	`target_platforms` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ideas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`publication_id` bigint unsigned NOT NULL,
	`captured_at` datetime(3) NOT NULL,
	`impressions` int unsigned,
	`reach` int unsigned,
	`views` int unsigned,
	`likes` int unsigned,
	`comments` int unsigned,
	`shares` int unsigned,
	`saves` int unsigned,
	`raw` json,
	CONSTRAINT `metric_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `publication_attempts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`publication_id` bigint unsigned NOT NULL,
	`attempt_no` smallint unsigned NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`outcome` enum('successo','errore_temporaneo','errore_definitivo'),
	`error` text,
	CONSTRAINT `publication_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `publication_attempts_pub_no` UNIQUE(`publication_id`,`attempt_no`)
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`variant_id` bigint unsigned NOT NULL,
	`social_account_id` bigint unsigned NOT NULL,
	`scheduled_at` datetime(3) NOT NULL,
	`status` enum('programmato','in_pubblicazione','pubblicato','errore','annullato') NOT NULL DEFAULT 'programmato',
	`attempts` smallint unsigned NOT NULL DEFAULT 0,
	`max_attempts` smallint unsigned NOT NULL DEFAULT 5,
	`next_attempt_at` datetime(3),
	`locked_by` varchar(64),
	`locked_at` datetime(3),
	`idempotency_key` varchar(64) NOT NULL,
	`external_id` varchar(255),
	`external_url` varchar(1024),
	`last_error` text,
	`published_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `publications_id` PRIMARY KEY(`id`),
	CONSTRAINT `publications_idempotency_key` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`brand_id` bigint unsigned NOT NULL,
	`platform` enum('linkedin','instagram','tiktok','youtube') NOT NULL,
	`external_id` varchar(191) NOT NULL,
	`handle` varchar(191),
	`display_name` varchar(191) NOT NULL,
	`access_token_enc` varbinary(4096) NOT NULL,
	`refresh_token_enc` varbinary(4096),
	`token_expires_at` datetime(3),
	`refresh_token_expires_at` datetime(3),
	`scopes` varchar(1024) NOT NULL DEFAULT '',
	`status` enum('collegato','da_rinnovare','errore','scollegato') NOT NULL DEFAULT 'collegato',
	`last_error` text,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `social_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `social_accounts_brand_platform_ext` UNIQUE(`brand_id`,`platform`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`brand_id` bigint unsigned NOT NULL,
	`name` varchar(40) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tags_brand_name` UNIQUE(`brand_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`brand_id` bigint unsigned,
	`kind` enum('carosello','post','citazione','codice','miniatura_yt','copertina_verticale') NOT NULL,
	`name` varchar(120) NOT NULL,
	`data_schema` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `variant_assets` (
	`variant_id` bigint unsigned NOT NULL,
	`asset_id` bigint unsigned NOT NULL,
	`position` smallint unsigned NOT NULL DEFAULT 0,
	`role` enum('media','copertina') NOT NULL DEFAULT 'media',
	CONSTRAINT `variant_assets_variant_id_asset_id_role_pk` PRIMARY KEY(`variant_id`,`asset_id`,`role`)
);
--> statement-breakpoint
CREATE TABLE `variant_revisions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`variant_id` bigint unsigned NOT NULL,
	`body` text NOT NULL,
	`metadata` json NOT NULL,
	`source` enum('llm_generate','llm_edit','manuale') NOT NULL,
	`instruction` text,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `variant_revisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `variants` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`content_id` bigint unsigned NOT NULL,
	`platform` enum('linkedin','instagram','tiktok','youtube') NOT NULL,
	`format` enum('post','carosello','reel','storia','video','short') NOT NULL,
	`body` text NOT NULL,
	`metadata` json NOT NULL,
	`status` enum('bozza','da_approvare','approvato','programmato','in_pubblicazione','pubblicato','errore') NOT NULL DEFAULT 'bozza',
	`version` int unsigned NOT NULL DEFAULT 0,
	`approved_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `variants_id` PRIMARY KEY(`id`),
	CONSTRAINT `variants_content_platform` UNIQUE(`content_id`,`platform`)
);
--> statement-breakpoint
ALTER TABLE `account_metric_snapshots` ADD CONSTRAINT `account_metric_snapshots_social_account_id_social_accounts_id_fk` FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_content_id_contents_id_fk` FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_revision_id_variant_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `variant_revisions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contents` ADD CONSTRAINT `contents_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contents` ADD CONSTRAINT `contents_idea_id_ideas_id_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idea_tags` ADD CONSTRAINT `idea_tags_idea_id_ideas_id_fk` FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idea_tags` ADD CONSTRAINT `idea_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ideas` ADD CONSTRAINT `ideas_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `metric_snapshots` ADD CONSTRAINT `metric_snapshots_publication_id_publications_id_fk` FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publication_attempts` ADD CONSTRAINT `publication_attempts_publication_id_publications_id_fk` FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publications` ADD CONSTRAINT `publications_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publications` ADD CONSTRAINT `publications_social_account_id_social_accounts_id_fk` FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `social_accounts` ADD CONSTRAINT `social_accounts_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tags` ADD CONSTRAINT `tags_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `templates` ADD CONSTRAINT `templates_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_assets` ADD CONSTRAINT `variant_assets_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_assets` ADD CONSTRAINT `variant_assets_asset_id_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variant_revisions` ADD CONSTRAINT `variant_revisions_variant_id_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variants` ADD CONSTRAINT `variants_content_id_contents_id_fk` FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `account_metric_snapshots_acc_time` ON `account_metric_snapshots` (`social_account_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `assets_brand_checksum` ON `assets` (`brand_id`,`checksum_sha256`);--> statement-breakpoint
CREATE INDEX `chat_messages_content` ON `chat_messages` (`content_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contents_brand` ON `contents` (`brand_id`);--> statement-breakpoint
CREATE INDEX `ideas_brand_status` ON `ideas` (`brand_id`,`status`);--> statement-breakpoint
CREATE INDEX `metric_snapshots_pub_time` ON `metric_snapshots` (`publication_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `publications_due` ON `publications` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `publications_variant` ON `publications` (`variant_id`);--> statement-breakpoint
CREATE INDEX `publications_scheduled` ON `publications` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `variant_revisions_variant` ON `variant_revisions` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `variants_status` ON `variants` (`status`);