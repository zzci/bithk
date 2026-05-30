CREATE TABLE `procurement_tags` (
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Normalize the procurement status enum (PLAN-037): the 7-status vocabulary
-- requested|ordered|confirmed|in_transit|received|accepted|cancelled. Scoped to
-- type='procurement' so the issue status set (which shares items.status) is
-- untouched. Old `requested`/`ordered`/`received`/`cancelled` already match the
-- new vocabulary; only `draft` and `closed` need remapping.
UPDATE `items` SET `status` = 'requested' WHERE `type` = 'procurement' AND `status` = 'draft';--> statement-breakpoint
UPDATE `items` SET `status` = 'accepted' WHERE `type` = 'procurement' AND `status` = 'closed';