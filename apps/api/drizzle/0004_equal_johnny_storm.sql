PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_procurement_details` (
	`item_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`supplier_id` text,
	`category_id` text,
	`assignee_member_id` text,
	`item_name` text NOT NULL,
	`quantity` integer,
	`amount` integer,
	`currency` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `procurement_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_member_id`) REFERENCES `project_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_procurement_details`("item_id", "project_id", "supplier_id", "category_id", "assignee_member_id", "item_name", "quantity", "amount", "currency") SELECT "item_id", "project_id", "supplier_id", "category_id", "assignee_member_id", "item_name", "quantity", "amount", "currency" FROM `procurement_details`;--> statement-breakpoint
DROP TABLE `procurement_details`;--> statement-breakpoint
ALTER TABLE `__new_procurement_details` RENAME TO `procurement_details`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `procurement_project_idx` ON `procurement_details` (`project_id`);