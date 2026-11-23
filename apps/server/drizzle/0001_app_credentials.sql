CREATE TABLE `app_credentials` (
	`key` text PRIMARY KEY NOT NULL,
	`data_enc` blob NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
