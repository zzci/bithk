ALTER TABLE `ships` ADD `vessel_type` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
CREATE INDEX `ships_vessel_type_idx` ON `ships` (`vessel_type`,`deleted_at`);
