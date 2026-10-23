-- evals/ground_truth.sql: evaluation questions for APP.AMAZON_VENDOR_FINANCE_AGENT and the SQL
-- that computes each expected answer. Read-only questions only (nothing the agent should create
-- or update). Deductions always come from STAGING.STG_DEDUCTION_CLAIMS (one row per claim);
-- never sum invoice_amount over remittance lines.
-- Results checked on 2026-10-23 against docs/plan.md. Data runs July 2021 - April 2025, so aging
-- questions use a fixed as-of date of 2025-04-30 instead of CURRENT_DATE.
-- sql/09_evals.sql loads these questions and answers into OPS.EVAL_QUESTIONS.

USE WAREHOUSE AMZ_FIN_WH;
USE SCHEMA AMAZON_FINANCE_APP.STAGING;

---------------------------------------------------------------------------------------------
-- Deductions and categories
---------------------------------------------------------------------------------------------

-- Q01 What is the total amount Amazon deducted, excluding provisions?
-- Expected: $5,386,340.08 across 4,309 deduction claims.
SELECT COUNT(*) AS claims, SUM(deducted_amount) AS total_deducted
FROM STG_DEDUCTION_CLAIMS;

-- Q02 What are total deductions by category?
-- Expected: Shortage $3,137,709.01; Co-op $1,809,076.66; Missed adjustment $99,027.98;
-- Damage allowance $97,903.60; Vendor services (AVS/SVS) $94,358.58; Operational chargeback $69,890.60;
-- Returns $59,674.51; Unlabeled $9,372.31; Other $8,845.03; Overcharge $481.80. Total $5,386,340.08.
SELECT category, COUNT(*) AS claims, SUM(deducted_amount) AS deducted
FROM STG_DEDUCTION_CLAIMS
GROUP BY category
ORDER BY deducted DESC;

-- Q03 How much did Amazon deduct in Q4 2024, by category?
-- Expected: $945,992.41 total: Shortage $517,085.02, Co-op $315,504.05, Damage allowance $34,857.94,
-- Returns $30,436.07, AVS/SVS $21,594.61, Operational chargeback $15,148.61, Missed adjustment $11,335.51,
-- Unlabeled $30.60.
SELECT category, SUM(deducted_amount) AS deducted
FROM STG_DEDUCTION_CLAIMS
WHERE claim_date BETWEEN '2024-10-01' AND '2024-12-31'
GROUP BY ROLLUP (category)
ORDER BY deducted DESC;

-- Q04 How much did Amazon deduct each year?
-- Expected: 2021 $10,009.50; 2022 $352,337.03; 2023 $1,447,746.46; 2024 $2,933,695.40; 2025 (Jan-Apr) $642,551.69.
SELECT YEAR(claim_date) AS year, SUM(deducted_amount) AS deducted
FROM STG_DEDUCTION_CLAIMS
GROUP BY 1
ORDER BY 1;

-- Q05 How many deduction lines came from Amazon with no description, and how much did they deduct?
-- Expected: 595 remittance lines (461 claims) with no description, $1,818,448.97 deducted.
SELECT
    (SELECT COUNT(*) FROM STG_REMITTANCE_LINES WHERE category = 'Unlabeled' AND is_deduction) AS unlabeled_lines,
    COUNT(*)              AS unlabeled_claims,
    SUM(deducted_amount)  AS deducted
FROM STG_DEDUCTION_CLAIMS
WHERE source_category = 'Unlabeled';

-- Q06 How many of the unlabeled deductions were matched to co-op invoices?
-- Expected: 451 of 461 unlabeled claims matched a co-op invoice on exact amount, $1,809,076.66;
-- the median lag is 2 days after the co-op invoice date. 10 claims ($9,372.31) remain unresolved.
SELECT category_method, COUNT(*) AS claims, SUM(deducted_amount) AS deducted
FROM STG_DEDUCTION_CLAIMS
WHERE source_category = 'Unlabeled'
GROUP BY 1;

SELECT MEDIAN(DATEDIFF('day', c.coop_date, d.claim_date)) AS median_lag_days
FROM STG_DEDUCTION_CLAIMS d
JOIN STG_COOP c ON c.coop_invoice_id = d.coop_invoice_id;

-- Q07 What share of deducted dollars has a category?
-- Expected: 99.8%. Amazon label $3,567,891.11 (66.2%), matched to co-op $1,809,076.66 (33.6%),
-- unresolved $9,372.31 (0.2%, 10 claims).
SELECT category_method, COUNT(*) AS claims, SUM(deducted_amount) AS deducted,
       RATIO_TO_REPORT(SUM(deducted_amount)) OVER () AS share
FROM STG_DEDUCTION_CLAIMS
GROUP BY 1
ORDER BY deducted DESC;

-- Q08 What is the largest deduction we still can't categorize?
-- Expected: an unlabeled claim of $7,093.44 on 2023-08-21 (claim UNL-20230821-7093.44).
SELECT claim_id, claim_date, deducted_amount
FROM STG_DEDUCTION_CLAIMS
WHERE category_method = 'Unresolved'
ORDER BY deducted_amount DESC
LIMIT 1;

-- Q09 How much has Amazon claimed but not yet deducted?
-- Expected: $345,794.80: Damage allowance $177,907.72, AVS/SVS $125,446.66, Co-op $23,530.01,
-- Operational chargeback $15,624.25, Returns $2,668.16, Other $599.94, Missed adjustment $18.06.
SELECT category, SUM(not_yet_applied_amount) AS claimed_not_yet_deducted
FROM STG_DEDUCTION_CLAIMS
GROUP BY ROLLUP (category)
HAVING SUM(not_yet_applied_amount) > 0
ORDER BY claimed_not_yet_deducted DESC;

-- Q10 For damage allowances, how much did Amazon claim versus actually deduct?
-- Expected: claimed $275,811.32, deducted $97,903.60, $177,907.72 still to be deducted.
SELECT SUM(claim_amount) AS claimed, SUM(deducted_amount) AS deducted, SUM(not_yet_applied_amount) AS pending
FROM STG_DEDUCTION_CLAIMS
WHERE category = 'Damage allowance';

-- Q11 How much cash is Amazon holding back in provisions, and are provisions deductions?
-- Expected: about $146,271 is held ($20,527,418.02 held back, $20,381,238.98 released, $91.50 aged
-- receivable provision). Provisions are reserves, not deductions.
SELECT raw_description, COUNT(*) AS lines, SUM(applied_amount) AS applied
FROM STG_REMITTANCE_LINES
WHERE is_provision
GROUP BY ROLLUP (raw_description);

---------------------------------------------------------------------------------------------
-- Shortage recovery and disputes
---------------------------------------------------------------------------------------------

-- Q12 How much did Amazon deduct for shortages?
-- Expected: $3,137,709.01 across 1,470 shortage claims.
SELECT COUNT(*) AS claims, SUM(deducted_amount) AS shortage_deducted
FROM STG_DEDUCTION_CLAIMS
WHERE category = 'Shortage';

-- Q13 What is our shortage recovery rate?
-- Expected: 1.4%: $43,654.41 recovered from disputes vs $3,137,709.01 shortage deducted.
SELECT
    (SELECT SUM(resolved_amount) FROM STG_DISPUTES)                                   AS recovered,
    (SELECT SUM(deducted_amount) FROM STG_DEDUCTION_CLAIMS WHERE category = 'Shortage') AS shortage_deducted,
    recovered / shortage_deducted                                                       AS recovery_rate;

-- Q14 Since dispute tracking began in February 2023, what share of shortage deductions have we recovered?
-- Expected: 1.5%: $43,654.41 recovered vs $2,883,739.48 shortage deducted since 2023-02-01.
SELECT
    (SELECT SUM(resolved_amount) FROM STG_DISPUTES) AS recovered,
    SUM(deducted_amount)                            AS shortage_deducted_since_feb_2023,
    recovered / shortage_deducted_since_feb_2023    AS recovery_rate
FROM STG_DEDUCTION_CLAIMS
WHERE category = 'Shortage' AND claim_date >= '2023-02-01';

-- Q15 Which month had the highest shortage deductions?
-- Expected: November 2024, $237,875.89 across 79 claims (then Oct 2024 $222,966.66, Sep 2024 $215,371.99).
SELECT DATE_TRUNC('month', claim_date) AS month, SUM(deducted_amount) AS shortage_deducted, COUNT(*) AS claims
FROM STG_DEDUCTION_CLAIMS
WHERE category = 'Shortage'
GROUP BY 1
ORDER BY shortage_deducted DESC
LIMIT 3;

-- Q16 How much was deducted for shortages in 2024?
-- Expected: $1,784,005.38.
SELECT SUM(deducted_amount) AS shortage_deducted
FROM STG_DEDUCTION_CLAIMS
WHERE category = 'Shortage' AND YEAR(claim_date) = 2024;

-- Q17 What is the average and largest shortage claim?
-- Expected: average $2,134.50; largest $24,567.00.
SELECT AVG(deducted_amount) AS avg_claim, MAX(deducted_amount) AS largest_claim
FROM STG_DEDUCTION_CLAIMS
WHERE category = 'Shortage';

-- Q18 Which invoice has the most shortage deducted against it?
-- Expected: invoice 039cd4de9e, $61,627.25 across 3 shortage claims.
SELECT base_invoice_number, COUNT(*) AS claims, SUM(deducted_amount) AS shortage_deducted
FROM STG_DEDUCTION_CLAIMS
WHERE category = 'Shortage'
GROUP BY 1
ORDER BY shortage_deducted DESC
LIMIT 1;

-- Q19 What were the outcomes of our shortage disputes?
-- Expected: 839 disputes. By item outcome: Approved 356 ($164,032.10 shortage, $36,746.75 recovered);
-- Partially approved 62 ($87,667.46, $6,907.66 recovered); Denied 278 ($82,399.37, $0);
-- Pending 189 ($74,379.13, $0). Total recovered $43,654.41. The status counts sum to 885, not 839:
-- 39 disputes have items with more than one outcome, so they appear under several statuses.
SELECT dispute_status, COUNT(DISTINCT dispute_id) AS disputes,
       SUM(shortage_amount) AS shortage, SUM(resolved_amount) AS recovered
FROM STG_DISPUTES
GROUP BY 1
ORDER BY shortage DESC;

-- Q20 How much have we disputed in total, and how much did we get back?
-- Expected: 839 disputes for $1,001,340.62 disputed, on items with $408,478.06 shortage; $43,654.41 recovered.
SELECT COUNT(DISTINCT dispute_id) AS disputes, SUM(dispute_amount) AS disputed,
       SUM(shortage_amount) AS shortage, SUM(resolved_amount) AS recovered
FROM STG_DISPUTES;

-- Q21 Which ASIN has the most shortage in disputes?
-- Expected: B393B3648C, $48,818.06 shortage, $10,276.62 recovered ($38,541.44 unrecovered).
SELECT asin, SUM(shortage_amount) AS shortage, SUM(resolved_amount) AS recovered,
       SUM(shortage_amount) - SUM(resolved_amount) AS unrecovered
FROM STG_DISPUTES
GROUP BY 1
ORDER BY shortage DESC
LIMIT 1;

---------------------------------------------------------------------------------------------
-- Co-op
---------------------------------------------------------------------------------------------

-- Q22 How much co-op did Amazon bill us in total?
-- Expected: $2,114,224.87 across 511 co-op invoices.
SELECT COUNT(*) AS coop_invoices, SUM(coop_amount) AS coop_billed
FROM STG_COOP;

-- Q23 How much co-op did Amazon bill us, by agreement?
-- Expected: Other $1,285,565.33; Co-op ACCRUAL $305,439.40; STRAIGHT_PAYMENT $173,546.00;
-- Freight Allowance $153,089.70; Business pricing agreement $82,380.84; Damage Allowance $77,883.29;
-- VPC SNS $23,285.86; VPC $13,034.45.
SELECT agreement_title, SUM(coop_amount) AS coop
FROM STG_COOP
GROUP BY 1
ORDER BY coop DESC;

-- Q24 Which co-op invoices have no matching deduction yet?
-- Expected: 60 co-op invoices, $281,618.20: 22 recent (March-April 2025, $114,703.74) likely still to be
-- deducted, and 38 older ($166,914.46) that need review.
SELECT IFF(c.coop_date >= '2025-03-01', 'Recent (Mar-Apr 2025)', 'Older') AS bucket,
       COUNT(*) AS coop_invoices, SUM(c.coop_amount) AS coop_amount
FROM STG_COOP c
LEFT JOIN STG_COOP_DEDUCTION_MATCH m ON m.coop_invoice_id = c.coop_invoice_id
WHERE m.coop_invoice_id IS NULL
GROUP BY ROLLUP (1);

-- Q25 How much co-op was deducted from payments, by agreement?
-- Expected: $1,809,076.66 total: Other $1,036,256.07; Co-op ACCRUAL $305,439.40; Freight Allowance $153,089.70;
-- STRAIGHT_PAYMENT $123,546.00; Damage Allowance $77,883.29; Business pricing agreement $76,541.89;
-- VPC SNS $23,285.86; VPC $13,034.45.
SELECT coop_agreement_title, COUNT(*) AS claims, SUM(deducted_amount) AS deducted
FROM STG_DEDUCTION_CLAIMS
WHERE category = 'Co-op'
GROUP BY ROLLUP (1)
ORDER BY deducted DESC;

---------------------------------------------------------------------------------------------
-- Cash collection and unpaid aging
---------------------------------------------------------------------------------------------

-- Q26 What is the total invoiced, paid and unpaid amount, and our collection rate?
-- Expected: invoiced $10,294,904.08, paid $10,000,791.94, unpaid $294,112.14; collection rate 97.1%.
SELECT SUM(invoice_amount) AS invoiced, SUM(paid_amount) AS paid, SUM(unpaid_amount) AS unpaid,
       SUM(paid_amount) / SUM(invoice_amount) AS collection_rate
FROM STG_INVOICES;

-- Q27 How much is unpaid by invoice status?
-- Expected: PROCESSING 50 invoices $113,512.82; QUEUED_FOR_PAYMENT 10 invoices $36,365.52;
-- short-pays on PAID invoices $144,233.80. Total $294,112.14.
SELECT invoice_status_group, COUNT(*) AS invoices, SUM(unpaid_amount) AS unpaid
FROM STG_INVOICES
GROUP BY ROLLUP (1)
ORDER BY unpaid DESC;

-- Q28 As of 2025-04-30, how is the unpaid amount aged by days past due?
-- Expected (invoices with unpaid > 0): 1-30 days 54 invoices $163,848.77; 31-60 days 33 invoices
-- $105,415.07; over 60 days 93 invoices $28,205.05. Total $297,468.89 on 180 invoices.
SELECT CASE WHEN DATEDIFF('day', payment_due_date, '2025-04-30'::DATE) <= 0  THEN 'Not yet due'
            WHEN DATEDIFF('day', payment_due_date, '2025-04-30'::DATE) <= 30 THEN '1-30 days'
            WHEN DATEDIFF('day', payment_due_date, '2025-04-30'::DATE) <= 60 THEN '31-60 days'
            ELSE 'Over 60 days' END AS aging_bucket,
       COUNT(*) AS invoices, SUM(unpaid_amount) AS unpaid
FROM STG_INVOICES
WHERE unpaid_amount > 0
GROUP BY ROLLUP (1)
ORDER BY 1;

-- Q29 How much was withheld for price and quantity variances?
-- Expected: price variance $8,051.33 on 208 invoices; quantity variance $70,502.10 on 537 invoices.
SELECT SUM(price_variance) AS price_variance, COUNT_IF(price_variance <> 0) AS price_variance_invoices,
       SUM(quantity_variance) AS quantity_variance, COUNT_IF(quantity_variance <> 0) AS quantity_variance_invoices
FROM STG_INVOICES;
