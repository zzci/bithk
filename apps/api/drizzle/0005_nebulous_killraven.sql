CREATE TABLE `file_blob` (
	`storage_key` text PRIMARY KEY NOT NULL,
	`content` blob NOT NULL,
	`created_at` text NOT NULL
);
