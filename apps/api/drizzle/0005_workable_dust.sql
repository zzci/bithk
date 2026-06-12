ALTER TABLE `hr_colleagues` ADD `birthday` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `hire_date` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `probation_end_date` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `contract_end_date` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `gender` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `employment_type` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `nationality` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `personal_phone` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `personal_email` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `address` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `work_location` text;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `payment_info` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `hr_colleagues` ADD `emergency_contacts` text DEFAULT '[]' NOT NULL;