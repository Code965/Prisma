CREATE TABLE `account_metric_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`social_account_id` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`day` text NOT NULL,
	`followers` integer,
	`followers_gained` integer,
	`followers_lost` integer,
	`reach` integer,
	`views` integer,
	`raw` text,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_metric_snapshots_acc_time` ON `account_metric_snapshots` (`social_account_id`,`captured_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_metric_snapshots_acc_day` ON `account_metric_snapshots` (`social_account_id`,`day`);--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`preset` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`api_key_enc` blob,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analytics_insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`week_start` text NOT NULL,
	`model` text NOT NULL,
	`based_on` integer NOT NULL,
	`tips` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_insights_brand_time` ON `analytics_insights` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`kind` text NOT NULL,
	`local_path` text,
	`remote_key` text,
	`remote_url` text,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`checksum_sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assets_brand_checksum` ON `assets` (`brand_id`,`checksum_sha256`);--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Rome' NOT NULL,
	`kit` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_id` integer NOT NULL,
	`variant_id` integer,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`revision_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revision_id`) REFERENCES `variant_revisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_messages_content` ON `chat_messages` (`content_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`idea_id` integer,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contents_brand` ON `contents` (`brand_id`);--> statement-breakpoint
CREATE TABLE `idea_tags` (
	`idea_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`idea_id`, `tag_id`),
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`text` text NOT NULL,
	`source` text DEFAULT 'scritta' NOT NULL,
	`status` text DEFAULT 'nuova' NOT NULL,
	`target_platforms` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ideas_brand_status` ON `ideas` (`brand_id`,`status`);--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publication_id` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`impressions` integer,
	`reach` integer,
	`views` integer,
	`likes` integer,
	`comments` integer,
	`shares` integer,
	`saves` integer,
	`source` text DEFAULT 'api' NOT NULL,
	`raw` text,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `metric_snapshots_pub_time` ON `metric_snapshots` (`publication_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `publication_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publication_id` integer NOT NULL,
	`attempt_no` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`outcome` text,
	`error` text,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_attempts_pub_no` ON `publication_attempts` (`publication_id`,`attempt_no`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`social_account_id` integer NOT NULL,
	`scheduled_at` integer NOT NULL,
	`status` text DEFAULT 'programmato' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`next_attempt_at` integer,
	`locked_by` text,
	`locked_at` integer,
	`idempotency_key` text NOT NULL,
	`external_id` text,
	`external_url` text,
	`last_error` text,
	`published_at` integer,
	`upload_session` text,
	`prepared_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_idempotency_key` ON `publications` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `publications_due` ON `publications` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `publications_variant` ON `publications` (`variant_id`);--> statement-breakpoint
CREATE INDEX `publications_scheduled` ON `publications` (`scheduled_at`);--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`handle` text,
	`display_name` text NOT NULL,
	`access_token_enc` blob NOT NULL,
	`refresh_token_enc` blob,
	`token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scopes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'collegato' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_accounts_brand_platform_ext` ON `social_accounts` (`brand_id`,`platform`,`external_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_brand_name` ON `tags` (`brand_id`,`name`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`data_schema` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `variant_assets` (
	`variant_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`role` text DEFAULT 'media' NOT NULL,
	`render_hash` text,
	PRIMARY KEY(`variant_id`, `asset_id`, `role`),
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `variant_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`body` text NOT NULL,
	`metadata` text NOT NULL,
	`source` text NOT NULL,
	`instruction` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `variant_revisions_variant` ON `variant_revisions` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_id` integer NOT NULL,
	`platform` text NOT NULL,
	`format` text NOT NULL,
	`body` text NOT NULL,
	`metadata` text NOT NULL,
	`status` text DEFAULT 'bozza' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_content_platform` ON `variants` (`content_id`,`platform`);--> statement-breakpoint
CREATE INDEX `variants_status` ON `variants` (`status`);--> statement-breakpoint
CREATE TABLE `voice_examples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`platform` text NOT NULL,
	`text` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `voice_examples_brand` ON `voice_examples` (`brand_id`,`created_at`);