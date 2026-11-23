CREATE TABLE `ai_settings` (
	`id` smallint unsigned NOT NULL,
	`preset` enum('deepseek','ollama','lmstudio','openai','openrouter','personalizzato') NOT NULL,
	`base_url` varchar(500) NOT NULL,
	`model` varchar(200) NOT NULL,
	`api_key_enc` varbinary(2048),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ai_settings_id` PRIMARY KEY(`id`)
);
