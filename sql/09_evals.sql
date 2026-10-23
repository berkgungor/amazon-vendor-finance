-- 09_evals.sql: evaluation dataset for the Amazon Vendor Finance agent (Agent Evaluations).
-- One row per question: INPUT_QUERY and EXPECTED_OUTPUT = {"ground_truth_output": "..."}.
-- Expected answers come from evals/ground_truth.sql (direct SQL over STAGING.STG_* views);
-- regenerate both together. Questions are read-only: none should make the agent create or update anything.
-- Safe to re-run (replaces the table).

USE WAREHOUSE AMZ_FIN_WH;
USE SCHEMA AMAZON_FINANCE_APP.OPS;

CREATE OR REPLACE TABLE EVAL_QUESTIONS (
    INPUT_QUERY     VARCHAR COMMENT 'Question sent to the agent',
    EXPECTED_OUTPUT VARIANT COMMENT '{"ground_truth_output": expected answer from direct SQL}'
) COMMENT = 'Agent evaluation set: questions and expected answers (see evals/ground_truth.sql)';

INSERT INTO EVAL_QUESTIONS (INPUT_QUERY, EXPECTED_OUTPUT)
SELECT q, OBJECT_CONSTRUCT('ground_truth_output', a)
FROM VALUES
-- Deductions and categories
('What is the total amount Amazon deducted, excluding provisions?',
 'Amazon deducted $5,386,340.08 in total across 4,309 deduction claims, excluding provisions.'),
('What are total deductions by category?',
 'Total deducted is $5,386,340.08: Shortage $3,137,709.01; Co-op $1,809,076.66; Missed adjustment $99,027.98; Damage allowance $97,903.60; Vendor services (AVS/SVS) $94,358.58; Operational chargeback $69,890.60; Returns $59,674.51; Unlabeled $9,372.31; Other $8,845.03; Overcharge $481.80.'),
('How much did Amazon deduct in Q4 2024, by category?',
 'Amazon deducted $945,992.41 in Q4 2024: Shortage $517,085.02, Co-op $315,504.05, Damage allowance $34,857.94, Returns $30,436.07, Vendor services (AVS/SVS) $21,594.61, Operational chargeback $15,148.61, Missed adjustment $11,335.51, Unlabeled $30.60.'),
('How much did Amazon deduct each year?',
 'Deductions by year: 2021 $10,009.50; 2022 $352,337.03; 2023 $1,447,746.46; 2024 $2,933,695.40; 2025 (January-April) $642,551.69.'),
('How many deduction lines came from Amazon with no description, and how much did they deduct?',
 '595 remittance lines (461 claims) had no description from Amazon, deducting $1,818,448.97.'),
('How many of the unlabeled deductions were matched to co-op invoices?',
 '451 of the 461 unlabeled deduction claims matched a co-op invoice on exact amount, $1,809,076.66, typically 2 days after the co-op invoice date. 10 claims ($9,372.31) remain unresolved.'),
('What share of deducted dollars has a category?',
 '99.8% of deducted dollars have a category: $3,567,891.11 (66.2%) by Amazon label and $1,809,076.66 (33.6%) matched to co-op invoices. Only 10 claims, $9,372.31 (0.2%), are unresolved.'),
('What is the largest deduction we still cannot categorize?',
 'The largest unresolved deduction is an unlabeled claim of $7,093.44 on 2023-08-21.'),
('How much has Amazon claimed but not yet deducted?',
 'Amazon has claimed $345,794.80 not yet deducted: Damage allowance $177,907.72, Vendor services (AVS/SVS) $125,446.66, Co-op $23,530.01, Operational chargeback $15,624.25, Returns $2,668.16, Other $599.94 and Missed adjustment $18.06.'),
('For damage allowances, how much did Amazon claim versus actually deduct?',
 'Amazon claimed $275,811.32 in damage allowances and deducted $97,903.60, leaving $177,907.72 still to be deducted.'),
('How much cash is Amazon holding back in provisions, and are provisions deductions?',
 'About $146,271 is currently held in provisions: $20,527,418.02 held back and $20,381,238.98 released. Provisions are reserves, not deductions, and are not counted in deduction totals.'),
-- Shortage recovery and disputes
('How much did Amazon deduct for shortages?',
 'Amazon deducted $3,137,709.01 for shortages across 1,470 shortage claims.'),
('What is our shortage recovery rate?',
 'The shortage recovery rate is 1.4%: $43,654.41 recovered from disputes versus $3,137,709.01 of shortages deducted.'),
('Since dispute tracking began in February 2023, what share of shortage deductions have we recovered?',
 'Since 2023-02-01 Amazon deducted $2,883,739.48 for shortages and $43,654.41 was recovered, a recovery rate of 1.5%.'),
('Which month had the highest shortage deductions?',
 'November 2024 had the highest shortage deductions: $237,875.89 across 79 claims (followed by October 2024 at $222,966.66).'),
('How much was deducted for shortages in 2024?',
 'Amazon deducted $1,784,005.38 for shortages in 2024.'),
('What is the average and largest shortage claim?',
 'The average shortage claim is $2,134.50 and the largest is $24,567.00.'),
('Which invoice has the most shortage deducted against it?',
 'Invoice 039cd4de9e has the most shortage deducted: $61,627.25 across 3 shortage claims.'),
('What were the outcomes of our shortage disputes?',
 '839 disputes in total. By item outcome: Approved 356 disputes, $164,032.10 shortage, $36,746.75 recovered. Partially approved 62, $87,667.46 shortage, $6,907.66 recovered. Denied 278, $82,399.37 shortage, nothing recovered. Pending 189, $74,379.13 shortage. The status counts sum to more than 839 because 39 disputes have items with more than one outcome. Total recovered $43,654.41.'),
('How much have we disputed in total, and how much did we get back?',
 'We raised 839 disputes for $1,001,340.62 disputed (items with $408,478.06 of shortage) and recovered $43,654.41.'),
('Which ASIN has the most shortage in disputes?',
 'ASIN B393B3648C has the most shortage in disputes: $48,818.06, of which $10,276.62 was recovered ($38,541.44 unrecovered).'),
-- Co-op
('How much co-op did Amazon bill us in total?',
 'Amazon billed $2,114,224.87 in co-op across 511 co-op invoices.'),
('How much co-op did Amazon bill us, by agreement?',
 'Co-op by agreement: Other $1,285,565.33; Co-op ACCRUAL $305,439.40; STRAIGHT_PAYMENT $173,546.00; Freight Allowance $153,089.70; Business pricing agreement $82,380.84; Damage Allowance $77,883.29; VPC SNS $23,285.86; VPC $13,034.45. Total $2,114,224.87.'),
('Which co-op invoices have no matching deduction yet?',
 '60 co-op invoices worth $281,618.20 have no matching deduction: 22 recent ones from March-April 2025 ($114,703.74) are probably still to be deducted, and 38 older ones ($166,914.46) need review.'),
('How much co-op was deducted from payments, by agreement?',
 'Co-op deducted from payments totals $1,809,076.66: Other $1,036,256.07; Co-op ACCRUAL $305,439.40; Freight Allowance $153,089.70; STRAIGHT_PAYMENT $123,546.00; Damage Allowance $77,883.29; Business pricing agreement $76,541.89; VPC SNS $23,285.86; VPC $13,034.45.'),
-- Cash collection and unpaid aging
('What is the total invoiced, paid and unpaid amount, and our collection rate?',
 'Invoiced $10,294,904.08, paid $10,000,791.94, unpaid $294,112.14, a collection rate of 97.1%.'),
('How much is unpaid by invoice status?',
 'Unpaid by status: short-pays on PAID invoices $144,233.80; PROCESSING 50 invoices $113,512.82; QUEUED_FOR_PAYMENT 10 invoices $36,365.52. Total unpaid $294,112.14.'),
('As of 2025-04-30, how is the unpaid amount aged by days past due?',
 'As of 2025-04-30, invoices with an unpaid balance: 1-30 days past due 54 invoices $163,848.77; 31-60 days 33 invoices $105,415.07; over 60 days 93 invoices $28,205.05. Total $297,468.89 on 180 invoices.'),
('How much was withheld for price and quantity variances?',
 'Price variance $8,051.33 on 208 invoices and quantity variance $70,502.10 on 537 invoices.')
AS t(q, a);

SELECT COUNT(*) AS eval_questions FROM EVAL_QUESTIONS;
