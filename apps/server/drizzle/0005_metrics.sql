ALTER TABLE `account_metric_snapshots` ADD `day` varchar(10) NOT NULL;--> statement-breakpoint
ALTER TABLE `account_metric_snapshots` ADD `followers_gained` int unsigned;--> statement-breakpoint
ALTER TABLE `account_metric_snapshots` ADD `followers_lost` int unsigned;--> statement-breakpoint
ALTER TABLE `account_metric_snapshots` ADD `reach` int unsigned;--> statement-breakpoint
ALTER TABLE `account_metric_snapshots` ADD `views` int unsigned;--> statement-breakpoint
ALTER TABLE `metric_snapshots` ADD `source` enum('api','manuale') DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE `account_metric_snapshots` ADD CONSTRAINT `account_metric_snapshots_acc_day` UNIQUE(`social_account_id`,`day`);