CREATE OR REPLACE FUNCTION installation_configuration_version_current_guard() RETURNS trigger AS $$
BEGIN
	IF OLD.is_current = false AND NEW.is_current = true THEN
		RAISE EXCEPTION 'installation_configuration_version: a stored version can never become current again (insert a new version)';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER installation_configuration_version_current_guard BEFORE UPDATE OF is_current ON installation_configuration_version FOR EACH ROW EXECUTE FUNCTION installation_configuration_version_current_guard();
