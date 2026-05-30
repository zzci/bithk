-- Custom SQL migration file, put your code below! --
-- Normalize the issue status enum: open|in_progress|done|cancelled
-- -> todo|working|review|done|cancel. Scoped to type='issue' so the
-- procurement status set (which shares items.status) is untouched.
UPDATE `items` SET `status` = 'todo' WHERE `type` = 'issue' AND `status` = 'open';--> statement-breakpoint
UPDATE `items` SET `status` = 'working' WHERE `type` = 'issue' AND `status` = 'in_progress';--> statement-breakpoint
UPDATE `items` SET `status` = 'cancel' WHERE `type` = 'issue' AND `status` = 'cancelled';