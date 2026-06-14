# Pivot Concept

## Purpose

The Pivot module allows users to aggregate, summarize, and analyze large datasets without writing SQL.

While the Explorer focuses on individual records and filtering, the Pivot module focuses on grouped and aggregated results.

Examples:

* Total amount by Company Code
* Revenue by Fiscal Year
* Count of documents by Document Type
* Amount by Ledger and Fiscal Year
* Average amount by Cost Center

All calculations must be executed in DuckDB.

No aggregation logic should be performed in Angular.

---

# Design Principles

## Reuse Existing Categories

The Pivot module must reuse the same column categories already defined in Explorer.

Categories are persistent and shared across the application.

A column categorized in Explorer must automatically use the same category in Pivot.

No second categorization process should exist.

---

# Categories

## Type / Variant

Examples:

* Ledger
* CompanyCode
* Currency
* DocumentType
* MovementType
* FiscalYearVariant
* Position

Purpose:

Represents business classifications and variants.

---

## Time Period

Examples:

* FiscalYear
* PostingDate
* DocumentDate
* PeriodYear

Purpose:

Represents points in time or time ranges.

---

## Amount

Examples:

* Amount
* Revenue
* Quantity
* TaxAmount
* LocalAmount

Purpose:

Represents measurable numeric values.

---

## Identifier

Examples:

* DocumentNumber
* CustomerId
* VendorId
* MaterialNumber

Purpose:

Represents identifiers.

Usually not suitable for mathematical aggregation.

---

# Pivot Areas

The Pivot Builder contains four configurable areas:

## Filters

Limits the analyzed dataset.

Examples:

* FiscalYear = 2025
* Ledger IN (0L, N1)
* CompanyCode = 1000

Multiple filters must be supported simultaneously.

---

## Rows

Defines row grouping.

Examples:

Rows:

* Ledger

Result:

| Ledger |
| ------ |
| 0L     |
| N1     |
| N2     |

Rows support multiple fields.

Example:

Rows:

* Ledger
* CompanyCode

Result:

| Ledger | CompanyCode |
| ------ | ----------- |
| 0L     | 1000        |
| 0L     | 2000        |
| N1     | 1000        |

The order of row fields is important.

Drag and drop must allow reordering.

---

## Columns

Defines column grouping.

Example:

Columns:

* FiscalYear

Result:

| Ledger | 2024 | 2025 |
| ------ | ---- | ---- |

Columns support multiple fields.

Example:

Columns:

* FiscalYear
* Currency

Result:

| Ledger | 2024 EUR | 2024 USD | 2025 EUR |

The order of column fields is important.

Drag and drop must allow reordering.

---

## Values

Defines calculated measures.

Values support multiple entries.

Example:

Values:

* Amount Sum
* Amount Average
* Amount Max

Result:

| Ledger | Sum | Average | Max |
| ------ | --- | ------- | --- |

---

# Allowed Locations per Category

| Category       | Filters | Rows | Columns | Values  |
| -------------- | ------- | ---- | ------- | ------- |
| Type / Variant | Yes     | Yes  | Yes     | Limited |
| Time Period    | Yes     | Yes  | Yes     | Limited |
| Amount         | Yes     | No   | No      | Yes     |
| Identifier     | Yes     | Yes  | Yes     | Limited |

---

# Supported Aggregations

## Amount

Allowed:

* Sum
* Average
* Median
* Min
* Max
* Count
* Distinct Count

---

## Type / Variant

Allowed:

* Count
* Distinct Count

Examples:

Count of records by Ledger.

Distinct count of currencies.

---

## Time Period

Allowed:

* Count
* Distinct Count

Examples:

Count of posting dates.

Distinct count of fiscal years.

---

## Identifier

Allowed:

* Count
* Distinct Count

Examples:

Count of document numbers.

Distinct count of customer IDs.

---

# Multiple Values

Multiple value fields must be supported.

Example:

Values:

* Amount Sum
* Amount Average
* Amount Max

Result:

| Ledger | Sum | Average | Max |
| ------ | --- | ------- | --- |

---

# Filters

Filters should use the same category-specific behavior already implemented in Explorer.

## Type / Variant

Multi-select dropdown.

Examples:

* Ledger
* CompanyCode
* Currency

---

## Time Period

Date range filter.

Year range filter.

Examples:

2024 → 2025

01.01.2025 → 31.12.2025

---

## Amount

Min / Max filter.

Example:

Amount:

1000 → 5000

---

## Identifier

Search filter.

Examples:

Contains

Starts With

Equals

---

# Invalid Configurations

The system should prevent obviously invalid configurations.

Examples:

Amount field in Rows.

Amount field in Columns.

Time Period Average.

Document Number Sum.

Users should receive a clear validation message.

---

# Empty Result Handling

If filters produce no matching records:

Display:

"No records match the selected pivot configuration."

Do not display errors.

---

# Large Cardinality Protection

Some fields may contain hundreds of thousands of unique values.

Examples:

* DocumentNumber
* MaterialNumber

Using these fields in Columns may generate unusable pivot results.

The system should detect excessive distinct counts and display a warning.

Example:

"This field contains more than 10,000 distinct values and may generate a very large pivot result."

---

# Templates

Users can save pivot templates.

A template stores:

* Filters
* Rows
* Columns
* Values
* Aggregations

Templates do not store dataset contents.

Templates are reusable across sessions.

---

# DuckDB Architecture

Pivot calculations must execute entirely in DuckDB.

Angular should never aggregate records.

Example:

SELECT
Ledger,
FiscalYear,
SUM(Amount) AS AmountSum
FROM dataset
WHERE FiscalYear = 2025
GROUP BY Ledger, FiscalYear

The backend returns aggregated results to Angular.

---

# Performance Goals

The Pivot module must support datasets with millions of records.

Requirements:

* No Pandas aggregations
* No client-side aggregations
* No full dataset transfers to Angular
* Aggregation executed directly in DuckDB
* Query results only transferred to the frontend

---

# Future Enhancements

Not part of the initial implementation.

Possible future features:

* Calculated Fields
* Custom Formulas
* Running Totals
* Percentage of Total
* Subtotals
* Grand Totals
* Drill Down
* Drill Through
* Export to Excel
* Export to CSV
* Export to PDF
* Chart Generation from Pivot Results
