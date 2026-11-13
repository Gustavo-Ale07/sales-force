-- Hardening of the customer_registration records after the security review (expand-only: functions and triggers, no data change).
-- 1) integration_outbox rows of aggregate 'customer_registration' hold the SNK-4 origin key and the 30-day purge clock: never
--    deleted (by any role), never rewritten by the API, updated_at clamped, origin key and aggregate binding immutable.
--    Order rows are untouched (the API still deletes never-delivered order rows).
-- 2) a status change restarts the 30-day clock (a stuck row cannot be rejected "already old" and then purged).
CREATE OR REPLACE FUNCTION integration_outbox_customer_guard() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.aggregate_type = 'customer_registration' THEN
			RAISE EXCEPTION 'integration_outbox: a customer_registration row is never deleted (it keeps the origin key)' USING ERRCODE = 'check_violation';
		END IF;
		RETURN OLD;
	END IF;
	IF NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type THEN
		RAISE EXCEPTION 'integration_outbox: aggregate_type never changes' USING ERRCODE = 'check_violation';
	END IF;
	IF OLD.aggregate_type <> 'customer_registration' THEN
		RETURN NEW;
	END IF;
	IF current_user = 'force_api' THEN
		RAISE EXCEPTION 'integration_outbox: the API never updates a customer_registration row' USING ERRCODE = 'check_violation';
	END IF;
	IF NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id THEN
		RAISE EXCEPTION 'integration_outbox: aggregate_id never changes' USING ERRCODE = 'check_violation';
	END IF;
	IF OLD.origin_id IS NOT NULL AND NEW.origin_id IS DISTINCT FROM OLD.origin_id THEN
		RAISE EXCEPTION 'integration_outbox: origin_id never changes once set' USING ERRCODE = 'check_violation';
	END IF;
	-- Clamped, never rejected (clock skew cannot break a legitimate settle): forward only, never beyond now() + 1 minute.
	NEW.updated_at := LEAST(GREATEST(NEW.updated_at, OLD.updated_at), GREATEST(OLD.updated_at, now() + interval '1 minute'));
	IF NEW.status IS DISTINCT FROM OLD.status THEN
		NEW.updated_at := now();
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER integration_outbox_customer_guard BEFORE UPDATE OR DELETE ON integration_outbox FOR EACH ROW EXECUTE FUNCTION integration_outbox_customer_guard();--> statement-breakpoint
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
	NEW.updated_at := LEAST(GREATEST(NEW.updated_at, OLD.updated_at), GREATEST(OLD.updated_at, now() + interval '1 minute'));
	-- A status change restarts the 30-day retention clock.
	IF NEW.status IS DISTINCT FROM OLD.status THEN
		NEW.updated_at := now();
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
