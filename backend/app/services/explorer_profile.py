from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import pandas as pd
from fastapi import HTTPException

from app.services.dataset_profile import (
    build_column_profile,
    build_column_profile_for_frame,
    build_dataset_overview,
)
from app.services.import_workflow import (
    PREVIEW_ROW_LIMIT,
    _detect_column_type,
    _normalise_numeric_text,
    _serialise_preview,
    get_stored_dataset,
)


logger = logging.getLogger(__name__)


@dataclass
class ExplorerDatasetCacheEntry:
    dataset: dict[str, Any]


EXPLORER_DATASET_CACHE: dict[str, ExplorerDatasetCacheEntry] = {}
FILTER_VALUE_LIMIT = 250


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

    stored_dataset = get_stored_dataset(dataset_id)
    frame = stored_dataset.frame
    overview = build_dataset_overview(dataset_id)
    preview_columns = [str(column) for column in frame.columns]

    dataset = {
        "datasetId": dataset_id,
        "summary": {
            "totalRows": int(len(frame.index)),
            "rowsAfterFiltering": int(len(frame.index)),
            "previewLimit": PREVIEW_ROW_LIMIT,
        },
        "columns": overview["columns"],
        "preview": {
            "columns": preview_columns,
            "rows": _serialise_preview(frame.head(PREVIEW_ROW_LIMIT)),
        },
    }
    EXPLORER_DATASET_CACHE[dataset_id] = ExplorerDatasetCacheEntry(dataset=dataset)
    logger.info(
        "Explorer dataset built: dataset_id=%s row_count=%s column_count=%s columns=%s",
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
    stored_dataset = get_stored_dataset(dataset_id)
    frame = stored_dataset.frame
    selected_columns = [str(column) for column in payload.get("selectedColumns", [])]
    selected_categories = {
        str(column_name): str(category)
        for column_name, category in payload.get("selectedCategories", {}).items()
    }
    filters = payload.get("filters", [])
    profile_column_name = payload.get("profileColumnName")
    profile_category = payload.get("profileCategory")

    _validate_columns(frame, selected_columns)
    if profile_column_name:
        _validate_columns(frame, [str(profile_column_name)])
    for filter_payload in filters:
        _validate_filter_payload(frame, filter_payload)

    filtered_frame = _apply_filters(frame, filters)
    filter_metadata = [
        _build_filter_metadata(filtered_frame, frame, column_name, selected_categories.get(column_name))
        for column_name in selected_columns
    ]

    logger.info(
        "Explorer filters applied: dataset_id=%s selected_columns=%s filter_count=%s row_count=%s",
        dataset_id,
        selected_columns,
        len(filters),
        len(filtered_frame.index),
    )

    result = {
        "datasetId": dataset_id,
        "summary": {
            "totalRows": int(len(frame.index)),
            "rowsAfterFiltering": int(len(filtered_frame.index)),
            "previewLimit": PREVIEW_ROW_LIMIT,
        },
        "filterMetadata": filter_metadata,
        "preview": {
            "columns": [str(column) for column in frame.columns],
            "rows": _serialise_preview(filtered_frame.head(PREVIEW_ROW_LIMIT)),
        },
    }
    if profile_column_name:
        result["columnProfile"] = build_column_profile_for_frame(
            filtered_frame,
            str(profile_column_name),
            str(profile_category) if profile_category else None,
        )

    return result


def _validate_columns(frame: pd.DataFrame, column_names: list[str]) -> None:
    missing_columns = [column_name for column_name in column_names if column_name not in frame.columns]
    if missing_columns:
        raise HTTPException(status_code=404, detail=f"Columns were not found: {', '.join(missing_columns)}")


def _validate_filter_payload(frame: pd.DataFrame, filter_payload: dict[str, Any]) -> None:
    column_name = str(filter_payload.get("columnName", ""))
    if column_name not in frame.columns:
        raise HTTPException(status_code=404, detail=f"Column {column_name} was not found.")


def _apply_filters(frame: pd.DataFrame, filters: list[dict[str, Any]]) -> pd.DataFrame:
    filtered_frame = frame
    for filter_payload in filters:
        column_name = str(filter_payload["columnName"])
        category = str(filter_payload.get("category", ""))
        filter_type = str(filter_payload.get("type", ""))

        if category:
            filtered_frame = _apply_category_filter(filtered_frame, column_name, category, filter_payload)
        elif filter_type in {"Text", "Boolean"}:
            values = [str(value) for value in filter_payload.get("values", []) if value is not None]
            if values:
                filtered_frame = filtered_frame[filtered_frame[column_name].astype(str).isin(values)]
        elif filter_type in {"Integer", "Decimal"}:
            numeric_values = pd.to_numeric(
                filtered_frame[column_name].astype(str).map(_normalise_numeric_text),
                errors="coerce",
            )
            minimum = _to_number(filter_payload.get("min"))
            maximum = _to_number(filter_payload.get("max"))
            mask = pd.Series(True, index=filtered_frame.index)
            if minimum is not None:
                mask &= numeric_values >= minimum
            if maximum is not None:
                mask &= numeric_values <= maximum
            filtered_frame = filtered_frame[mask]
        elif filter_type == "Date":
            date_values = pd.to_datetime(
                filtered_frame[column_name].astype(str).str.strip(),
                errors="coerce",
                format="mixed",
                dayfirst=True,
            )
            from_date = _to_date(filter_payload.get("from"))
            to_date = _to_date(filter_payload.get("to"))
            mask = pd.Series(True, index=filtered_frame.index)
            if from_date is not None:
                mask &= date_values >= from_date
            if to_date is not None:
                mask &= date_values <= to_date
            filtered_frame = filtered_frame[mask]

    return filtered_frame


def _apply_category_filter(
    frame: pd.DataFrame,
    column_name: str,
    category: str,
    filter_payload: dict[str, Any],
) -> pd.DataFrame:
    if category == "TYPE_VARIANT":
        values = [str(value) for value in filter_payload.get("values", []) if value is not None]
        if not values:
            return frame
        return frame[frame[column_name].astype(str).isin(values)]

    if category == "AMOUNT":
        numeric_values = _numeric_series(frame[column_name])
        minimum = _to_number(filter_payload.get("min"))
        maximum = _to_number(filter_payload.get("max"))
        mask = pd.Series(True, index=frame.index)
        if minimum is not None:
            mask &= numeric_values >= minimum
        if maximum is not None:
            mask &= numeric_values <= maximum
        return frame[mask]

    if category == "TIME_PERIOD":
        data_type = _detect_column_type(frame[column_name])
        if data_type == "Date":
            date_values = _date_series(frame[column_name])
            from_date = _to_date(filter_payload.get("from"))
            to_date = _to_date(filter_payload.get("to"))
            from_year = _to_number(filter_payload.get("fromYear"))
            to_year = _to_number(filter_payload.get("toYear"))
            mask = pd.Series(True, index=frame.index)
            if from_date is not None:
                mask &= date_values >= from_date
            if to_date is not None:
                mask &= date_values <= to_date
            if from_year is not None:
                mask &= date_values.dt.year >= int(from_year)
            if to_year is not None:
                mask &= date_values.dt.year <= int(to_year)
            return frame[mask]

        numeric_values = _numeric_series(frame[column_name])
        from_year = _to_number(filter_payload.get("fromYear"))
        to_year = _to_number(filter_payload.get("toYear"))
        mask = pd.Series(True, index=frame.index)
        if from_year is not None:
            mask &= numeric_values >= from_year
        if to_year is not None:
            mask &= numeric_values <= to_year
        return frame[mask]

    if category == "IDENTIFIER":
        search_value = str(filter_payload.get("value", "")).strip().lower()
        if not search_value:
            return frame

        operator = str(filter_payload.get("operator", "Contains"))
        text_values = frame[column_name].fillna("").astype(str).str.lower()
        if operator == "Equals":
            mask = text_values == search_value
        elif operator == "Starts With":
            mask = text_values.str.startswith(search_value)
        elif operator == "Ends With":
            mask = text_values.str.endswith(search_value)
        else:
            mask = text_values.str.contains(search_value, regex=False)
        return frame[mask]

    return frame


def _build_filter_metadata(
    filtered_frame: pd.DataFrame,
    original_frame: pd.DataFrame,
    column_name: str,
    category: str | None = None,
) -> dict[str, Any]:
    data_type = _detect_column_type(original_frame[column_name])
    metadata: dict[str, Any] = {
        "columnName": column_name,
        "type": data_type,
    }

    if category == "TYPE_VARIANT":
        value_counts = original_frame[column_name].dropna().astype(str).value_counts().head(FILTER_VALUE_LIMIT)
        metadata["values"] = [
            {"value": str(value), "count": int(count)}
            for value, count in value_counts.items()
        ]
    elif data_type in {"Integer", "Decimal"}:
        numeric_values = _numeric_series(original_frame[column_name].dropna()).dropna()
        metadata["min"] = _serialise_number(numeric_values.min()) if not numeric_values.empty else None
        metadata["max"] = _serialise_number(numeric_values.max()) if not numeric_values.empty else None
    elif data_type == "Date":
        date_values = _date_series(original_frame[column_name].dropna()).dropna()
        metadata["from"] = _serialise_date(date_values.min()) if not date_values.empty else None
        metadata["to"] = _serialise_date(date_values.max()) if not date_values.empty else None
    else:
        value_counts = original_frame[column_name].dropna().astype(str).value_counts().head(FILTER_VALUE_LIMIT)
        metadata["values"] = [
            {"value": str(value), "count": int(count)}
            for value, count in value_counts.items()
        ]

    return metadata


def _numeric_series(series: pd.Series) -> pd.Series:
    return pd.to_numeric(
        series.astype(str).map(_normalise_numeric_text),
        errors="coerce",
    )


def _date_series(series: pd.Series) -> pd.Series:
    return pd.to_datetime(
        series.astype(str).str.strip(),
        errors="coerce",
        format="mixed",
        dayfirst=True,
    )


def _to_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(_normalise_numeric_text(str(value)))
    except ValueError:
        return None


def _to_date(value: Any) -> pd.Timestamp | None:
    if value is None or value == "":
        return None
    parsed = pd.to_datetime(str(value), errors="coerce", format="mixed", dayfirst=True)
    if pd.isna(parsed):
        return None
    return parsed


def _serialise_number(value: Any) -> int | float | None:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float):
        return round(value, 4)
    return value


def _serialise_date(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    return pd.Timestamp(value).date().isoformat()
