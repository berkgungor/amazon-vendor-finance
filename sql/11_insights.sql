-- 11_insights.sql: the agent records findings as insights, each with the action items that address it.
-- SAVE_INSIGHT writes the insight and its actions in one transaction; every action keeps insight_id,
-- so the Insights page can show an insight's actions and the Action items page can link back.
-- Run as AMZ_FIN_ADMIN. Safe to re-run.

USE ROLE AMZ_FIN_ADMIN;
USE WAREHOUSE AMZ_FIN_WH;
USE SCHEMA AMAZON_FINANCE_APP.OPS;

-- PROBLEM_AREA: shortage_recovery | unexplained_deductions | cash_collection | coop | general
-- ACTIONS_JSON: [{"action_type","title","entity_type","entity_id","amount_usd","priority","owner","due_date","notes"}, ...]
CREATE OR REPLACE PROCEDURE SAVE_INSIGHT(
    PROBLEM_AREA VARCHAR, SEVERITY VARCHAR, TITLE VARCHAR, SUMMARY VARCHAR,
    METRIC_NAME VARCHAR, CURRENT_VALUE NUMBER(18,2), COMPARISON_VALUE NUMBER(18,2),
    EVIDENCE_SQL VARCHAR, ACTIONS_JSON VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    area VARCHAR DEFAULT LOWER(COALESCE(:PROBLEM_AREA, 'general'));
    sev VARCHAR DEFAULT LOWER(COALESCE(:SEVERITY, 'medium'));
    evidence VARCHAR;
    validation VARCHAR;
    actions VARIANT;
    n NUMBER DEFAULT 0;
    i NUMBER DEFAULT 0;
    a VARIANT;
    atype VARCHAR;
    atitle VARCHAR;
    prio VARCHAR;
    errors ARRAY DEFAULT ARRAY_CONSTRUCT();
    new_id VARCHAR;
    act_id VARCHAR;
    act_ids ARRAY DEFAULT ARRAY_CONSTRUCT();
    etype VARCHAR;
    eid VARCHAR;
    amount NUMBER(18,2);
    aowner VARCHAR;
    due DATE;
    anotes VARCHAR;
BEGIN
    IF (area NOT IN ('shortage_recovery', 'unexplained_deductions', 'cash_collection', 'coop', 'general')) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'problem_area must be shortage_recovery, unexplained_deductions, cash_collection, coop or general');
    END IF;
    IF (sev NOT IN ('high', 'medium', 'low')) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'severity must be high, medium or low');
    END IF;
    IF (:TITLE IS NULL OR TRIM(:TITLE) = '' OR :SUMMARY IS NULL OR TRIM(:SUMMARY) = '') THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'title and summary are required');
    END IF;
    evidence := NULLIF(TRIM(COALESCE(:EVIDENCE_SQL, '')), '');
    IF (evidence IS NOT NULL) THEN
        CALL AMAZON_FINANCE_APP.OPS.VALIDATE_READ_QUERY(:evidence) INTO :validation;
        IF (validation IS NOT NULL) THEN
            RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'evidence_sql: ' || validation);
        END IF;
    END IF;

    actions := COALESCE(TRY_PARSE_JSON(NULLIF(TRIM(COALESCE(:ACTIONS_JSON, '')), '')), ARRAY_CONSTRUCT());
    IF (NOT IS_ARRAY(actions)) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'actions_json must be a JSON array');
    END IF;
    n := ARRAY_SIZE(actions);
    IF (n > 10) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'At most 10 actions per insight');
    END IF;
    WHILE (i < n) DO
        a := actions[i];
        atype := LOWER(COALESCE(a:action_type::VARCHAR, 'other'));
        prio := LOWER(COALESCE(a:priority::VARCHAR, 'medium'));
        IF (atype NOT IN ('dispute_shortage', 'resolve_deduction', 'chase_payment', 'coop_review', 'price_fix', 'other')) THEN
            errors := ARRAY_APPEND(errors, OBJECT_CONSTRUCT('action', i, 'error', 'Unknown action_type'));
        ELSEIF (prio NOT IN ('high', 'medium', 'low')) THEN
            errors := ARRAY_APPEND(errors, OBJECT_CONSTRUCT('action', i, 'error', 'priority must be high, medium or low'));
        ELSEIF (a:title IS NULL OR TRIM(a:title::VARCHAR) = '') THEN
            errors := ARRAY_APPEND(errors, OBJECT_CONSTRUCT('action', i, 'error', 'title is required'));
        ELSEIF (a:due_date IS NOT NULL AND a:due_date::VARCHAR <> '' AND TRY_TO_DATE(a:due_date::VARCHAR) IS NULL) THEN
            errors := ARRAY_APPEND(errors, OBJECT_CONSTRUCT('action', i, 'error', 'due_date must be YYYY-MM-DD'));
        END IF;
        i := i + 1;
    END WHILE;
    IF (ARRAY_SIZE(errors) > 0) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Some actions are invalid; nothing was saved', 'action_errors', errors);
    END IF;

    BEGIN TRANSACTION;
    SELECT 'INS-' || AMAZON_FINANCE_APP.OPS.OPS_ID_SEQ.NEXTVAL INTO :new_id;
    INSERT INTO AMAZON_FINANCE_APP.OPS.INSIGHTS
        (insight_id, business_problem, severity, title, summary, metric_name, current_value, comparison_value,
         change_pct, evidence_sql, status, created_via)
    SELECT :new_id, :area, :sev, TRIM(:TITLE), TRIM(:SUMMARY), :METRIC_NAME, :CURRENT_VALUE, :COMPARISON_VALUE,
           IFF(:COMPARISON_VALUE IS NULL OR :COMPARISON_VALUE = 0, NULL,
               ROUND(100 * (:CURRENT_VALUE - :COMPARISON_VALUE) / ABS(:COMPARISON_VALUE), 1)),
           :evidence, 'active', 'agent';
    i := 0;
    WHILE (i < n) DO
        a := actions[i];
        atype := LOWER(COALESCE(a:action_type::VARCHAR, 'other'));
        prio := LOWER(COALESCE(a:priority::VARCHAR, 'medium'));
        atitle := TRIM(a:title::VARCHAR);
        etype := NULLIF(a:entity_type::VARCHAR, '');
        eid := NULLIF(a:entity_id::VARCHAR, '');
        amount := TRY_TO_DECIMAL(a:amount_usd::VARCHAR, 18, 2);
        aowner := NULLIF(TRIM(COALESCE(a:owner::VARCHAR, '')), '');
        due := TRY_TO_DATE(NULLIF(a:due_date::VARCHAR, ''));
        anotes := a:notes::VARCHAR;
        SELECT 'ACT-' || AMAZON_FINANCE_APP.OPS.OPS_ID_SEQ.NEXTVAL INTO :act_id;
        INSERT INTO AMAZON_FINANCE_APP.OPS.ACTION_ITEMS
            (action_item_id, action_type, title, notes, entity_type, entity_id, amount_usd, priority, owner,
             due_date, source, insight_id, created_by, updated_by)
        SELECT :act_id, :atype, :atitle, :anotes, :etype, :eid, :amount, :prio, :aowner,
               :due, 'agent', :new_id, CURRENT_USER(), CURRENT_USER();
        act_ids := ARRAY_APPEND(act_ids, act_id);
        i := i + 1;
    END WHILE;
    COMMIT;
    RETURN OBJECT_CONSTRUCT('ok', TRUE, 'insight_id', new_id, 'title', TRIM(:TITLE), 'action_item_ids', act_ids);
EXCEPTION
    WHEN OTHER THEN
        ROLLBACK;
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Save failed: ' || SQLERRM);
END;
$$;

GRANT USAGE ON PROCEDURE SAVE_INSIGHT(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMBER, NUMBER, VARCHAR, VARCHAR) TO ROLE AMZ_FIN_USER;
GRANT USAGE ON PROCEDURE SAVE_INSIGHT(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMBER, NUMBER, VARCHAR, VARCHAR) TO ROLE AMZ_FIN_APP;
