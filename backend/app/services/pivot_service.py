from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from app.db.duckdb import get_connection
from app.services.dataset_profile import _numeric_expression
from app.services.dataset_storage import get_dataset_storage_info, quote_identifier
from app.services.explorer_profile import _build_where_clause


logger = logging.getLogger(__name__)

AMOUNT_AGGREGATIONS = {"Sum", "Average", "Median", "Min", "Max", "Count", "Distinct Count"}
DISCRETE_AGGREGATIONS = {"Count", "Distinct Count"}
RESULT_LIMIT = 10_000


def execute_pivot(dataset_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    storage_info = get_dataset_storage_info(dataset_id)
    if storage_info is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} was not found.")

    row_fields = _normalise_field_list(payload.get("rows", []))
    value_fields = _normalise_field_list(payload.get("values", []))
    filters = payload.get("filters", [])
    columns = _normalise_field_list(payload.get("columns", []))

    if not value_fields:
        raise HTTPException(status_code=400, detail="At least one value field is required.")
    if not row_fields:
        raise HTTPException(status_code=400, detail="At least one row field is required.")

    _validate_columns(storage_info, [field["name"] for field in row_fields])
    _validate_columns(storage_info, [field["name"] for field in value_fields])
    _validate_columns(storage_info, [field["name"] for field in columns])
    _validate_columns(
        storage_info,
        [str(filter_payload.get("columnName")) for filter_payload in filters if filter_payload.get("columnName")],
    )

    if columns:
        return _execute_column_pivot(dataset_id, storage_info, row_fields, columns, value_fields, filters)

    select_parts = [quote_identifier(field["name"]) for field in row_fields]
    group_by_parts = [quote_identifier(field["name"]) for field in row_fields]
    value_headers: list[str] = []

    for value_field in value_fields:
        aggregation = str(value_field.get("aggregation") or "Count")
        category = str(value_field.get("category") or "")
        column_name = str(value_field["name"])
        _validate_aggregation(category, aggregation, column_name)
        header = _unique_header(f"{column_name} {aggregation}", [field["name"] for field in row_fields] + value_headers)
        value_headers.append(header)
        select_parts.append(f"{_aggregation_expression(column_name, category, aggregation)} AS {quote_identifier(header)}")

    where_sql, parameters = _build_where_clause(storage_info, filters)
    query = _build_query(storage_info, select_parts, group_by_parts, where_sql)

    logger.info(
        "Pivot query generated: dataset_id=%s rows=%s values=%s sql=%s",
        dataset_id,
        [field["name"] for field in row_fields],
        value_headers,
        " ".join(query.split()),
    )

    for connection in get_connection():
        result = connection.execute(query, parameters).fetchall()

    headers = [field["name"] for field in row_fields] + value_headers
    rows = [[_serialise_value(value) for value in row] for row in result]
    warnings = []
    if len(rows) >= RESULT_LIMIT:
        warnings.append(f"Pivot result is limited to the first {RESULT_LIMIT:,} rows.")

    return {
        "datasetId": dataset_id,
        "headers": headers,
        "rows": rows,
        "rowCount": len(rows),
        "warnings": warnings,
        "sql": query,
    }


def _execute_column_pivot(
    dataset_id: str,
    storage_info: dict[str, Any],
    row_fields: list[dict[str, Any]],
    column_fields: list[dict[str, Any]],
    value_fields: list[dict[str, Any]],
    filters: list[dict[str, Any]],
) -> dict[str, Any]:
    column_field_names = [str(field["name"]) for field in column_fields]
    row_field_names = [str(field["name"]) for field in row_fields]
    where_sql, parameters = _build_where_clause(storage_info, filters)
    column_values = _query_distinct_column_values(storage_info, column_field_names, where_sql, parameters)

    value_headers: list[str] = []
    metric_select_parts: list[str] = []
    for value_field in value_fields:
        aggregation = str(value_field.get("aggregation") or "Count")
        category = str(value_field.get("category") or "")
        metric_column = str(value_field["name"])
        _validate_aggregation(category, aggregation, metric_column)
        metric_header = _unique_header(f"{metric_column} {aggregation}", value_headers)
        value_headers.append(metric_header)
        metric_select_parts.append(
            f"{_aggregation_expression(metric_column, category, aggregation)} AS {quote_identifier(metric_header)}"
        )

    select_parts = [
        *[quote_identifier(field_name) for field_name in row_field_names],
        *[quote_identifier(field_name) for field_name in column_field_names],
        *metric_select_parts,
    ]
    group_by_parts = [
        *[quote_identifier(field_name) for field_name in row_field_names],
        *[quote_identifier(field_name) for field_name in column_field_names],
    ]
    query = _build_query(storage_info, select_parts, group_by_parts, where_sql)

    logger.info(
        "Column pivot query generated: dataset_id=%s rows=%s columns=%s values=%s sql=%s",
        dataset_id,
        row_field_names,
        column_field_names,
        value_headers,
        " ".join(query.split()),
    )

    for connection in get_connection():
        result = connection.execute(query, parameters).fetchall()

    headers = _build_column_pivot_headers(row_field_names, column_values, value_headers)
    row_totals = _query_row_totals(storage_info, row_field_names, metric_select_parts, where_sql, parameters)
    column_totals = _query_column_totals(storage_info, column_field_names, metric_select_parts, where_sql, parameters)
    grand_totals = _query_grand_totals(storage_info, metric_select_parts, where_sql, parameters)
    rows = _build_column_pivot_rows(
        result,
        row_field_count=len(row_field_names),
        column_field_count=len(column_field_names),
        column_values=column_values,
        value_headers=value_headers,
        row_totals=row_totals,
    )
    total_row = _build_column_total_row(
        row_field_count=len(row_field_names),
        column_values=column_values,
        value_headers=value_headers,
        column_totals=column_totals,
        grand_totals=grand_totals,
    )
    if total_row:
        rows.append(total_row)
    warnings = []
    if len(rows) >= RESULT_LIMIT:
        warnings.append(f"Pivot result is limited to the first {RESULT_LIMIT:,} rows.")

    return {
        "datasetId": dataset_id,
        "headers": headers,
        "rows": rows,
        "rowCount": len(rows),
        "warnings": warnings,
        "sql": query,
        "pivot": {
            "rowFields": row_field_names,
            "columnFields": column_field_names,
            "columnValues": [[_serialise_value(value) for value in values] for values in column_values],
            "valueFields": value_headers,
        },
    }


def _normalise_field_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    fields = []
    for item in value:
        if isinstance(item, str):
            fields.append({"name": item})
        elif isinstance(item, dict) and item.get("name"):
            fields.append(item)
    return fields


def _validate_columns(storage_info: dict[str, Any], column_names: list[str]) -> None:
    available_columns = {str(column["name"]) for column in storage_info["columns"]}
    missing_columns = [column_name for column_name in column_names if column_name not in available_columns]
    if missing_columns:
        raise HTTPException(status_code=404, detail=f"Columns were not found: {', '.join(missing_columns)}")


def _validate_aggregation(category: str, aggregation: str, column_name: str) -> None:
    if category == "AMOUNT":
        allowed = AMOUNT_AGGREGATIONS
    else:
        allowed = DISCRETE_AGGREGATIONS

    if aggregation not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"{aggregation} is not supported for {column_name}.",
        )


def _aggregation_expression(column_name: str, category: str, aggregation: str) -> str:
    quoted_column = quote_identifier(column_name)
    value_expression = _numeric_expression(column_name) if category == "AMOUNT" else quoted_column

    if aggregation == "Sum":
        return f"SUM({value_expression})"
    if aggregation == "Average":
        return f"AVG({value_expression})"
    if aggregation == "Median":
        return f"MEDIAN({value_expression})"
    if aggregation == "Min":
        return f"MIN({value_expression})"
    if aggregation == "Max":
        return f"MAX({value_expression})"
    if aggregation == "Distinct Count":
        return f"COUNT(DISTINCT {quoted_column})"

    return f"COUNT({quoted_column})"


def _unique_header(base_header: str, existing_headers: list[str]) -> str:
    if base_header not in existing_headers:
        return base_header

    suffix = 2
    while f"{base_header} {suffix}" in existing_headers:
        suffix += 1

    return f"{base_header} {suffix}"


def _build_query(
    storage_info: dict[str, Any],
    select_parts: list[str],
    group_by_parts: list[str],
    where_sql: str,
) -> str:
    group_by_sql = f"GROUP BY {', '.join(group_by_parts)}" if group_by_parts else ""
    order_by_sql = f"ORDER BY {', '.join(group_by_parts)}" if group_by_parts else ""

    return f"""
        SELECT {', '.join(select_parts)}
        FROM {quote_identifier(str(storage_info["tableName"]))}
        {where_sql}
        {group_by_sql}
        {order_by_sql}
        LIMIT {RESULT_LIMIT}
    """


def _query_distinct_column_values(
    storage_info: dict[str, Any],
    column_names: list[str],
    where_sql: str,
    parameters: list[Any],
) -> list[tuple[Any, ...]]:
    quoted_columns = [quote_identifier(column_name) for column_name in column_names]
    selected_columns = ", ".join(quoted_columns)
    null_condition = " AND ".join(f"{quoted_column} IS NOT NULL" for quoted_column in quoted_columns)
    distinct_where_sql = f"{where_sql} AND {null_condition}" if where_sql else f"WHERE {null_condition}"
    for connection in get_connection():
        rows = connection.execute(
            f"""
            SELECT DISTINCT {selected_columns}
            FROM {quote_identifier(str(storage_info["tableName"]))}
            {distinct_where_sql}
            ORDER BY {selected_columns}
            LIMIT ?
            """,
            [*parameters, RESULT_LIMIT],
        ).fetchall()
        return [tuple(row) for row in rows]

    return []


def _build_column_pivot_headers(
    row_field_names: list[str],
    column_values: list[tuple[Any, ...]],
    value_headers: list[str],
) -> list[str]:
    headers = [*row_field_names]
    multiple_values = len(value_headers) > 1

    for column_value in column_values:
        column_label = _column_tuple_label(column_value)
        for value_header in value_headers:
            metric_label = _metric_label(value_header)
            base_header = f"{column_label} {metric_label}" if multiple_values else column_label
            header = _unique_header(base_header, headers)
            headers.append(header)

    for value_header in value_headers:
        metric_label = _metric_label(value_header)
        base_header = _total_header_label(metric_label, multiple_values)
        headers.append(_unique_header(base_header, headers))

    return headers


def _build_column_pivot_rows(
    result: list[tuple[Any, ...]],
    row_field_count: int,
    column_field_count: int,
    column_values: list[tuple[Any, ...]],
    value_headers: list[str],
    row_totals: dict[tuple[Any, ...], list[Any]],
) -> list[list[Any]]:
    row_map: dict[tuple[Any, ...], dict[tuple[Any, ...], list[Any]]] = {}
    row_order: list[tuple[Any, ...]] = []

    for result_row in result:
        row_key = tuple(result_row[:row_field_count])
        column_value = tuple(result_row[row_field_count : row_field_count + column_field_count])
        metric_values = list(result_row[row_field_count + column_field_count :])

        if row_key not in row_map:
            row_map[row_key] = {}
            row_order.append(row_key)
        row_map[row_key][column_value] = metric_values

    rows: list[list[Any]] = []
    for row_key in row_order:
        output_row = [_serialise_value(value) for value in row_key]
        for column_value in column_values:
            metric_values = row_map[row_key].get(column_value)
            if metric_values is None:
                output_row.extend(0 for _ in value_headers)
            else:
                output_row.extend(_serialise_value(value) if value is not None else 0 for value in metric_values)
        output_row.extend(
            _serialise_value(value) if value is not None else 0
            for value in row_totals.get(row_key, [0 for _ in value_headers])
        )
        rows.append(output_row)

    return rows


def _build_column_total_row(
    row_field_count: int,
    column_values: list[tuple[Any, ...]],
    value_headers: list[str],
    column_totals: dict[tuple[Any, ...], list[Any]],
    grand_totals: list[Any],
) -> list[Any] | None:
    if not column_values and not grand_totals:
        return None

    row: list[Any] = [_total_row_label(value_headers)]
    row.extend("" for _ in range(max(0, row_field_count - 1)))
    for column_value in column_values:
        row.extend(
            _serialise_value(value) if value is not None else 0
            for value in column_totals.get(column_value, [0 for _ in value_headers])
        )
    row.extend(_serialise_value(value) if value is not None else 0 for value in grand_totals)
    return row


def _query_row_totals(
    storage_info: dict[str, Any],
    row_field_names: list[str],
    metric_select_parts: list[str],
    where_sql: str,
    parameters: list[Any],
) -> dict[tuple[Any, ...], list[Any]]:
    select_parts = [*[quote_identifier(field_name) for field_name in row_field_names], *metric_select_parts]
    group_by_parts = [quote_identifier(field_name) for field_name in row_field_names]
    query = _build_query(storage_info, select_parts, group_by_parts, where_sql)

    for connection in get_connection():
        rows = connection.execute(query, parameters).fetchall()
        return {
            tuple(row[: len(row_field_names)]): list(row[len(row_field_names) :])
            for row in rows
        }

    return {}


def _query_column_totals(
    storage_info: dict[str, Any],
    column_names: list[str],
    metric_select_parts: list[str],
    where_sql: str,
    parameters: list[Any],
) -> dict[tuple[Any, ...], list[Any]]:
    select_parts = [*[quote_identifier(column_name) for column_name in column_names], *metric_select_parts]
    group_by_parts = [quote_identifier(column_name) for column_name in column_names]
    query = _build_query(storage_info, select_parts, group_by_parts, where_sql)

    for connection in get_connection():
        rows = connection.execute(query, parameters).fetchall()
        return {tuple(row[: len(column_names)]): list(row[len(column_names) :]) for row in rows}

    return {}


def _query_grand_totals(
    storage_info: dict[str, Any],
    metric_select_parts: list[str],
    where_sql: str,
    parameters: list[Any],
) -> list[Any]:
    query = _build_query(storage_info, metric_select_parts, [], where_sql)

    for connection in get_connection():
        row = connection.execute(query, parameters).fetchone()
        return [] if row is None else list(row)

    return []


def _metric_label(value_header: str) -> str:
    for aggregation in sorted(AMOUNT_AGGREGATIONS | DISCRETE_AGGREGATIONS, key=len, reverse=True):
        suffix = f" {aggregation}"
        if value_header.endswith(suffix):
            return aggregation
    return value_header


def _column_tuple_label(column_value: tuple[Any, ...]) -> str:
    return " ".join(str(_serialise_value(value)) for value in column_value)


def _total_header_label(metric_label: str, multiple_values: bool) -> str:
    if metric_label in {"Sum", "Count"}:
        return f"Total {metric_label}" if multiple_values else "Total"
    return f"Grand {metric_label}"


def _total_row_label(value_headers: list[str]) -> str:
    metric_labels = [_metric_label(value_header) for value_header in value_headers]
    if len(metric_labels) == 1:
        return _total_header_label(metric_labels[0], multiple_values=False)
    if all(metric_label in {"Sum", "Count"} for metric_label in metric_labels):
        return "Total"
    return "Grand Total"


def _serialise_value(value: Any) -> str | int | float | bool | None:
    if value is None:
        return None
    if hasattr(value, "item"):
        value = value.item()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, float):
        return round(value, 4)
    return value
