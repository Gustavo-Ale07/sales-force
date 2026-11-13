CREATE OR REPLACE FUNCTION customer_registration_update_guard() RETURNS trigger AS $$
BEGIN
	IF OLD.status = 'confirmed' THEN
		IF NEW.status IS DISTINCT FROM OLD.status THEN
			RAISE EXCEPTION 'customer_registration: a confirmed registration never changes status' USING ERRCODE = 'check_violation';
		END IF;
		IF NEW.erp_customer_code IS DISTINCT FROM OLD.erp_customer_code THEN
			RAISE EXCEPTION 'customer_registration: a confirmed registration never changes its ERP code' USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	-- updated_at only moves forward (clamped, never rejected, so clock skew cannot break a legitimate settle) and never
	-- into the future (a row that never ages would escape the 30-day purge).
	NEW.updated_at := LEAST(GREATEST(NEW.updated_at, OLD.updated_at), GREATEST(OLD.updated_at, now() + interval '1 minute'));
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
