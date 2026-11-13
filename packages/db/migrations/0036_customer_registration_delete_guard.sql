CREATE OR REPLACE FUNCTION customer_registration_delete_guard() RETURNS trigger AS $$
BEGIN
	IF OLD.status = 'rejected' AND OLD.updated_at < now() - interval '30 days' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'customer_registration: only a rejected registration older than 30 days can be deleted (retention)' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER customer_registration_delete_guard BEFORE DELETE ON customer_registration FOR EACH ROW EXECUTE FUNCTION customer_registration_delete_guard();
