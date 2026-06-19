from __future__ import annotations

import csv
import logging
from dataclasses import dataclass
from io import BytesIO, StringIO
from pathlib import PurePath
from typing import Any
from uuid import uuid4

import pandas as pd
from fastapi import HTTPException, UploadFile

from app.services.dataset_storage import load_dataset, persist_dataset


logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".csv": "CSV", ".xlsx": "XLSX"}
SUPPORTED_DELIMITERS = [",", ";", "\t", "|"]
PREVIEW_ROW_LIMIT = 100
PREVIEW_COLUMN_LIMIT = 8
TYPE_DETECTION_SAMPLE_LIMIT = 1000


@dataclass
class StoredDataset:
    frame: pd.DataFrame
    dataset_type: str
    files: list[dict[str, Any]]


DATASET_REGISTRY: dict[str, StoredDataset] = {}


async def build_import_preview(
    files: list[UploadFile],
    import_method: str,
    expected_file_type: str | None,
    has_headers: bool = True,
) -> dict[str, Any]:
    selected_files = [file for file in files if file.filename]
    if not selected_files:
        raise HTTPException(status_code=400, detail="Select at least one CSV or XLSX file.")

    file_payloads = []
    extensions: set[str] = set()

    for upload in selected_files:
        filename = upload.filename or ""
        suffix = PurePath(filename).suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type for {filename}. Only CSV and XLSX files are supported.",
            )

        content = await upload.read()
        if not content:
            raise HTTPException(status_code=400, detail=f"{filename} is empty.")

        extensions.add(suffix)
        file_payloads.append(
            {
                "name": filename,
                "size": len(content),
                "extension": suffix,
                "content": content,
            }
        )

    _validate_file_types(import_method, expected_file_type, extensions)

    frames = [
        _load_dataframe(file_payload["content"], file_payload["extension"], file_payload["name"], has_headers)
        for file_payload in file_payloads
    ]
    _validate_shared_schema(frames, [file_payload["name"] for file_payload in file_payloads])

    dataset = pd.concat(frames, ignore_index=True)
    dataset_type = SUPPORTED_EXTENSIONS[next(iter(extensions))]
    imported_files = [
        {
            "name": file_payload["name"],
            "size": file_payload["size"],
            "status": "Schema Match",
        }
        for file_payload in file_payloads
    ]
    dataset_id = uuid4().hex
    schema = _detect_schema(dataset, [file_payload["name"] for file_payload in file_payloads])
    dataset_size = int(sum(file_payload["size"] for file_payload in file_payloads))
    table_name = persist_dataset(
        dataset_id=dataset_id,
        frame=dataset,
        dataset_type=dataset_type,
        files=imported_files,
        schema=schema,
        dataset_size=dataset_size,
        file_frames=frames,
        has_headers=has_headers,
    )
    DATASET_REGISTRY[dataset_id] = StoredDataset(
        frame=dataset,
        dataset_type=dataset_type,
        files=imported_files,
    )
    preview_columns = list(dataset.columns[:PREVIEW_COLUMN_LIMIT])

    logger.info(
        "Import preview generated: dataset_id=%s table_name=%s dataset_type=%s file_count=%s row_count=%s column_count=%s columns=%s",
        dataset_id,
        table_name,
        dataset_type,
        len(file_payloads),
        len(dataset.index),
        len(dataset.columns),
        list(dataset.columns),
    )

    return {
        "datasetId": dataset_id,
        "datasetType": dataset_type,
        "fileCount": len(file_payloads),
        "rowCount": int(len(dataset.index)),
        "columnCount": int(len(dataset.columns)),
        "datasetSize": dataset_size,
        "hasHeaders": has_headers,
        "files": imported_files,
        "schema": schema,
        "preview": {
            "columns": preview_columns,
            "rows": _serialise_preview(dataset.loc[:, preview_columns].head(PREVIEW_ROW_LIMIT)),
        },
    }


def _validate_file_types(import_method: str, expected_file_type: str | None, extensions: set[str]) -> None:
    if len(extensions) > 1:
        raise HTTPException(status_code=400, detail="Mixed CSV and XLSX files are not allowed.")

    if import_method == "files":
        expected_extension = f".{(expected_file_type or '').lower()}"
        if expected_extension not in SUPPORTED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Choose CSV or XLSX before selecting files.")
        if extensions != {expected_extension}:
            raise HTTPException(
                status_code=400,
                detail=f"Every selected file must be {expected_extension}. Mixed formats are not allowed.",
            )
    elif import_method != "folder":
        raise HTTPException(status_code=400, detail="Unsupported import method.")


def _load_dataframe(content: bytes, extension: str, filename: str, has_headers: bool = True) -> pd.DataFrame:
    try:
        if extension == ".csv":
            return _load_csv_dataframe(content, filename, has_headers)
        if extension == ".xlsx":
            return _load_xlsx_dataframe(content, filename, has_headers)
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"Could not read {filename}: {exc}") from exc

    raise HTTPException(status_code=400, detail=f"Unsupported file type for {filename}.")


def _load_csv_dataframe(content: bytes, filename: str, has_headers: bool = True) -> pd.DataFrame:
    text = _decode_csv(content)
    delimiter = _detect_delimiter(text, filename)
    rows = [_clean_row(row) for row in csv.reader(StringIO(text), delimiter=delimiter)]
    rows = [row for row in rows if _has_any_value(row)]

    if not rows:
        raise HTTPException(status_code=400, detail=f"{filename} does not contain a header row.")

    first_row = rows[0]
    column_count = len(first_row)
    if column_count < 1 or not _has_any_value(first_row):
        raise HTTPException(status_code=400, detail=f"{filename} does not contain a valid header row.")

    data_rows = rows[1:] if has_headers else rows
    if not data_rows:
        raise HTTPException(status_code=400, detail=f"{filename} does not contain any data rows.")

    invalid_row_numbers = [
        index + 2
        for index, row in enumerate(data_rows)
        if len(row) != column_count
    ]
    if invalid_row_numbers:
        sample_rows = ", ".join(str(row_number) for row_number in invalid_row_numbers[:5])
        raise HTTPException(
            status_code=400,
            detail=(
                f"{filename} contains rows that do not match the detected column count "
                f"({column_count}). Example row numbers: {sample_rows}."
            ),
        )

    columns = _make_column_names(first_row) if has_headers else _generated_column_names(column_count)
    frame = pd.DataFrame(data_rows, columns=columns).replace("", pd.NA)
    _log_file_detection(filename, delimiter, len(frame.index), len(frame.columns), columns)
    return frame


def _load_xlsx_dataframe(content: bytes, filename: str, has_headers: bool = True) -> pd.DataFrame:
    try:
        frame = pd.read_excel(
            BytesIO(content),
            header=0 if has_headers else None,
            dtype=str,
            keep_default_na=False,
            engine="calamine",
        )
    except Exception:
        frame = pd.read_excel(
            BytesIO(content),
            header=0 if has_headers else None,
            dtype=str,
            keep_default_na=False,
            engine="openpyxl",
        )

    if len(frame.columns) < 1:
        raise HTTPException(status_code=400, detail=f"{filename} does not contain a valid header row.")
    if frame.empty:
        raise HTTPException(status_code=400, detail=f"{filename} does not contain any data rows.")

    columns = (
        _make_column_names([_clean_cell(column) for column in frame.columns])
        if has_headers
        else _generated_column_names(len(frame.columns))
    )
    frame = frame.map(_clean_cell)
    frame.columns = columns
    frame = frame.replace("", pd.NA)

    _log_file_detection(filename, "worksheet", len(frame.index), len(frame.columns), columns)
    return frame


def _decode_csv(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue

    raise HTTPException(status_code=400, detail="Could not detect CSV encoding.")


def _detect_delimiter(text: str, filename: str) -> str:
    best_delimiter = ""
    best_score: tuple[int, int, int, int] | None = None

    for delimiter in SUPPORTED_DELIMITERS:
        try:
            rows = [_clean_row(row) for row in csv.reader(StringIO(text), delimiter=delimiter)]
        except csv.Error:
            continue

        rows = [row for row in rows if _has_any_value(row)]
        if not rows:
            continue

        widths = [len(row) for row in rows]
        dominant_width = max(set(widths), key=widths.count)
        consistent_rows = sum(1 for width in widths if width == dominant_width)
        inconsistent_rows = len(widths) - consistent_rows
        multi_column_bonus = 1 if dominant_width > 1 else 0
        score = (consistent_rows, multi_column_bonus, dominant_width, -inconsistent_rows)

        if best_score is None or score > best_score:
            best_score = score
            best_delimiter = delimiter

    if not best_delimiter:
        raise HTTPException(status_code=400, detail=f"Could not detect a valid delimiter for {filename}.")

    return best_delimiter


def _validate_shared_schema(frames: list[pd.DataFrame], filenames: list[str]) -> None:
    if not frames:
        raise HTTPException(status_code=400, detail="No readable files were provided.")

    expected_columns = list(frames[0].columns)
    for index, frame in enumerate(frames[1:], start=1):
        if list(frame.columns) != expected_columns:
            raise HTTPException(
                status_code=400,
                detail=f"{filenames[index]} does not match the schema of {filenames[0]}.",
            )


def get_stored_dataset(dataset_id: str) -> StoredDataset:
    dataset = DATASET_REGISTRY.get(dataset_id)
    if dataset is not None:
        return dataset

    stored_dataset = load_dataset(dataset_id)
    if stored_dataset is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} was not found.")

    frame, dataset_type, files = stored_dataset
    dataset = StoredDataset(frame=frame, dataset_type=dataset_type, files=files)
    DATASET_REGISTRY[dataset_id] = dataset
    return dataset


def _detect_schema(dataset: pd.DataFrame, source_files: list[str]) -> list[dict[str, Any]]:
    schema = []

    for column_name in dataset.columns:
        series = dataset[column_name]
        sample_value = _first_non_null(series)
        schema.append(
            {
                "name": str(column_name),
                "type": _detect_column_type(series),
                "sourceFiles": source_files,
                "nullable": bool(series.isna().any()),
                "exampleValue": _serialise_value(sample_value),
            }
        )

    return schema


def _detect_column_type(series: pd.Series) -> str:
    non_null = series.dropna().head(TYPE_DETECTION_SAMPLE_LIMIT)
    if non_null.empty:
        return "Text"

    text_values = non_null.astype(str).str.strip()
    if bool(text_values.map(_is_boolean_text).all()):
        return "Boolean"

    numeric_values = pd.to_numeric(text_values.map(_normalise_numeric_text), errors="coerce")
    if bool(numeric_values.notna().all()):
        return "Integer" if bool((numeric_values % 1 == 0).all()) else "Decimal"

    date_values = pd.to_datetime(text_values, errors="coerce", format="mixed", dayfirst=True)
    if bool(date_values.notna().mean() >= 0.8):
        return "Date"

    return "Text"


def _make_column_names(header: list[str]) -> list[str]:
    columns = []
    seen: dict[str, int] = {}

    for index, cell in enumerate(header, start=1):
        base_name = _clean_cell(cell) or f"Column_{index}"
        occurrence = seen.get(base_name, 0) + 1
        seen[base_name] = occurrence
        columns.append(base_name if occurrence == 1 else f"{base_name}_{occurrence}")

    return columns


def _generated_column_names(column_count: int) -> list[str]:
    return [f"Column {index}" for index in range(1, column_count + 1)]


def _clean_row(row: list[Any]) -> list[str]:
    return [_clean_cell(cell) for cell in row]


def _clean_cell(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).replace("\ufeff", "").strip()


def _has_any_value(row: list[str]) -> bool:
    return any(_clean_cell(cell) for cell in row)


def _is_boolean_text(value: str) -> bool:
    return _clean_cell(value).lower() in {"true", "false", "yes", "no", "ja", "nein"}


def _normalise_numeric_text(value: str) -> str:
    text = _clean_cell(value).replace(" ", "")
    if "," in text and "." not in text:
        return text.replace(",", ".")
    if "," in text and "." in text and text.rfind(",") > text.rfind("."):
        return text.replace(".", "").replace(",", ".")
    if "," in text and "." in text and text.rfind(".") > text.rfind(","):
        return text.replace(",", "")
    return text


def _first_non_null(series: pd.Series) -> Any:
    non_null = series.dropna()
    if non_null.empty:
        return None
    return non_null.iloc[0]


def _serialise_preview(frame: pd.DataFrame) -> list[dict[str, Any]]:
    records = frame.where(pd.notna(frame), None).to_dict(orient="records")
    return [{str(key): _serialise_value(value) for key, value in record.items()} for record in records]


def _serialise_value(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None

    if isinstance(value, pd.Timestamp):
        return value.isoformat()

    if hasattr(value, "item"):
        value = value.item()

    return value


def _log_file_detection(
    filename: str,
    delimiter: str,
    row_count: int,
    column_count: int,
    column_names: list[str],
) -> None:
    delimiter_label = {"\t": "tab"}.get(delimiter, delimiter)
    logger.info(
        "Import file parsed: filename=%s detected_delimiter=%s detected_column_count=%s "
        "detected_row_count=%s detected_column_names=%s",
        filename,
        delimiter_label,
        column_count,
        row_count,
        column_names,
    )
