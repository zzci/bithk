CREATE TABLE `hr_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`colleague_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decision_note` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`colleague_id`) REFERENCES `hr_colleagues`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_hr_approvals_status` ON `hr_approvals` (`status`);--> statement-breakpoint
CREATE INDEX `idx_hr_approvals_colleague` ON `hr_approvals` (`colleague_id`);--> statement-breakpoint
CREATE TABLE `hr_payroll_records` (
	`id` text PRIMARY KEY NOT NULL,
	`colleague_id` text NOT NULL,
	`period` text NOT NULL,
	`base_salary` integer NOT NULL,
	`bonus` integer DEFAULT 0 NOT NULL,
	`deduction` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`net_amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`colleague_id`) REFERENCES `hr_colleagues`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hr_payroll_colleague_period` ON `hr_payroll_records` (`colleague_id`,`period`);--> statement-breakpoint
CREATE INDEX `idx_hr_payroll_status` ON `hr_payroll_records` (`status`);--> statement-breakpoint
CREATE INDEX `idx_hr_payroll_period` ON `hr_payroll_records` (`period`);