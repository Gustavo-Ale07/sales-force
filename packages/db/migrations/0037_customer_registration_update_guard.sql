CREATE OR REPLACE FUNCTION customer_registration_update_guard() RETURNS trigger AS $$
BEGIN
	IF OLD.status = 'confirmed' AND NEW.status IS DISTINCT FROM OLD.status THEN
		RAISE EXCEPTION 'customer_registration: a confirmed registration never changes status' USING ERRCODE = 'check_violation';
	END IF;
	-- One minute of tolerance for clock skew between the application (which stamps updated_at) and the database default.
	IF NEW.updated_at < OLD.updated_at - interval '1 minute' THEN
		RAISE EXCEPTION 'customer_registration: updated_at never goes backwards' USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER customer_registration_update_guard BEFORE UPDATE ON customer_registration FOR EACH ROW EXECUTE FUNCTION customer_registration_update_guard();
