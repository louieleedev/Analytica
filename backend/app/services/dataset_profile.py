from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd
from fastapi import HTTPException

from app.services.import_workflow import _detect_column_type, _normalise_numeric_text, get_stored_dataset


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

    stored_dataset = get_stored_dataset(dataset_id)
    frame = stored_dataset.frame
    row_count = int(len(frame.index))
    column_catalog = [_build_column_catalog_entry(frame, column_name) for column_name in frame.columns]

    overview = {
        "datasetId": dataset_id,
        "summary": {
            "totalRows": row_count,
            "totalColumns": int(len(frame.columns)),
            "importedFiles": len(stored_dataset.files),
            "datasetSize": int(sum(file["size"] for file in stored_dataset.files)),
        },
        "columns": column_catalog,
    }
    cache.overview = overview
    return overview


def build_column_profile(dataset_id: str, column_name: str) -> dict[str, Any]:
    cache = PROFILE_CACHE.setdefault(dataset_id, ProfileCacheEntry())
    if column_name in cache.columns:
        return cache.columns[column_name]

    stored_dataset = get_stored_dataset(dataset_id)
    frame = stored_dataset.frame
    profile = build_column_profile_for_frame(frame, column_name)
    cache.columns[column_name] = profile
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
