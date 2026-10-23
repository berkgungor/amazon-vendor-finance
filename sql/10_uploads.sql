-- 10_uploads.sql: files uploaded in chat (CSV / Excel) become tables in AMAZON_FINANCE_APP.UPLOADS.
-- The app parses the file and passes rows as JSON; LOAD_UPLOAD creates the table and loads it.
-- The agent reads uploads only through LIST_UPLOADS and QUERY_UPLOADS (read-only, UPLOADS schema only).
-- Uploaded tables are not part of the semantic view: they are team-shared working data, not governed metrics.
-- Run as AMZ_FIN_ADMIN. Safe to re-run.

USE ROLE AMZ_FIN_ADMIN;
USE WAREHOUSE AMZ_FIN_WH;
USE DATABASE AMAZON_FINANCE_APP;

CREATE SCHEMA IF NOT EXISTS UPLOADS COMMENT = 'Tables created from files uploaded in the app chat';
GRANT USAGE ON SCHEMA UPLOADS TO ROLE AMZ_FIN_USER;
GRANT SELECT ON ALL TABLES IN SCHEMA UPLOADS TO ROLE AMZ_FIN_USER;
GRANT SELECT ON FUTURE TABLES IN SCHEMA UPLOADS TO ROLE AMZ_FIN_USER;

CREATE TABLE IF NOT EXISTS OPS.UPLOADS_LOG (
    upload_id    VARCHAR       NOT NULL PRIMARY KEY,
    table_name   VARCHAR       NOT NULL COMMENT 'Fully qualified table created for the upload',
    file_name    VARCHAR,
    row_count    NUMBER,
    columns      VARIANT       COMMENT '[{name, type}]',
    uploaded_by  VARCHAR       NOT NULL,
    uploaded_at  TIMESTAMP_LTZ NOT NULL DEFAULT CURRENT_TIMESTAMP()
) COMMENT = 'One row per file uploaded through the app';
GRANT SELECT ON TABLE OPS.UPLOADS_LOG TO ROLE AMZ_FIN_USER;

USE SCHEMA AMAZON_FINANCE_APP.OPS;

-- COLUMNS_JSON: [{"name": "...", "type": "VARCHAR|NUMBER|DATE|TIMESTAMP_NTZ|BOOLEAN"}, ...]
-- ROWS_JSON:    [[v1, v2, ...], ...] in column order. Values are cast with TRY_ functions (bad values become NULL).
-- Never overwrites: if the table name is taken, _2, _3, ... is appended.
CREATE OR REPLACE PROCEDURE LOAD_UPLOAD(TABLE_NAME VARCHAR, FILE_NAME VARCHAR, COLUMNS_JSON VARCHAR, ROWS_JSON VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    cols VARIANT;
    out_cols ARRAY DEFAULT ARRAY_CONSTRUCT();
    n NUMBER;
    i NUMBER DEFAULT 0;
    base VARCHAR;
    tname VARCHAR;
    suffix NUMBER DEFAULT 1;
    taken NUMBER;
    cname VARCHAR;
    ctype VARCHAR;
    defs VARCHAR DEFAULT '';
    sel VARCHAR DEFAULT '';
    val VARCHAR;
    fq VARCHAR;
    ddl VARCHAR;
    dml VARCHAR;
    nrows NUMBER;
    new_id VARCHAR;
BEGIN
    cols := TRY_PARSE_JSON(:COLUMNS_JSON);
    IF (cols IS NULL OR NOT IS_ARRAY(cols) OR ARRAY_SIZE(cols) = 0 OR ARRAY_SIZE(cols) > 200) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'columns_json must be an array of 1 to 200 columns');
    END IF;
    IF (TRY_PARSE_JSON(:ROWS_JSON) IS NULL OR NOT IS_ARRAY(TRY_PARSE_JSON(:ROWS_JSON))) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'rows_json must be a JSON array of rows');
    END IF;

    base := LEFT(TRIM(REGEXP_REPLACE(UPPER(COALESCE(:TABLE_NAME, '')), '[^A-Z0-9_]+', '_'), '_'), 60);
    IF (base = '' OR NOT REGEXP_LIKE(base, '^[A-Z].*')) THEN
        base := LEFT('T_' || base, 60);
    END IF;
    tname := base;
    LOOP
        SELECT COUNT(*) INTO :taken FROM AMAZON_FINANCE_APP.INFORMATION_SCHEMA.TABLES
         WHERE table_schema = 'UPLOADS' AND table_name = :tname;
        IF (taken = 0) THEN
            BREAK;
        END IF;
        suffix := suffix + 1;
        tname := base || '_' || suffix;
    END LOOP;
    fq := 'AMAZON_FINANCE_APP.UPLOADS.' || tname;

    n := ARRAY_SIZE(cols);
    WHILE (i < n) DO
        cname := LEFT(TRIM(REGEXP_REPLACE(UPPER(COALESCE(cols[i]:name::VARCHAR, '')), '[^A-Z0-9_]+', '_'), '_'), 60);
        IF (cname = '' OR NOT REGEXP_LIKE(cname, '^[A-Z].*')) THEN
            cname := 'COL_' || (i + 1) || IFF(cname = '', '', '_' || cname);
        END IF;
        ctype := UPPER(COALESCE(cols[i]:type::VARCHAR, 'VARCHAR'));
        IF (ctype NOT IN ('VARCHAR', 'NUMBER', 'DATE', 'TIMESTAMP_NTZ', 'BOOLEAN')) THEN
            ctype := 'VARCHAR';
        END IF;
        val := 'r.value[' || i || ']::VARCHAR';
        defs := defs || IFF(i > 0, ', ', '') || '"' || cname || '" ' || IFF(ctype = 'NUMBER', 'NUMBER(38,6)', ctype);
        sel := sel || IFF(i > 0, ', ', '') || CASE ctype
            WHEN 'NUMBER' THEN 'TRY_TO_DECIMAL(' || val || ', 38, 6)'
            WHEN 'DATE' THEN 'TRY_TO_DATE(' || val || ')'
            WHEN 'TIMESTAMP_NTZ' THEN 'TRY_TO_TIMESTAMP_NTZ(' || val || ')'
            WHEN 'BOOLEAN' THEN 'TRY_TO_BOOLEAN(' || val || ')'
            ELSE val END;
        out_cols := ARRAY_APPEND(out_cols, OBJECT_CONSTRUCT('name', cname, 'type', ctype));
        i := i + 1;
    END WHILE;

    ddl := 'CREATE TABLE ' || fq || ' (' || defs || ')';
    EXECUTE IMMEDIATE :ddl;
    dml := 'INSERT INTO ' || fq || ' SELECT ' || sel || ' FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?))) r';
    EXECUTE IMMEDIATE :dml USING (ROWS_JSON);
    nrows := SQLROWCOUNT;

    SELECT 'UPL-' || AMAZON_FINANCE_APP.OPS.OPS_ID_SEQ.NEXTVAL INTO :new_id;
    INSERT INTO AMAZON_FINANCE_APP.OPS.UPLOADS_LOG (upload_id, table_name, file_name, row_count, columns, uploaded_by)
    SELECT :new_id, :fq, :FILE_NAME, :nrows, :out_cols, CURRENT_USER();
    RETURN OBJECT_CONSTRUCT('ok', TRUE, 'upload_id', new_id, 'table', fq, 'rows', nrows, 'columns', out_cols);
EXCEPTION
    WHEN OTHER THEN
        IF (fq IS NOT NULL) THEN
            ddl := 'DROP TABLE IF EXISTS ' || fq;
            EXECUTE IMMEDIATE :ddl;
        END IF;
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Upload failed: ' || SQLERRM);
END;
$$;

-- Tables uploaded so far, with columns and row counts (for the agent to discover them).
CREATE OR REPLACE PROCEDURE LIST_UPLOADS()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    out VARIANT;
BEGIN
    SELECT COALESCE(ARRAY_AGG(OBJECT_CONSTRUCT('table', table_name, 'file', file_name, 'rows', row_count,
                                               'columns', columns, 'uploaded_by', uploaded_by, 'uploaded_at', uploaded_at))
                    WITHIN GROUP (ORDER BY uploaded_at DESC), ARRAY_CONSTRUCT())
      INTO :out
      FROM AMAZON_FINANCE_APP.OPS.UPLOADS_LOG l
     WHERE EXISTS (SELECT 1 FROM AMAZON_FINANCE_APP.INFORMATION_SCHEMA.TABLES t
                    WHERE t.table_schema = 'UPLOADS' AND 'AMAZON_FINANCE_APP.UPLOADS.' || t.table_name = l.table_name);
    RETURN OBJECT_CONSTRUCT('ok', TRUE, 'uploads', out);
END;
$$;

-- Read-only query over uploaded tables, run as the caller. Only a single SELECT/WITH is allowed,
-- every table it reads must be in AMAZON_FINANCE_APP.UPLOADS, and at most 200 rows are returned.
CREATE OR REPLACE PROCEDURE QUERY_UPLOADS(QUERY_SQL VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    q VARCHAR;
    plan_sql VARCHAR;
    run_sql VARCHAR;
    outside NUMBER;
    scanned NUMBER;
    out VARIANT;
BEGIN
    q := TRIM(REGEXP_REPLACE(COALESCE(:QUERY_SQL, ''), ';\\s*$', ''));
    IF (NOT REGEXP_LIKE(q, '^\\s*(SELECT|WITH)\\b.*', 'is')) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Query must start with SELECT or WITH');
    END IF;
    IF (CONTAINS(q, ';')) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Only a single statement is allowed');
    END IF;
    IF (REGEXP_LIKE(q, '.*\\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|CALL|COPY|PUT|REMOVE|EXECUTE)\\b.*', 'is')) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Query contains a statement that is not allowed');
    END IF;
    BEGIN
        plan_sql := 'EXPLAIN USING TABULAR ' || q;
        EXECUTE IMMEDIATE :plan_sql;
        SELECT COUNT_IF("objects" IS NOT NULL AND NOT STARTSWITH(UPPER("objects"), 'AMAZON_FINANCE_APP.UPLOADS.')),
               COUNT_IF("objects" IS NOT NULL)
          INTO :outside, :scanned
          FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
    EXCEPTION
        WHEN OTHER THEN
            RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Query does not compile: ' || SQLERRM);
    END;
    IF (outside > 0 OR scanned = 0) THEN
        RETURN OBJECT_CONSTRUCT('ok', FALSE, 'error', 'Only tables in AMAZON_FINANCE_APP.UPLOADS can be queried with this tool');
    END IF;
    run_sql := 'SELECT * FROM (' || q || ') LIMIT 200';
    EXECUTE IMMEDIATE :run_sql;
    SELECT COALESCE(ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)), ARRAY_CONSTRUCT()) INTO :out
      FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));
    RETURN OBJECT_CONSTRUCT('ok', TRUE, 'rows', out, 'row_count', ARRAY_SIZE(out));
END;
$$;

GRANT USAGE ON PROCEDURE LOAD_UPLOAD(VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO ROLE AMZ_FIN_USER;
GRANT USAGE ON PROCEDURE LIST_UPLOADS() TO ROLE AMZ_FIN_USER;
GRANT USAGE ON PROCEDURE QUERY_UPLOADS(VARCHAR) TO ROLE AMZ_FIN_USER;
