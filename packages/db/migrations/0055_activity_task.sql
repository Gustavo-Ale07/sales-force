CREATE TABLE "activity_task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"assignee_account_id" uuid NOT NULL,
	"created_by_account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp with time zone NOT NULL,
	"reminder_lead_minutes" smallint,
	"reminded_at" timestamp with time zone,
	"customer_code" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_account_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_task_type_chk" CHECK ("activity_task"."type" in ('call', 'visit', 'email', 'whatsapp', 'meeting', 'other')),
	CONSTRAINT "activity_task_status_chk" CHECK ("activity_task"."status" in ('pending', 'completed', 'cancelled')),
	CONSTRAINT "activity_task_completed_chk" CHECK (("activity_task"."status" = 'completed') = ("activity_task"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "activity_task" ADD CONSTRAINT "activity_task_assignee_account_id_account_id_fk" FOREIGN KEY ("assignee_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_task" ADD CONSTRAINT "activity_task_created_by_account_id_account_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_task" ADD CONSTRAINT "activity_task_completed_by_account_id_account_id_fk" FOREIGN KEY ("completed_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_task_creator_request_uq" ON "activity_task" USING btree ("created_by_account_id","client_request_id");--> statement-breakpoint
CREATE INDEX "activity_task_assignee_due_idx" ON "activity_task" USING btree ("assignee_account_id","status","due_at");--> statement-breakpoint
CREATE INDEX "activity_task_reminder_idx" ON "activity_task" USING btree ("due_at") WHERE "activity_task"."status" = 'pending' and "activity_task"."reminder_lead_minutes" is not null and "activity_task"."reminded_at" is null;--> statement-breakpoint
CREATE INDEX "activity_task_customer_idx" ON "activity_task" USING btree ("customer_code") WHERE "activity_task"."customer_code" is not null;
