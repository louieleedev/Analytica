from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from app.db.duckdb import get_connection
from app.services.dataset_profile import _numeric_expression
from app.services.dataset_storage import get_dataset_storage_info, quote_identifier
from app.services.explorer_profile import _build_where_clause
from app.services.pivot_service import _serialise_value


logger = logging.getLogger(__name__)

CHART_POINT_LIMIT = 500
SUPPORTED_CHART_TYPES = {"bar", "pie", "line"}
SUPPORTED_AGGREGATIONS = {"Sum", "Count", "Average", "Min", "Max"}
SUPPORTED_SORTS = {"none", "ascending", "descending"}


def build_chart_result(dataset_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    storage_info = get_dataset_storage_info(dataset_id)
    if storage_info is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} was not found.")

    chart_type = str(payload.get("chartType") or "").lower()
    category_field = str(payload.get("categoryField") or "")
    series_field = str(payload.get("seriesField") or "")
    value_field = str(payload.get("valueField") or "")
    aggregation = str(payload.get("aggregation") or "Count")
    sort_order = str(payload.get("sortOrder") or "none").lower()
    top_n = _normalise_top_n(payload.get("topN"))
    chart_title = str(payload.get("chartTitle") or "").strip()
    filters = payload.get("filters", [])
    use_series = bool(series_field) and chart_type in {"bar", "line"}

    if chart_type not in SUPPORTED_CHART_TYPES:
        raise HTTPException(status_code=400, detail="Chart type must be bar, pie or line.")
    if aggregation not in SUPPORTED_AGGREGATIONS:
        raise HTTPException(status_code=400, detail=f"{aggregation} is not supported.")
    if sort_order not in SUPPORTED_SORTS:
        raise HTTPException(status_code=400, detail="Sort order must be none, ascending or descending.")
    if not category_field:
        raise HTTPException(status_code=400, detail="Category field is required.")
    if aggregation != "Count" and not value_field:
        raise HTTPException(status_code=400, detail="Value field is required.")

    _validate_columns(storage_info, [category_field])
    if use_series:
        _validate_columns(storage_info, [series_field])
    if value_field:
        _validate_columns(storage_info, [value_field])
    _validate_columns(
        storage_info,
        [str(filter_payload.get("columnName")) for filter_payload in filters if filter_payload.get("columnName")],
    )

    where_sql, parameters = _build_where_clause(storage_info, filters)
    category_sql = quote_identifier(category_field)
    series_sql = quote_identifier(series_field) if use_series else ""
    value_sql = _aggregation_expression(value_field, aggregation)
    table_sql = quote_identifier(str(storage_info["tableName"]))
    metric_alias = f"{value_field or 'Rows'} {aggregation}"

    if use_series:
        return _build_series_chart_result(
            dataset_id=dataset_id,
            chart_type=chart_type,
            category_field=category_field,
            series_field=series_field,
            value_field=value_field,
            aggregation=aggregation,
            sort_order=sort_order,
            top_n=top_n,
            chart_title=chart_title,
            metric_alias=metric_alias,
            table_sql=table_sql,
            category_sql=category_sql,
            series_sql=series_sql,
            value_sql=value_sql,
            where_sql=where_sql,
            parameters=parameters,
        )

    order_sql = _single_series_order_sql(sort_order)
    query = f"""
        SELECT
            {category_sql} AS category,
            {value_sql} AS value
        FROM {table_sql}
        {where_sql}
        GROUP BY {category_sql}
        {order_sql}
        LIMIT ?
    """
    result_limit = top_n or CHART_POINT_LIMIT

    logger.info(
        "Chart query generated: dataset_id=%s chart_type=%s category=%s value=%s aggregation=%s sort=%s top_n=%s sql=%s",
        dataset_id,
        chart_type,
        category_field,
        value_field,
        aggregation,
        sort_order,
        top_n,
        " ".join(query.split()),
    )

    for connection in get_connection():
        rows = connection.execute(query, [*parameters, result_limit]).fetchall()

    points = [
        {
            "category": _category_label(category),
            "value": float(value or 0),
        }
        for category, value in rows
    ]

    return {
        "datasetId": dataset_id,
        "chartType": chart_type,
        "categoryField": category_field,
        "seriesField": None,
        "valueField": value_field,
        "aggregation": aggregation,
        "sortOrder": sort_order,
        "topN": top_n,
        "title": chart_title or _chart_title(value_field, aggregation, category_field, None),
        "metricLabel": metric_alias,
        "points": points,
        "pointCount": len(points),
        "limit": result_limit,
        "sql": query,
    }


def _build_series_chart_result(
    *,
    dataset_id: str,
    chart_type: str,
    category_field: str,
    series_field: str,
    value_field: str,
    aggregation: str,
    sort_order: str,
    top_n: int | None,
    chart_title: str,
    metric_alias: str,
    table_sql: str,
    category_sql: str,
    series_sql: str,
    value_sql: str,
    where_sql: str,
    parameters: list[Any],
) -> dict[str, Any]:
    category_limit = top_n or CHART_POINT_LIMIT
    category_order_sql = _series_category_order_sql(sort_order)
    final_order_sql = _series_final_order_sql(sort_order)
    query = f"""
        WITH grouped AS (
            SELECT
                {category_sql} AS category,
                {series_sql} AS series,
                {value_sql} AS value
            FROM {table_sql}
            {where_sql}
            GROUP BY {category_sql}, {series_sql}
        ),
        category_totals AS (
            SELECT category, SUM(value) AS category_total
            FROM grouped
            GROUP BY category
            {category_order_sql}
            LIMIT ?
        )
        SELECT grouped.category, grouped.series, grouped.value
        FROM grouped
        INNER JOIN category_totals
            ON grouped.category IS NOT DISTINCT FROM category_totals.category
        {final_order_sql}
        LIMIT ?
    """

    logger.info(
        "Series chart query generated: dataset_id=%s chart_type=%s category=%s series=%s value=%s aggregation=%s sort=%s top_n=%s sql=%s",
        dataset_id,
        chart_type,
        category_field,
        series_field,
        value_field,
        aggregation,
        sort_order,
        top_n,
        " ".join(query.split()),
    )

    for connection in get_connection():
        rows = connection.execute(query, [*parameters, category_limit, CHART_POINT_LIMIT]).fetchall()

    categories: list[str] = []
    series_names: list[str] = []
    series_map: dict[str, dict[str, float]] = {}

    for category, series, value in rows:
        category_label = _category_label(category)
        series_label = _category_label(series)
        if category_label not in categories:
            categories.append(category_label)
        if series_label not in series_names:
            series_names.append(series_label)
        series_map.setdefault(series_label, {})[category_label] = float(value or 0)

    series_payload = [
        {
            "name": series_name,
            "points": [
                {
                    "category": category,
                    "value": series_map.get(series_name, {}).get(category, 0),
                }
                for category in categories
            ],
        }
        for series_name in series_names
    ]

    return {
        "datasetId": dataset_id,
        "chartType": chart_type,
        "categoryField": category_field,
        "seriesField": series_field,
        "valueField": value_field,
        "aggregation": aggregation,
        "sortOrder": sort_order,
        "topN": top_n,
        "title": chart_title or _chart_title(value_field, aggregation, category_field, series_field),
        "metricLabel": metric_alias,
        "points": [],
        "series": series_payload,
        "categories": categories,
        "seriesNames": series_names,
        "pointCount": len(rows),
        "limit": category_limit,
        "sql": query,
    }


def _normalise_top_n(value: Any) -> int | None:
    if value in (None, "", "all", "All"):
        return None
    try:
        top_n = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Top N must be a positive number.")
    if top_n < 1:
        raise HTTPException(status_code=400, detail="Top N must be a positive number.")
    return min(top_n, CHART_POINT_LIMIT)


def _single_series_order_sql(sort_order: str) -> str:
    if sort_order == "ascending":
        return "ORDER BY value ASC NULLS LAST, category"
    if sort_order == "descending":
        return "ORDER BY value DESC NULLS LAST, category"
    return "ORDER BY category"


def _series_category_order_sql(sort_order: str) -> str:
    if sort_order == "ascending":
        return "ORDER BY category_total ASC NULLS LAST, category"
    if sort_order == "descending":
        return "ORDER BY category_total DESC NULLS LAST, category"
    return "ORDER BY category"


def _series_final_order_sql(sort_order: str) -> str:
    if sort_order == "ascending":
        return "ORDER BY category_totals.category_total ASC NULLS LAST, grouped.category, grouped.series"
    if sort_order == "descending":
        return "ORDER BY category_totals.category_total DESC NULLS LAST, grouped.category, grouped.series"
    return "ORDER BY grouped.category, grouped.series"


def _chart_title(value_field: str, aggregation: str, category_field: str, series_field: str | None) -> str:
    metric = f"{value_field} {aggregation}" if value_field else f"Rows {aggregation}"
    title = f"{metric} by {category_field}"
    if series_field:
        title = f"{title} and {series_field}"
    return title


def _validate_columns(storage_info: dict[str, Any], column_names: list[str]) -> None:
    available_columns = {str(column["name"]) for column in storage_info["columns"]}
    missing_columns = [column_name for column_name in column_names if column_name not in available_columns]
    if missing_columns:
        raise HTTPException(status_code=404, detail=f"Columns were not found: {', '.join(missing_columns)}")


def _aggregation_expression(value_field: str, aggregation: str) -> str:
    if aggregation == "Count":
        return "COUNT(*)"

    value_expression = _numeric_expression(value_field)
    if aggregation == "Sum":
        return f"SUM({value_expression})"
    if aggregation == "Average":
        return f"AVG({value_expression})"
    if aggregation == "Min":
        return f"MIN({value_expression})"
    if aggregation == "Max":
        return f"MAX({value_expression})"

    raise HTTPException(status_code=400, detail=f"{aggregation} is not supported.")


def _category_label(value: Any) -> str:
    serialised = _serialise_value(value)
    if serialised is None or serialised == "":
        return "(Blank)"
    return str(serialised)
