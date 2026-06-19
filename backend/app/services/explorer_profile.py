from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from app.db.duckdb import get_connection
from app.services.dataset_profile import (
    _date_expression,
    _detect_column_category,
    _numeric_expression,
    _serialise_datetime,
    _serialise_number,
    build_column_profile,
    build_dataset_overview,
)
from app.services.dataset_storage import get_dataset_storage_info, quote_identifier
from app.services.import_workflow import PREVIEW_ROW_LIMIT, _normalise_numeric_text


logger = logging.getLogger(__name__)


@dataclass
class ExplorerDatasetCacheEntry:
    dataset: dict[str, Any]


EXPLORER_DATASET_CACHE: dict[str, ExplorerDatasetCacheEntry] = {}
FILTER_VALUE_LIMIT = 250
TOP_VALUE_LIMIT = 5


def invalidate_explorer_dataset_cache(dataset_id: str) -> None:
    EXPLORER_DATASET_CACHE.pop(dataset_id, None)


def build_explorer_dataset(dataset_id: str) -> dict[str, Any]:
    cached = EXPLORER_DATASET_CACHE.get(dataset_id)
    if cached is not None:
        logger.info(
            "Explorer dataset cache hit: dataset_id=%s column_count=%s columns=%s",
            dataset_id,
            len(cached.dataset["columns"]),
            [column["name"] for column in cached.dataset["columns"]],
        )
        return cached.dataset

    storage_info = _get_storage_info_or_404(dataset_id)
    overview = build_dataset_overview(dataset_id)
    preview_columns = _column_names(storage_info)
    preview = _query_preview(storage_info, "", [])

    dataset = {
        "datasetId": dataset_id,
        "summary": {
            "totalRows": int(storage_info["rowCount"]),
            "rowsAfterFiltering": int(storage_info["rowCount"]),
            "previewLimit": PREVIEW_ROW_LIMIT,
        },
        "columns": overview["columns"],
        "preview": {
            "columns": preview_columns,
            "rows": preview,
        },
    }
    EXPLORER_DATASET_CACHE[dataset_id] = ExplorerDatasetCacheEntry(dataset=dataset)
    logger.info(
        "Explorer dataset built from DuckDB: dataset_id=%s row_count=%s column_count=%s columns=%s",
        dataset_id,
        dataset["summary"]["totalRows"],
        len(dataset["columns"]),
        [column["name"] for column in dataset["columns"]],
    )
    return dataset


def build_explorer_column_profile(dataset_id: str, column_name: str) -> dict[str, Any]:
    logger.info("Explorer column profile requested: dataset_id=%s column_name=%s", dataset_id, column_name)
    return build_column_profile(dataset_id, column_name)


def build_explorer_filter_result(dataset_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    storage_info = _get_storage_info_or_404(dataset_id)
    selected_columns = [str(column) for column in payload.get("selectedColumns", [])]
    selected_categories = {
        str(column_name): str(category)
        for column_name, category in payload.get("selectedCategories", {}).items()
    }
    filters = payload.get("filters", [])
    profile_column_name = payload.get("profileColumnName")
    profile_category = payload.get("profileCategory")

    _validate_columns(storage_info, selected_columns)
    if profile_column_name:
        _validate_columns(storage_info, [str(profile_column_name)])
    for filter_payload in filters:
        _validate_filter_payload(storage_info, filter_payload)

    where_sql, parameters = _build_where_clause(storage_info, filters)
    filtered_row_count = _query_row_count(storage_info, where_sql, parameters)
    filter_metadata = [
        _build_filter_metadata(storage_info, column_name, selected_categories.get(column_name))
        for column_name in selected_columns
    ]

    logger.info(
        "Explorer filters applied with DuckDB: dataset_id=%s selected_columns=%s filter_count=%s row_count=%s",
        dataset_id,
        selected_columns,
        len(filters),
        filtered_row_count,
    )

    result: dict[str, Any] = {
        "datasetId": dataset_id,
        "summary": {
            "totalRows": int(storage_info["rowCount"]),
            "rowsAfterFiltering": filtered_row_count,
            "previewLimit": PREVIEW_ROW_LIMIT,
        },
        "filterMetadata": filter_metadata,
        "preview": {
            "columns": _column_names(storage_info),
            "rows": _query_preview(storage_info, where_sql, parameters),
        },
    }
    if profile_column_name:
        result["columnProfile"] = _build_column_profile_for_filtered_query(
            storage_info,
            str(profile_column_name),
            where_sql,
            parameters,
            str(profile_category) if profile_category else None,
        )

    return result


def _get_storage_info_or_404(dataset_id: str) -> dict[str, Any]:
    storage_info = get_dataset_storage_info(dataset_id)
    if storage_info is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} was not found.")
    return storage_info


def _column_names(storage_info: dict[str, Any]) -> list[str]:
    return [str(column["name"]) for column in storage_info["columns"]]


def _column_type(storage_info: dict[str, Any], column_name: str) -> str:
    for column in storage_info["columns"]:
        if column["name"] == column_name:
            return str(column["type"])

    raise HTTPException(status_code=404, detail=f"Column {column_name} was not found.")


def _validate_columns(storage_info: dict[str, Any], column_names: list[str]) -> None:
    available_columns = set(_column_names(storage_info))
    missing_columns = [column_name for column_name in column_names if column_name not in available_columns]
    if missing_columns:
        raise HTTPException(status_code=404, detail=f"Columns were not found: {', '.join(missing_columns)}")


def _validate_filter_payload(storage_info: dict[str, Any], filter_payload: dict[str, Any]) -> None:
    column_name = str(filter_payload.get("columnName", ""))
    _validate_columns(storage_info, [column_name])


def _table_sql(storage_info: dict[str, Any]) -> str:
    return quote_identifier(str(storage_info["tableName"]))


def _build_where_clause(
    storage_info: dict[str, Any],
    filters: list[dict[str, Any]],
) -> tuple[str, list[Any]]:
    conditions: list[str] = []
    parameters: list[Any] = []

    for filter_payload in filters:
        condition, condition_parameters = _build_filter_condition(storage_info, filter_payload)
        if condition:
            conditions.append(condition)
            parameters.extend(condition_parameters)

    if not conditions:
        return "", []

    return f"WHERE {' AND '.join(f'({condition})' for condition in conditions)}", parameters


def _build_filter_condition(
    storage_info: dict[str, Any],
    filter_payload: dict[str, Any],
) -> tuple[str, list[Any]]:
    column_name = str(filter_payload["columnName"])
    category = str(filter_payload.get("category", ""))
    filter_type = str(filter_payload.get("type", ""))

    if category == "TYPE_VARIANT":
        return _text_values_condition(column_name, filter_payload.get("values", []))

    if category == "AMOUNT":
        return _numeric_range_condition(column_name, filter_payload.get("min"), filter_payload.get("max"))

    if category == "TIME_PERIOD":
        data_type = _column_type(storage_info, column_name)
        if data_type == "Date":
            return _date_range_condition(
                column_name,
                filter_payload.get("from"),
                filter_payload.get("to"),
                filter_payload.get("fromYear"),
                filter_payload.get("toYear"),
            )
        return _numeric_range_condition(column_name, filter_payload.get("fromYear"), filter_payload.get("toYear"))

    if category == "IDENTIFIER":
        return _identifier_condition(column_name, filter_payload)

    if filter_type in {"Text", "Boolean"}:
        return _text_values_condition(column_name, filter_payload.get("values", []))

    if filter_type in {"Integer", "Decimal"}:
        return _numeric_range_condition(column_name, filter_payload.get("min"), filter_payload.get("max"))

    if filter_type == "Date":
        return _date_range_condition(column_name, filter_payload.get("from"), filter_payload.get("to"), None, None)

    return "", []


def _text_values_condition(column_name: str, raw_values: Any) -> tuple[str, list[Any]]:
    values = [str(value) for value in raw_values if value is not None]
    if not values:
        return "", []

    quoted_column = quote_identifier(column_name)
    placeholders = ", ".join("?" for _ in values)
    return f"CAST({quoted_column} AS VARCHAR) IN ({placeholders})", values


def _numeric_range_condition(column_name: str, raw_minimum: Any, raw_maximum: Any) -> tuple[str, list[Any]]:
    minimum = _to_number(raw_minimum)
    maximum = _to_number(raw_maximum)
    if minimum is None and maximum is None:
        return "", []

    expression = _numeric_expression(column_name)
    conditions: list[str] = []
    parameters: list[Any] = []
    if minimum is not None:
        conditions.append(f"{expression} >= ?")
        parameters.append(minimum)
    if maximum is not None:
        conditions.append(f"{expression} <= ?")
        parameters.append(maximum)

    return " AND ".join(conditions), parameters


def _date_range_condition(
    column_name: str,
    raw_from: Any,
    raw_to: Any,
    raw_from_year: Any,
    raw_to_year: Any,
) -> tuple[str, list[Any]]:
    expression = _date_expression(column_name)
    conditions: list[str] = []
    parameters: list[Any] = []

    from_date = _to_text(raw_from)
    to_date = _to_text(raw_to)
    from_year = _to_number(raw_from_year)
    to_year = _to_number(raw_to_year)

    if from_date:
        conditions.append(f"{expression} >= CAST(? AS TIMESTAMP)")
        parameters.append(from_date)
    if to_date:
        conditions.append(f"{expression} <= CAST(? AS TIMESTAMP)")
        parameters.append(to_date)
    if from_year is not None:
        conditions.append(f"EXTRACT(year FROM {expression}) >= ?")
        parameters.append(int(from_year))
    if to_year is not None:
        conditions.append(f"EXTRACT(year FROM {expression}) <= ?")
        parameters.append(int(to_year))

    return " AND ".join(conditions), parameters


def _identifier_condition(column_name: str, filter_payload: dict[str, Any]) -> tuple[str, list[Any]]:
    search_value = str(filter_payload.get("value", "")).strip().lower()
    if not search_value:
        return "", []

    quoted_column = quote_identifier(column_name)
    expression = f"lower(COALESCE(CAST({quoted_column} AS VARCHAR), ''))"
    operator = str(filter_payload.get("operator", "Contains"))
    if operator == "Equals":
        return f"{expression} = ?", [search_value]
    if operator == "Starts With":
        return f"{expression} LIKE ?", [f"{search_value}%"]
    if operator == "Ends With":
        return f"{expression} LIKE ?", [f"%{search_value}"]
    return f"{expression} LIKE ?", [f"%{search_value}%"]


def _query_row_count(storage_info: dict[str, Any], where_sql: str, parameters: list[Any]) -> int:
    for connection in get_connection():
        row = connection.execute(
            f"SELECT COUNT(*) FROM {_table_sql(storage_info)} {where_sql}",
            parameters,
        ).fetchone()
        return int(row[0])

    return 0


def _query_preview(storage_info: dict[str, Any], where_sql: str, parameters: list[Any]) -> list[dict[str, Any]]:
    column_names = _column_names(storage_info)
    selected_columns = ", ".join(quote_identifier(column_name) for column_name in column_names)

    for connection in get_connection():
        rows = connection.execute(
            f"""
            SELECT {selected_columns}
            FROM {_table_sql(storage_info)}
            {where_sql}
            LIMIT ?
            """,
            [*parameters, PREVIEW_ROW_LIMIT],
        ).fetchall()

    return [
        {
            column_name: _serialise_query_value(value)
            for column_name, value in zip(column_names, row, strict=True)
        }
        for row in rows
    ]


def _build_filter_metadata(
    storage_info: dict[str, Any],
    column_name: str,
    category: str | None = None,
) -> dict[str, Any]:
    data_type = _column_type(storage_info, column_name)
    metadata: dict[str, Any] = {
        "columnName": column_name,
        "type": data_type,
    }

    if category == "TYPE_VARIANT":
        metadata["values"] = _top_values_for_source(storage_info, column_name, _table_sql(storage_info), [], FILTER_VALUE_LIMIT)
    elif data_type in {"Integer", "Decimal"}:
        minimum, maximum = _numeric_min_max_for_source(storage_info, column_name, _table_sql(storage_info), [])
        metadata["min"] = minimum
        metadata["max"] = maximum
    elif data_type == "Date":
        earliest, latest = _date_min_max_for_source(storage_info, column_name, _table_sql(storage_info), [])
        metadata["from"] = _date_only(earliest)
        metadata["to"] = _date_only(latest)
    else:
        metadata["values"] = _top_values_for_source(storage_info, column_name, _table_sql(storage_info), [], FILTER_VALUE_LIMIT)

    return metadata


def _build_column_profile_for_filtered_query(
    storage_info: dict[str, Any],
    column_name: str,
    where_sql: str,
    parameters: list[Any],
    explorer_category: str | None = None,
) -> dict[str, Any]:
    data_type = _column_type(storage_info, column_name)
    category = _detect_column_category(column_name, data_type)
    source_sql = f"(SELECT * FROM {_table_sql(storage_info)} {where_sql})"
    row_count, distinct_values, null_count = _query_base_column_stats_for_source(
        storage_info,
        column_name,
        source_sql,
        parameters,
    )
    base_profile = {
        "name": column_name,
        "type": data_type,
        "category": category,
        "explorerCategory": explorer_category,
        "rowCount": row_count,
        "distinctValues": distinct_values,
        "nullCount": null_count,
        "topValues": _top_values_for_source(storage_info, column_name, source_sql, parameters),
    }

    if explorer_category == "TYPE_VARIANT":
        top_values = _top_values_for_source(storage_info, column_name, source_sql, parameters, limit=20)
        return {
            **base_profile,
            "topValues": top_values,
            "topFrequencies": top_values,
        }
    if explorer_category == "TIME_PERIOD":
        return {**base_profile, **_time_period_profile_for_source(storage_info, column_name, source_sql, parameters)}
    if explorer_category == "AMOUNT":
        return {**base_profile, **_numeric_profile_for_source(storage_info, column_name, source_sql, parameters)}
    if explorer_category == "IDENTIFIER":
        return {**base_profile, **_identifier_profile_for_source(storage_info, column_name, source_sql, parameters)}
    if category == "Measure":
        return {**base_profile, **_numeric_profile_for_source(storage_info, column_name, source_sql, parameters)}
    if category == "Date":
        return {**base_profile, **_date_profile_for_source(storage_info, column_name, source_sql, parameters)}
    if category == "Identifier":
        return {**base_profile, **_identifier_profile_for_source(storage_info, column_name, source_sql, parameters)}

    return {
        **base_profile,
        "topFrequencies": _top_values_for_source(storage_info, column_name, source_sql, parameters),
    }


def _query_base_column_stats_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> tuple[int, int, int]:
    quoted_column = quote_identifier(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            SELECT
                COUNT(*) AS row_count,
                COUNT(DISTINCT {quoted_column}) AS distinct_count,
                COUNT(*) - COUNT({quoted_column}) AS null_count
            FROM {source_sql} AS source_dataset
            """,
            parameters,
        ).fetchone()
        return int(row[0]), int(row[1]), int(row[2])

    return 0, 0, 0


def _top_values_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
    limit: int = TOP_VALUE_LIMIT,
) -> list[dict[str, Any]]:
    quoted_column = quote_identifier(column_name)
    total = _non_null_count_for_source(storage_info, column_name, source_sql, parameters)
    if total == 0:
        return []

    for connection in get_connection():
        rows = connection.execute(
            f"""
            SELECT CAST({quoted_column} AS VARCHAR) AS value, COUNT(*) AS value_count
            FROM {source_sql} AS source_dataset
            WHERE {quoted_column} IS NOT NULL
            GROUP BY {quoted_column}
            ORDER BY value_count DESC, value ASC
            LIMIT ?
            """,
            [*parameters, limit],
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


def _non_null_count_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> int:
    quoted_column = quote_identifier(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"SELECT COUNT({quoted_column}) FROM {source_sql} AS source_dataset",
            parameters,
        ).fetchone()
        return int(row[0])

    return 0


def _numeric_profile_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> dict[str, Any]:
    numeric_expression = _numeric_expression(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH numeric_values AS (
                SELECT {numeric_expression} AS value
                FROM {source_sql} AS source_dataset
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
            """,
            parameters,
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
        "distribution": _numeric_distribution_for_source(storage_info, column_name, source_sql, parameters),
    }


def _numeric_min_max_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> tuple[int | float | None, int | float | None]:
    numeric_expression = _numeric_expression(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH numeric_values AS (
                SELECT {numeric_expression} AS value
                FROM {source_sql} AS source_dataset
            )
            SELECT MIN(value), MAX(value)
            FROM numeric_values
            WHERE value IS NOT NULL
            """,
            parameters,
        ).fetchone()
        if row is None or row[0] is None:
            return None, None
        return _serialise_number(row[0]), _serialise_number(row[1])

    return None, None


def _numeric_distribution_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> list[dict[str, Any]]:
    numeric_expression = _numeric_expression(column_name)

    for connection in get_connection():
        rows = connection.execute(
            f"""
            WITH numeric_values AS (
                SELECT {numeric_expression} AS value
                FROM {source_sql} AS source_dataset
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
            """,
            parameters,
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


def _identifier_profile_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> dict[str, Any]:
    quoted_column = quote_identifier(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH value_counts AS (
                SELECT {quoted_column} AS value, COUNT(*) AS value_count
                FROM {source_sql} AS source_dataset
                WHERE {quoted_column} IS NOT NULL
                GROUP BY {quoted_column}
            )
            SELECT
                COALESCE(SUM(CASE WHEN value_count = 1 THEN 1 ELSE 0 END), 0) AS unique_values,
                COALESCE(SUM(value_count), 0) AS non_null_total
            FROM value_counts
            """,
            parameters,
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
        "mostFrequentIds": _top_values_for_source(storage_info, column_name, source_sql, parameters, limit=10),
    }


def _time_period_profile_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> dict[str, Any]:
    if _column_type(storage_info, column_name) == "Date":
        return _date_profile_for_source(storage_info, column_name, source_sql, parameters)
    return _year_profile_for_source(storage_info, column_name, source_sql, parameters)


def _date_profile_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> dict[str, Any]:
    earliest, latest = _date_min_max_for_source(storage_info, column_name, source_sql, parameters)
    if earliest is None:
        return {
            "earliestDate": None,
            "latestDate": None,
        }

    return {
        "earliestDate": _serialise_datetime(earliest),
        "latestDate": _serialise_datetime(latest),
        "dateRange": f"{earliest.date().isoformat()} - {latest.date().isoformat()}",
        "mostActiveMonth": _most_active_month_for_source(storage_info, column_name, source_sql, parameters),
        "mostActiveYear": _most_active_year_for_source(storage_info, column_name, source_sql, parameters),
        "timelineDistribution": _date_distribution_for_source(storage_info, column_name, source_sql, parameters),
    }


def _date_min_max_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> tuple[Any | None, Any | None]:
    date_expression = _date_expression(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH date_values AS (
                SELECT {date_expression} AS value
                FROM {source_sql} AS source_dataset
            )
            SELECT MIN(value), MAX(value)
            FROM date_values
            WHERE value IS NOT NULL
            """,
            parameters,
        ).fetchone()
        if row is None or row[0] is None:
            return None, None
        return row[0], row[1]

    return None, None


def _year_profile_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> dict[str, Any]:
    minimum, maximum = _numeric_min_max_for_source(storage_info, column_name, source_sql, parameters)
    if minimum is None:
        return {
            "earliestDate": None,
            "latestDate": None,
            "dateRange": None,
            "timelineDistribution": [],
        }

    earliest_year = int(minimum)
    latest_year = int(maximum)
    return {
        "earliestDate": str(earliest_year),
        "latestDate": str(latest_year),
        "dateRange": f"{earliest_year} - {latest_year}",
        "timelineDistribution": _year_distribution_for_source(storage_info, column_name, source_sql, parameters),
    }


def _most_active_month_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> str | None:
    date_expression = _date_expression(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH date_values AS (
                SELECT {date_expression} AS value
                FROM {source_sql} AS source_dataset
            )
            SELECT strftime(value, '%Y-%m') AS period, COUNT(*) AS period_count
            FROM date_values
            WHERE value IS NOT NULL
            GROUP BY period
            ORDER BY period_count DESC, period ASC
            LIMIT 1
            """,
            parameters,
        ).fetchone()
        return None if row is None else str(row[0])

    return None


def _most_active_year_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> str | None:
    date_expression = _date_expression(column_name)

    for connection in get_connection():
        row = connection.execute(
            f"""
            WITH date_values AS (
                SELECT {date_expression} AS value
                FROM {source_sql} AS source_dataset
            )
            SELECT CAST(EXTRACT(year FROM value) AS VARCHAR) AS period, COUNT(*) AS period_count
            FROM date_values
            WHERE value IS NOT NULL
            GROUP BY period
            ORDER BY period_count DESC, period ASC
            LIMIT 1
            """,
            parameters,
        ).fetchone()
        return None if row is None else str(row[0])

    return None


def _date_distribution_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> list[dict[str, Any]]:
    date_expression = _date_expression(column_name)

    for connection in get_connection():
        rows = connection.execute(
            f"""
            WITH date_values AS (
                SELECT {date_expression} AS value
                FROM {source_sql} AS source_dataset
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
            """,
            parameters,
        ).fetchall()

    return [
        {
            "label": str(period),
            "count": int(count),
            "percentage": round((int(count) / int(total)) * 100, 2) if int(total or 0) else 0,
        }
        for period, count, total in reversed(rows)
    ]


def _year_distribution_for_source(
    storage_info: dict[str, Any],
    column_name: str,
    source_sql: str,
    parameters: list[Any],
) -> list[dict[str, Any]]:
    numeric_expression = _numeric_expression(column_name)

    for connection in get_connection():
        rows = connection.execute(
            f"""
            WITH year_values AS (
                SELECT CAST({numeric_expression} AS BIGINT) AS value
                FROM {source_sql} AS source_dataset
            ),
            year_counts AS (
                SELECT value, COUNT(*) AS year_count
                FROM year_values
                WHERE value IS NOT NULL
                GROUP BY value
            ),
            total_count AS (
                SELECT SUM(year_count) AS total FROM year_counts
            )
            SELECT value, year_count, total
            FROM year_counts, total_count
            ORDER BY value
            """,
            parameters,
        ).fetchall()

    return [
        {
            "label": str(int(year)),
            "count": int(count),
            "percentage": round((int(count) / int(total)) * 100, 2) if int(total or 0) else 0,
        }
        for year, count, total in rows
    ]


def _to_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(_normalise_numeric_text(str(value)))
    except ValueError:
        return None


def _to_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _date_only(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "date"):
        return value.date().isoformat()
    return str(value)


def _serialise_query_value(value: Any) -> str | int | float | bool | None:
    if value is None:
        return None
    if hasattr(value, "item"):
        value = value.item()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
