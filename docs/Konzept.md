# Analytica

## Project Vision

Analytica is a local analytics platform for extremely large structured datasets.

The application is designed to analyze datasets containing millions or even hundreds of millions of rows.

Typical datasets include:

* SAP exports (e.g. ACDOCA)
* ERP reports
* Financial datasets
* Audit datasets
* CSV exports
* Excel exports

The application is NOT SAP-specific.

It should work with any structured tabular dataset.

---

# Core Principles

1. Local-first application

The application runs entirely on the user's machine.

No cloud deployment.

No SaaS architecture.

No external database server.

---

2. Analytics-first

The purpose is data analysis.

The purpose is NOT data storage or administration.

Users should spend their time analyzing data, not managing infrastructure.

---

3. Large-scale datasets

The application must be designed for datasets with:

* millions of rows
* tens of millions of rows
* hundreds of millions of rows

The UI must never attempt to display all rows.

---

4. Simple UX

The primary users are:

* SAP Consultants
* Auditors
* Controllers
* Financial Analysts
* Business Users

The UI should remain simple and intuitive.

---

# Technical Architecture

Frontend

* Angular
* TypeScript
* Angular Material

Backend

* Python
* FastAPI

Database

* DuckDB

Data Processing

* Pandas
* OpenPyXL

---

# Navigation Structure

Projects

Current Project

* Overview
* Datasets
* Explorer
* Pivot
* Visuals
* Reports
* Settings

The project-specific navigation should appear visually nested under the selected project.

---

# Projects Page

Purpose:

Manage analytics projects.

Functions:

* Create Project
* Open Project
* Delete Project
* Rename Project

Project States:

* Healthy
* Warning
* Error

No Draft status.

No Archived status.

---

# Overview Page

Purpose:

Understand the structure of the loaded dataset.

Display:

* Total Rows
* Total Columns
* Imported Files
* Dataset Size

Column Catalog:

* Column Name
* Data Type
* Distinct Count
* Null Count

Selecting a column should show:

* Top Values
* Frequency Distribution
* Min / Max Value

---

# Datasets Page

Purpose:

Manage imported files.

Functions:

* Upload CSV
* Upload XLSX
* Upload Folder
* Delete Dataset
* Replace Dataset

All uploaded files must share the same schema.

Files are merged into one logical dataset.

---

# Explorer Page

This is the most important page in the application.

Purpose:

Perform interactive data analysis.

Display:

- Total rows in dataset
- Rows after filtering

---

## Automatic Filters

Filters are generated from detected column types.

Numeric columns:

* Min Value
* Max Value
* Range Slider

Text columns:

* Searchable Multi Select Dropdown

---

## Dataset Preview

Never display all rows.

Display:

* First 100 rows
* Pagination

---

## Column Analysis

Display:

* Distinct Values
* Null Count
* Top Values
* Value Distribution

---

# Pivot Page

Purpose:

Excel-like Pivot Analysis.

Sections:

* Filters
* Rows
* Columns
* Values

Aggregations:

* Count
* Sum
* Average
* Min
* Max
* Distinct Count

All calculations must be executed by DuckDB.

---

# Visuals Page

Purpose:

Visual representation of analysis results.

Supported charts:

* Bar Chart
* Pie Chart
* Line Chart

Keep the UI simple.

No advanced BI chart types initially.

---

# Reports Page

Purpose:

Export analysis results.

Supported outputs:

* CSV
* Excel
* PDF

Report sections may contain:

* Tables
* Pivot Results
* Charts
* Active Filters

---

# Settings Page

Purpose:

Minimal configuration.

Supported settings:

* Import Path
* DuckDB Location
* Preview Row Limit
* Theme

Do not expose database administration features.

---

# UI Design Reference

The folder docs/UI contains Stitch-generated reference screens.

These screenshots should be used as design inspiration.

They are not strict requirements.

Maintain the visual style and layout principles where possible.

---

# Important Restrictions

No authentication.

No user management.

No cloud deployment.

No team collaboration.

No enterprise administration dashboards.

No database administration console.

Focus on analytics and usability.

No sample dashboards.

No demo analytics.

No mock SAP KPIs.

The application should remain dataset-agnostic.

All analysis must be driven by imported datasets.