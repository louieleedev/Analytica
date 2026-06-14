# Explorer Concept Specification

Version: 2.0

---

# Purpose

The Explorer page is intended to allow users to inspect, understand, filter and profile arbitrary datasets without requiring technical knowledge about the underlying database.

The page must support:

1. Dataset preview
2. Dynamic filtering
3. Column categorization
4. Column profiling/statistics
5. Persistent column metadata

The design must be generic and work for SAP datasets such as ACDOCA, but also for any future dataset.

---

# Core Principle

A column must first belong to a category before the system knows:

- which filter UI to show
- which profiler UI to show
- how statistics should be calculated

Therefore:

Column Category = Central Metadata

Everything else depends on it.

---

# Column Categories

Every column can belong to exactly one category.

## Category 1: Type / Variant

Purpose:

Columns that contain discrete business values.

Examples:

- Ledger
- Company Code
- Document Type
- Fiscal Year Variant
- Movement Type
- Currency
- Position
- Status
- Country
- Language

Example values:

Ledger

- 0L
- N1
- N2

Document Type

- AA
- ZP
- DS

Currency

- EUR
- USD
- GBP

Position

- 001
- 002
- 003

Characteristics:

- finite value set
- repeated values
- not continuous
- should be grouped

Filter Type:

Dropdown Multi Select

Profiler Type:

Distribution Analysis

---

## Category 2: Time Period

Purpose:

Columns representing time.

Examples:

- Fiscal Year
- Posting Date
- Document Date
- Creation Date
- Change Date

Two subtypes exist.

### Time Period - Year

Example:

- 2022
- 2023
- 2024

Filter:

Year Range

Example:

From Year = 2022

To Year = 2024

---

### Time Period - Date

Example:

22.11.2025

Filter:

Date Range

Example:

From Date = 01.01.2025

To Date = 31.12.2025

Display Format:

DD.MM.YYYY

---

Characteristics

- chronological values
- sortable by time
- continuous timeline

Filter Type:

Time Range Filter

Profiler Type:

Time Distribution Analysis

---

## Category 3: Amount

Purpose:

Numeric values that represent quantities, balances or amounts.

Examples:

- Amount in Company Code Currency
- Amount in Transaction Currency
- Quantity
- Revenue
- Costs

Characteristics:

- continuous numeric values
- aggregatable

Filter Type:

Min Max Range

Profiler Type:

Statistical Analysis

---

## Category 4: Identifier

Purpose:

Columns that uniquely identify business objects.

Unlike Type/Variant columns, identifier columns usually contain a very large number of distinct values.

Because of this, dropdown-based filtering becomes unusable.

Examples:

SAP Examples

BELNR (Document Number)
KUNNR (Customer Number)
LIFNR (Vendor Number)
MATNR (Material Number)
PSPNR (Project Number)
ANLN1 (Asset Number)
KOSTL (Cost Center)
PRCTR (Profit Center)

Generic Examples

Order ID
Customer ID
Product ID
Employee ID
Ticket Number
Transaction Number

Example Values:

Document Number

1900000001
1900000002
1900000003

Customer Number

100000
100001
100002

Characteristics:

extremely high cardinality
often unique
primarily used for lookup
not intended for aggregation
unsuitable for dropdown filters
unsuitable for distribution charts with thousands of values

Filter Type:

Search Filter

Profiler Type:

Identifier Analysis

---

# User Guidance for Category Selection

The system should help users determine the correct category.

TYPE_VARIANT

Question:

Does this column contain a relatively small set of repeating business values?

Examples:

Ledger
Currency
Company Code
Document Type
Fiscal Year Variant
Movement Type

If yes:

TYPE_VARIANT

TIME_PERIOD

Question:

Does this column represent a date, year or timestamp?

Examples:

Posting Date
Document Date
Fiscal Year

If yes:

TIME_PERIOD

AMOUNT

Question:

Does this column represent a measurable quantity or amount?

Examples:

Revenue
Cost
Amount
Quantity

If yes:

AMOUNT

IDENTIFIER

Question:

Does this column identify a business object?

Examples:

Customer Number
Vendor Number
Material Number
Project Number
Asset Number
Document Number

If yes:

IDENTIFIER

---

# Future Enhancement: Category Recommendations

This feature is optional and not required
for the initial implementation.

The system should assist users during categorization.

When a user selects:

TYPE_VARIANT

the system should calculate:

Distinct Value Count

If:

Distinct Value Count > Threshold

then show a recommendation.

Example:

Threshold:

100

Message:

"This column contains 12,532 distinct values. Consider using the IDENTIFIER category instead of TYPE_VARIANT."

The user may still override the recommendation.

Reason:

Some datasets contain special cases.

---

# Column Metadata

Each column has metadata.

```ts
interface ColumnMetadata {
    columnName: string;
    category?: ColumnCategory;
}
```

Possible categories:

```ts
enum ColumnCategory {
    TYPE_VARIANT,
    TIME_PERIOD,
    AMOUNT,
    IDENTIFIER
}
```

---

# Persistent Storage

Column categories must be persisted.

Reason:

Users should define a category only once.

Example:

Ledger → Type Variant

After page reload:

Ledger must still be Type Variant.

The user must not be asked again.

Persistence can be implemented using:

- Local Storage
- Database
- User Settings

Implementation decision is technical.

Requirement:

Category assignment survives page reload.

---

# Dataset Preview

The dataset preview is the central table.

Current state:

Rows and columns are displayed.

New behavior:

Columns may show additional metadata.

---

# Category Tags

A category tag must be displayed above the column.

Example:

[TYPE]
[TIME]
[AMOUNT]
[IDENTIFIER]

Requirements:

- compact
- colored
- visually unobtrusive
- consistent throughout application

Suggested colors:

TYPE

Blue

TIME

Green

AMOUNT

Orange

IDENTIFIER

Purple

---

# Initial State

When a dataset is loaded:

No category is assigned.

Therefore:

No tags are visible.

No filters are created.

Profiler cannot perform category-specific analysis.

---

# Assigning Categories

Categories can be assigned in two ways.

---

## Method 1

Double Click Column Header

User double-clicks:

Ledger

System asks:

Select category

Options:

- Type / Variant
- Time Period
- Amount
- Identifier

After selection:

- category stored
- tag displayed
- filter created

---

## Method 2

Column Profiler Selection

User selects column in profiler dropdown.

If category already exists:

Use existing category.

When a column is selected in the Column Profiler
and no category exists yet,
the category selection dialog must be shown.

After category assignment:

- category is persisted
- category tag is displayed
- profiler is rendered immediately

---

# Changing Category

User can change category at any time.

Possible actions:

Double click tag.

Example:

[TYPE]

→ change to

[TIME]

System behavior:

- old filter removed
- new filter generated
- profiler behavior changes

Changing a category resets all filter values
for that column.

Example:

Ledger
Category = TYPE_VARIANT
Selected Values = [0L, N1]

Change Category → IDENTIFIER

Result:

- previous filter values are discarded
- search filter is initialized empty

---

# Filter System

The filter system is generated dynamically.

Only categorized columns can become filters.

---

# Automatic Filters Panel

Current implementation contains:

Dataset Fields

This section should be removed.

Reason:

It duplicates information already shown inside dataset preview.

Future structure:

Automatic Filters

Only active filter definitions appear here.

---

# Filter Type 1

Dropdown Multi Select

Used by:

Type / Variant

Examples:

Ledger
Company Code
Currency

UI:

Checkbox list

Example:

☐ 0L (213)

☐ N1 (102)

☐ N2 (77)

---

Requirements

Multi selection supported.

Example:

☑ 0L

☑ N1

☐ N2

Result:

Show rows where

Ledger IN (0L, N1)

---

Selected values must remain visible.

Currently:

After selecting a value,
other values disappear.

This is a bug.

Required behavior:

All values remain visible.

Only check state changes.

---

Counts

Each option displays frequency.

Example:

0L (213)

Meaning:

213 rows contain 0L.

---

# Filter Type 2

Time Range Filter

Used by:

Time Period

---

Subtype A

Year

Example:

From Year

2022

To Year

2025

---

Subtype B

Date

Example:

From Date

01.01.2025

To Date

31.12.2025

Display Format:

DD.MM.YYYY

---

# Filter Type 3

Min Max Filter

Used by:

Amount

Example:

Min

100

Max

1000

Result:

100 ≤ Value ≤ 1000

---

# Filter Type 4

Search Filter

Used by:

IDENTIFIER

Purpose:

Fast lookup of business objects.

UI

Search Box

Example:

[ Search Identifier ]

Supported Operators

Equals

Example:

1900000123

Result:

Exact match.

Contains

Example:

1900

Result:

All identifiers containing 1900.

Starts With

Example:

190

Result:

All identifiers starting with 190.

Ends With

Example:

123

Result:

All identifiers ending with 123.

Operator Selection

Suggested UI:

Dropdown

[ Contains ▼ ]

[ Search Value ]

Case Sensitivity

Default:

Case Insensitive

Reason:

More user friendly.

---

# Filter Indicator

If a column is used as a filter:

Display filter icon in column header.

Example:

Ledger 🔍

or

Ledger ⛃

Any icon may be used.

Purpose:

User immediately sees:

This column participates in filtering.

The user must be able to remove an active filter.

After removing the filter:

- filter values are cleared
- filter icon is removed
- category assignment remains unchanged

---

# Column Profiler

The profiler analyzes exactly one column at a time.

A dropdown exists next to:

Column Profiler

User selects a column.

The selected column becomes:

Active Profile Column

---

# Dataset Preview Highlight

When a column is selected in Column Profiler:

The highlight should remain visible as long as
the column is actively selected in the Column Profiler.

Only one column can be profiled at a time.
Therefore only one column may be highlighted.

Example:

Light blue background.

Purpose:

Visual connection between:

- profiler
- dataset preview

Only one column can be actively profiled at a time.

The Column Profiler owns exactly one column.

Changing the selected column transfers ownership
to the newly selected column.

---

# Common Statistics

All categories must display:

Distinct Values

Example:

85

Meaning:

85 unique values

---

Null Count

Example:

12

Meaning:

12 rows contain NULL

---

# Category 1 Profiling

Type / Variant

Purpose:

Distribution analysis

Example:

Ledger

0L

N1

N2

Display:

Horizontal Bar Chart

Example:

0L ████████████ 213 (54%)

N1 ██████ 102 (26%)

N2 ████ 77 (20%)

---

Sorting Options

User selectable.

Options:

Frequency Descending

Frequency Ascending

Alphabetical Ascending

Alphabetical Descending

Natural Sort

Example:

001
002
010

instead of

001
010
002

---

Additional Metrics

Most Frequent Value

Least Frequent Value

Top 10 Values

Top 20 Values

Show All

---

# Category 2 Profiling

Time Period

Purpose:

Timeline analysis

Display:

Earliest Value

Latest Value

Example:

Earliest:

01.01.2020

Latest:

31.12.2025

---

Distribution Visualization

Required.

Possible implementations:

Histogram

or

Density Curve

or

Time Series Frequency Chart

Preferred:

Histogram

Reason:

Simple and understandable.

---

Example

Posting Date

Jan ███

Feb ███████

Mar ███████████

Apr ████

---

Additional Metrics

Number of Years

Number of Months

Most Active Period

Least Active Period

---

# Category 3 Profiling

Amount

Purpose:

Statistical analysis

Required Metrics

Minimum

Maximum

Average

Median

Sum

---

Recommended Additional Metrics

25th Percentile

75th Percentile

Standard Deviation

Variance

Positive Values Count

Negative Values Count

Zero Values Count

---

Distribution Visualization

Histogram

Example:

0-100

100-200

200-300

etc.

Purpose:

Detect skewed distributions.

---

# Category 4 Profiling

Identifier Analysis

Purpose:

Understand uniqueness and identifier quality.

Unlike Type/Variant analysis, identifier analysis does not focus on distributions.

Instead it focuses on uniqueness.

Common Statistics

Distinct Values

Null Count

Additional Statistics

Unique Count

Definition:

Values appearing exactly once.

Example:

1000001

appears once

→ unique

Duplicate Count

Definition:

Values appearing multiple times.

Example:

1000001 appears 5 times

→ duplicate

Uniqueness Ratio

Formula:

Unique Count / Total Rows

Example:

90%

Meaning:

90% of all identifiers occur only once.

Duplicate Ratio

Formula:

Duplicate Count / Total Rows

Most Frequent Identifiers

Show top repeated identifiers.

Example:

1900000001

15 occurrences

1900000002

11 occurrences

1900000003

10 occurrences

Search Inside Profiler

For identifier columns:

A search field should be available inside the profiler.

Purpose:

Quickly inspect specific identifiers.

Example:

Search:

1900001234

Profiler immediately highlights matching statistics.

---

# User Flow Example

Step 1

Dataset loaded.

No categories assigned.

No filters visible.

---

Step 2

User double clicks Ledger.

Assign:

Type Variant

System:

- save category
- show tag
- create dropdown filter

---

Step 3

User selects

0L
N1

Filter applied.

Column header shows filter icon.

---

Step 4

User opens profiler.

Selects Ledger.

Profiler shows:

- Distinct Values
- Null Count
- Distribution
- Top Values

Dataset column highlighted.

---

Step 5

User reloads page.

Category still exists.

Ledger immediately appears:

[TYPE]

Dropdown filter available.

No reconfiguration required.

---

# SAP ACDOCA Mapping Examples

TYPE_VARIANT

- RLDNR
- BLART
- BUKRS
- WAERS

TIME_PERIOD

- GJAHR
- BUDAT
- BLDAT

AMOUNT

- DMBTR
- WRBTR

IDENTIFIER

- BELNR
- KUNNR
- LIFNR
- MATNR

---

# Future Extensions

Possible future categories:

Category 5

Boolean

Examples:

Yes/No

True/False

---

Category 6

Geo Location

Examples:

Country
Region
City

---

Category 7

Free Text

Examples:

Description
Comment
Notes

---

# Out Of Scope

- AI generated insights
- Cross-column correlation analysis
- Data quality scoring
- Automatic category detection

These may be implemented later.

---

# Acceptance Criteria

A column can only belong to one category.

Category assignments survive page reload.

Type/Variant columns use dropdown filters.

Amount columns use min/max filters.

Time columns use time range filters.

Identifier columns use search filters.

Only one column can be profiled at a time.

Only one column can be highlighted at a time.

Removing a filter does not remove the category.

Changing a category resets filter values.

Multi-select remains available after selection.