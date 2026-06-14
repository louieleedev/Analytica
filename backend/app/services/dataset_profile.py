from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd
from fastapi import HTTPException

from app.db.duckdb import get_connection
from app.services.dataset_storage import get_dataset_storage_info, quote_identifier
from app.services.import_workflow import _detect_column_type, _normalise_numeric_text


TOP_VALUE_LIMIT = 5
IDENTIFIER_HINTS = (
    "art",
    "beleg",
    "bewegungsart",
    "id",
    "code",
    "kreis",
    "nummer",
    "number",
    "account",
    "center",
    "vendor",
    "customer",
    "project",
    "profit",
    "cost",
)
MEASURE_HINTS = (
    "amount",
    "betrag",
    "taxamount",
    "debitamount",
    "creditamount",
    "balance",
    "quantity",
    "revenue",
)


@dataclass
class ProfileCacheEntry:
    overview: dict[str, Any] | None = None
    columns: dict[str, dict[str, Any]] = field(default_factory=dict)


PROFILE_CACHE: dict[str, ProfileCacheEntry] = {}


def build_dataset_overview(dataset_id: str) -> dict[str, Any]:
    cache = PROFILE_CACHE.setdefault(dataset_id, ProfileCacheEntry())
    if cache.overview is not None:
        return cache.overview

    storage_info = _get_storage_info_or_404(dataset_id)
    row_count = int(storage_info["rowCount"])
    column_catalog = [_build_column_catalog_entry_from_duckdb(storage_info, column) for column in storage_info["columns"]]

    overview = {
        "datasetId": dataset_id,
        "summary": {
            "totalRows": row_count,
            "totalColumns": int(storage_info["columnCount"]),
            "importedFiles": len(storage_info["files"]),
            "datasetSize": int(storage_info["datasetSize"]),
        },
        "columns": column_catalog,
    }
    cache.overview = overview
    return overview


def build_column_profile(dataset_id: str, column_name: str) -> dict[str, Any]:
    cache = PROFILE_CACHE.setdefault(dataset_id, ProfileCacheEntry())
    if column_name in cache.columns:
        return cache.columns[column_name]

    storage_info = _get_storage_info_or_404(dataset_id)
    profile = build_column_profile_from_duckdb(storage_info, column_name)
    cache.columns[column_name] = profile
    return profile


def build_column_profile_from_duckdb(storage_info: dict[str, Any], column_name: str) -> dict[str, Any]:
    column = _find_storage_column(storage_info, column_name)
    data_type = str(column["type"])
    category = _detect_column_category(column_name, data_type)
    row_count, distinct_values, null_count = _query_base_column_stats(storage_info, column_name)
    base_profile = {
        "name": column_name,
        "type": data_type,
        "category": category,
        "explorerCategory": None,
        "rowCount": row_count,
        "distinctValues": distinct_values,
        "nullCount": null_count,
        "topValues": _top_frequencies_duckdb(storage_info, column_name),
    }

    if category == "Measure":
        profile = {**base_profile, **_numeric_profile_duckdb(storage_info, column_name)}
    elif category == "Date":
        profile = {**base_profile, **_date_profile_duckdb(storage_info, column_name)}
    elif category == "Identifier":
        profile = {**base_profile, **_identifier_profile_duckdb(storage_info, column_name)}
    else:
        profile = {
            **base_profile,
            "topFrequencies": _top_frequencies_duckdb(storage_info, column_name),
        }

    return profile


def build_column_profile_for_frame(
    frame: pd.DataFrame,
    column_name: str,
    explorer_category: str | None = None,
) -> dict[str, Any]:
    if column_name not in frame.columns:
        raise HTTPException(status_code=404, detail=f"Column {column_name} was not found.")

    series = frame[column_name]
    data_type = _detect_column_type(series)
    category = _detect_column_category(column_name, data_type)
    base_profile = {
        "name": column_name,
        "type": data_type,
        "category": category,
        "explorerCategory": explorer_category,
        "rowCount": int(series.shape[0]),
        "distinctValues": int(series.nunique(dropna=True)),
        "nullCount": int(series.isna().sum()),
        "topValues": _top_values(series),
    }

    if explorer_category == "TYPE_VARIANT":
        profile = {
            **base_profile,
            "topValues": _top_frequencies(series, limit=20),
            "topFrequencies": _top_frequencies(series, limit=20),
        }
    elif explorer_category == "TIME_PERIOD":
        profile = {**base_profile, **_time_period_profile(series, data_type)}
    elif explorer_category == "AMOUNT":
        profile = {**base_profile, **_numeric_profile(series)}
    elif explorer_category == "IDENTIFIER":
        profile = {**base_profile, **_identifier_profile(series)}
    elif category == "Measure":
        profile = {**base_profile, **_numeric_profile(series)}
    elif category == "Date":
        profile = {**base_profile, **_date_profile(series)}
    elif category == "Identifier":
        profile = {**base_profile, **_identifier_profile(series)}
    else:
        profile = {
            **base_profile,
            "topFrequencies": _top_frequencies(series),
        }

    return profile


def _build_column_catalog_entry(frame: pd.DataFrame, column_name: str) -> dict[str, Any]:
    series = frame[column_name]
    row_count = len(frame.index)
    null_count = int(series.isna().sum())
    populated_percentage = 0 if row_count == 0 else ((row_count - null_count) / row_count) * 100
    data_type = _detect_column_type(series)

    return {
        "name": str(column_name),
        "type": data_type,
        "category": _detect_column_category(column_name, data_type),
        "distinctCount": int(series.nunique(dropna=True)),
        "nullCount": null_count,
        "populatedPercentage": round(populated_percentage, 2),
    }


def _build_column_catalog_entry_from_duckdb(
    storage_info: dict[str, Any],
    column: dict[str, Any],
) -> dict[str, Any]:
    column_name = str(column["name"])
    row_count, distinct_count, null_count = _query_base_column_stats(storage_info, column_name)
    populated_percentage = 0 if row_count == 0 else ((row_count - null_count) / row_count) * 100
    data_type = str(column["type"])

    return {
        "name": column_name,
        "type": data_type,
        "category": _detect_column_category(column_name, data_type),
        "distinctCount": distinct_count,
        "nullCount": null_count,
        "populatedPercentage": round(populated_percentage, 2),
    }


def _get_storage_info_or_404(dataset_id: str) -> dict[str, Any]:
    storage_info = get_dataset_storage_info(dataset_id)
    if storage_info is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} was not found.")
    return storage_info


def _find_storage_column(storage_info: dict[str, Any], column_name: str) -> dict[str, Any]:
    for column in storage_info["columns"]:
        if column["name"] == column_name:
            return column

    raise HTTPException(status_code=404, detail=f"Column {column_name} was not found.")


def _query_base_column_stats(storage_info: dict[str, Any], column_name: str) -> tuple[int, int, int]:
    table_name = quote_identifier(storage_info["tableName"])
    quoted_column = quote_identifier(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            SELECT
                COUNT(*) AS row_count,
                COUNT(DISTINCT {quoted_column}) AS distinct_count,
                COUNT(*) - COUNT({quoted_column}) AS null_count
            FROM {table_name}
            """
        ).fetchone()
        return int(row[0]), int(row[1]), int(row[2])

    return 0, 0, 0


def _top_frequencies_duckdb(
    storage_info: dict[str, Any],
    column_name: str,
    limit: int = TOP_VALUE_LIMIT,
) -> list[dict[str, Any]]:
    table_name = quote_identifier(storage_info["tableName"])
    quoted_column = quote_identifier(column_name)
    total = _non_null_count_duckdb(storage_info, column_name)
    if total == 0:
        return []

    for connection in get_connection():
        rows = connection.execute(
            f"""
            SELECT CAST({quoted_column} AS VARCHAR) AS value, COUNT(*) AS value_count
            FROM {table_name}
            WHERE {quoted_column} IS NOT NULL
            GROUP BY {quoted_column}
            ORDER BY value_count DESC, value ASC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
        return [
            {
                "value": str(value),
                "count": int(count),
                "percentage": round((int(count) / total) * 100, 2),
            }
            for value, count in rows
        ]

    return []


def _non_null_count_duckdb(storage_info: dict[str, Any], column_name: str) -> int:
    table_name = quote_identifier(storage_info["tableName"])
    quoted_column = quote_identifier(column_name)

    for connection in get_connection():
        row = connection.execute(f"SELECT COUNT({quoted_column}) FROM {table_name}").fetchone()
        return int(row[0])

    return 0


def _numeric_profile_duckdb(storage_info: dict[str, Any], column_name: str) -> dict[str, Any]:
    numeric_expression = _numeric_expression(column_name)
    table_name = quote_identifier(storage_info["tableName"])

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH numeric_values AS (
                SELECT {numeric_expression} AS value
                FROM {table_name}
            )
            SELECT
                MIN(value),
                MAX(value),
                AVG(value),
                MEDIAN(value),
                SUM(value),
                STDDEV_SAMP(value)
            FROM numeric_values
            WHERE value IS NOT NULL
            """
        ).fetchone()

    if row is None or row[0] is None:
        return {
            "min": None,
            "max": None,
            "average": None,
            "median": None,
            "sum": None,
            "standardDeviation": None,
            "distribution": [],
        }

    return {
        "min": _serialise_number(row[0]),
        "max": _serialise_number(row[1]),
        "average": _serialise_number(row[2]),
        "median": _serialise_number(row[3]),
        "sum": _serialise_number(row[4]),
        "standardDeviation": _serialise_number(row[5]),
        "distribution": _numeric_distribution_duckdb(storage_info, column_name),
    }


def _numeric_distribution_duckdb(storage_info: dict[str, Any], column_name: str) -> list[dict[str, Any]]:
    numeric_expression = _numeric_expression(column_name)
    table_name = quote_identifier(storage_info["tableName"])

    for connection in get_connection():
        rows = connection.execute(
            f"""
            WITH numeric_values AS (
                SELECT {numeric_expression} AS value
                FROM {table_name}
            ),
            bucketed_values AS (
                SELECT
                    CASE
                        WHEN value < 0 THEN 'Negative'
                        WHEN value >= 0 AND value < 1000 THEN '0 - 1k'
                        WHEN value >= 1000 AND value < 10000 THEN '1k - 10k'
                        WHEN value >= 10000 AND value < 100000 THEN '10k - 100k'
                        WHEN value >= 100000 THEN '100k+'
                    END AS bucket
                FROM numeric_values
                WHERE value IS NOT NULL
            )
            SELECT bucket, COUNT(*) AS bucket_count
            FROM bucketed_values
            GROUP BY bucket
            """
        ).fetchall()

    counts = {str(label): int(count) for label, count in rows if label is not None}
    total = sum(counts.values())
    labels = ["Negative", "0 - 1k", "1k - 10k", "10k - 100k", "100k+"]
    return [
        {
            "label": label,
            "count": counts.get(label, 0),
            "percentage": round((counts.get(label, 0) / total) * 100, 2) if total else 0,
        }
        for label in labels
    ]


def _identifier_profile_duckdb(storage_info: dict[str, Any], column_name: str) -> dict[str, Any]:
    table_name = quote_identifier(storage_info["tableName"])
    quoted_column = quote_identifier(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH value_counts AS (
                SELECT {quoted_column} AS value, COUNT(*) AS value_count
                FROM {table_name}
                WHERE {quoted_column} IS NOT NULL
                GROUP BY {quoted_column}
            )
            SELECT
                COALESCE(SUM(CASE WHEN value_count = 1 THEN 1 ELSE 0 END), 0) AS unique_values,
                COALESCE(SUM(value_count), 0) AS non_null_total
            FROM value_counts
            """
        ).fetchone()

    unique_count = int(row[0] or 0)
    non_null_total = int(row[1] or 0)
    duplicate_count = int(non_null_total - unique_count)
    unique_percentage = 0 if non_null_total == 0 else (unique_count / non_null_total) * 100

    return {
        "uniqueValues": unique_count,
        "duplicateValues": duplicate_count,
        "uniquePercentage": round(unique_percentage, 2),
        "duplicatePercentage": round(max(0, 100 - unique_percentage), 2) if non_null_total else 0,
        "mostFrequentIds": _top_frequencies_duckdb(storage_info, column_name, limit=10),
    }


def _date_profile_duckdb(storage_info: dict[str, Any], column_name: str) -> dict[str, Any]:
    date_expression = _date_expression(column_name)
    table_name = quote_identifier(storage_info["tableName"])

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH date_values AS (
                SELECT {date_expression} AS value
                FROM {table_name}
            )
            SELECT MIN(value), MAX(value)
            FROM date_values
            WHERE value IS NOT NULL
            """
        ).fetchone()

    if row is None or row[0] is None:
        return {
            "earliestDate": None,
            "latestDate": None,
        }

    return {
        "earliestDate": _serialise_datetime(row[0]),
        "latestDate": _serialise_datetime(row[1]),
        "dateRange": f"{row[0].date().isoformat()} - {row[1].date().isoformat()}",
        "mostActiveMonth": _most_active_month_duckdb(storage_info, column_name),
        "mostActiveYear": _most_active_year_duckdb(storage_info, column_name),
        "timelineDistribution": _date_distribution_duckdb(storage_info, column_name),
    }


def _most_active_month_duckdb(storage_info: dict[str, Any], column_name: str) -> str | None:
    date_expression = _date_expression(column_name)
    table_name = quote_identifier(storage_info["tableName"])

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH date_values AS (
                SELECT {date_expression} AS value
                FROM {table_name}
            )
            SELECT strftime(value, '%Y-%m') AS period, COUNT(*) AS period_count
            FROM date_values
            WHERE value IS NOT NULL
            GROUP BY period
            ORDER BY period_count DESC, period ASC
            LIMIT 1
            """
        ).fetchone()
        return None if row is None else str(row[0])

    return None


def _most_active_year_duckdb(storage_info: dict[str, Any], column_name: str) -> str | None:
    date_expression = _date_expression(column_name)
    table_name = quote_identifier(storage_info["tableName"])

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH date_values AS (
                SELECT {date_expression} AS value
                FROM {table_name}
            )
            SELECT CAST(EXTRACT(year FROM value) AS VARCHAR) AS period, COUNT(*) AS period_count
            FROM date_values
            WHERE value IS NOT NULL
            GROUP BY period
            ORDER BY period_count DESC, period ASC
            LIMIT 1
            """
        ).fetchone()
        return None if row is None else str(row[0])

    return None


def _date_distribution_duckdb(storage_info: dict[str, Any], column_name: str) -> list[dict[str, Any]]:
    date_expression = _date_expression(column_name)
    table_name = quote_identifier(storage_info["tableName"])

    for connection in get_connection():
        rows = connection.execute(
            f"""
            WITH date_values AS (
                SELECT {date_expression} AS value
                FROM {table_name}
            ),
            period_counts AS (
                SELECT strftime(value, '%Y-%m') AS period, COUNT(*) AS period_count
                FROM date_values
                WHERE value IS NOT NULL
                GROUP BY period
            ),
            total_count AS (
                SELECT SUM(period_count) AS total FROM period_counts
            )
            SELECT period, period_count, total
            FROM period_counts, total_count
            ORDER BY period DESC
            LIMIT 12
            """
        ).fetchall()

    return [
        {
            "label": str(period),
            "count": int(count),
            "percentage": round((int(count) / int(total)) * 100, 2) if int(total or 0) else 0,
        }
        for period, count, total in reversed(rows)
    ]


def _numeric_expression(column_name: str) -> str:
    quoted_column = quote_identifier(column_name)
    text_value = f"regexp_replace(trim(CAST({quoted_column} AS VARCHAR)), '\\\\s+', '', 'g')"
    return f"""
        CASE
            WHEN {quoted_column} IS NULL THEN NULL
            WHEN strpos({text_value}, ',') > 0
                AND strpos({text_value}, '.') = 0
                THEN try_cast(replace({text_value}, ',', '.') AS DOUBLE)
            WHEN strpos({text_value}, ',') > 0
                AND strpos({text_value}, '.') > 0
                AND strpos(reverse({text_value}), ',') < strpos(reverse({text_value}), '.')
                THEN try_cast(replace(replace({text_value}, '.', ''), ',', '.') AS DOUBLE)
            WHEN strpos({text_value}, ',') > 0
                AND strpos({text_value}, '.') > 0
                THEN try_cast(replace({text_value}, ',', '') AS DOUBLE)
            ELSE try_cast({text_value} AS DOUBLE)
        END
    """


def _date_expression(column_name: str) -> str:
    quoted_column = quote_identifier(column_name)
    text_value = f"trim(CAST({quoted_column} AS VARCHAR))"
    return f"""
        COALESCE(
            try_cast({quoted_column} AS TIMESTAMP),
            try_strptime({text_value}, [
                '%Y-%m-%d',
                '%Y-%m-%d %H:%M:%S',
                '%d.%m.%Y',
                '%d.%m.%Y %H:%M:%S',
                '%d/%m/%Y',
                '%d/%m/%Y %H:%M:%S',
                '%Y/%m/%d',
                '%d-%m-%Y',
                '%Y%m%d'
            ])
        )
    """


def _numeric_profile(series: pd.Series) -> dict[str, Any]:
    numeric_values = pd.to_numeric(series.dropna().astype(str).map(_normalise_numeric_text), errors="coerce").dropna()
    if numeric_values.empty:
        return {
            "min": None,
            "max": None,
            "average": None,
            "sum": None,
            "distribution": [],
        }

    return {
        "min": _serialise_number(numeric_values.min()),
        "max": _serialise_number(numeric_values.max()),
        "average": _serialise_number(numeric_values.mean()),
        "median": _serialise_number(numeric_values.median()),
        "sum": _serialise_number(numeric_values.sum()),
        "standardDeviation": _serialise_number(numeric_values.std()),
        "distribution": _numeric_distribution(numeric_values),
    }


def _identifier_profile(series: pd.Series) -> dict[str, Any]:
    total = int(series.shape[0])
    value_counts = series.dropna().astype(str).value_counts()
    non_null_total = int(value_counts.sum())
    unique_count = int((value_counts == 1).sum())
    duplicate_count = int(non_null_total - unique_count)
    unique_percentage = 0 if non_null_total == 0 else (unique_count / non_null_total) * 100

    return {
        "uniqueValues": unique_count,
        "duplicateValues": duplicate_count,
        "uniquePercentage": round(unique_percentage, 2),
        "duplicatePercentage": round(max(0, 100 - unique_percentage), 2) if total else 0,
        "mostFrequentIds": _top_frequencies(series, limit=10),
    }


def _date_profile(series: pd.Series) -> dict[str, Any]:
    date_values = pd.to_datetime(
        series.dropna().astype(str).str.strip(),
        errors="coerce",
        format="mixed",
        dayfirst=True,
    ).dropna()
    if date_values.empty:
        return {
            "earliestDate": None,
            "latestDate": None,
        }

    return {
        "earliestDate": date_values.min().isoformat(),
        "latestDate": date_values.max().isoformat(),
        "dateRange": f"{date_values.min().date().isoformat()} - {date_values.max().date().isoformat()}",
        "mostActiveMonth": date_values.dt.to_period("M").astype(str).value_counts().idxmax(),
        "mostActiveYear": str(date_values.dt.year.value_counts().idxmax()),
        "timelineDistribution": _date_distribution(date_values),
    }


def _time_period_profile(series: pd.Series, data_type: str) -> dict[str, Any]:
    if data_type == "Date":
        return _date_profile(series)

    year_values = pd.to_numeric(
        series.dropna().astype(str).map(_normalise_numeric_text),
        errors="coerce",
    ).dropna()
    if year_values.empty:
        return {
            "earliestDate": None,
            "latestDate": None,
            "dateRange": None,
            "timelineDistribution": [],
        }

    year_values = year_values.astype(int)
    earliest_year = int(year_values.min())
    latest_year = int(year_values.max())
    return {
        "earliestDate": str(earliest_year),
        "latestDate": str(latest_year),
        "dateRange": f"{earliest_year} - {latest_year}",
        "timelineDistribution": _year_distribution(year_values),
    }


def _top_values(series: pd.Series, limit: int = TOP_VALUE_LIMIT) -> list[dict[str, Any]]:
    return _top_frequencies(series, limit=limit)


def _top_frequencies(series: pd.Series, limit: int = TOP_VALUE_LIMIT) -> list[dict[str, Any]]:
    total = int(series.dropna().shape[0])
    if total == 0:
        return []

    return [
        {
            "value": str(value),
            "count": int(count),
            "percentage": round((int(count) / total) * 100, 2),
        }
        for value, count in series.dropna().astype(str).value_counts().head(limit).items()
    ]


def _numeric_distribution(values: pd.Series) -> list[dict[str, Any]]:
    total = len(values.index)
    buckets = [
        ("Negative", values < 0),
        ("0 - 1k", (values >= 0) & (values < 1_000)),
        ("1k - 10k", (values >= 1_000) & (values < 10_000)),
        ("10k - 100k", (values >= 10_000) & (values < 100_000)),
        ("100k+", values >= 100_000),
    ]

    return [
        {
            "label": label,
            "count": int(mask.sum()),
            "percentage": round((int(mask.sum()) / total) * 100, 2) if total else 0,
        }
        for label, mask in buckets
    ]


def _date_distribution(values: pd.Series) -> list[dict[str, Any]]:
    total = len(values.index)
    month_counts = values.dt.to_period("M").astype(str).value_counts().sort_index().tail(12)
    return [
        {
            "label": str(label),
            "count": int(count),
            "percentage": round((int(count) / total) * 100, 2) if total else 0,
        }
        for label, count in month_counts.items()
    ]


def _year_distribution(values: pd.Series) -> list[dict[str, Any]]:
    total = len(values.index)
    year_counts = values.value_counts().sort_index()
    return [
        {
            "label": str(int(label)),
            "count": int(count),
            "percentage": round((int(count) / total) * 100, 2) if total else 0,
        }
        for label, count in year_counts.items()
    ]


def _detect_column_category(column_name: str, data_type: str) -> str:
    if data_type == "Date":
        return "Date"

    normalized_name = _normalise_name(column_name)
    if data_type in {"Integer", "Decimal"} and any(hint in normalized_name for hint in MEASURE_HINTS):
        return "Measure"

    if any(hint in normalized_name for hint in IDENTIFIER_HINTS):
        return "Identifier"

    if data_type in {"Integer", "Decimal"}:
        return "Measure"

    return "Text"


def _normalise_name(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def _serialise_number(value: Any) -> int | float | None:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float):
        return round(value, 4)
    return value


def _serialise_datetime(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)
