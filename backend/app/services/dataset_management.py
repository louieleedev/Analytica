from __future__ import annotations

import logging
from pathlib import PurePath
from typing import Any

import pandas as pd
from fastapi import HTTPException, UploadFile

from app.services.dataset_profile import invalidate_dataset_profile_cache
from app.services.dataset_storage import (
    append_dataset_files,
    delete_dataset_file,
    get_dataset_storage_info,
)
from app.services.explorer_profile import invalidate_explorer_dataset_cache
from app.services.import_workflow import (
    DATASET_REGISTRY,
    SUPPORTED_EXTENSIONS,
    _detect_column_type,
    _load_dataframe,
    _validate_file_types,
)


logger = logging.getLogger(__name__)


async def get_dataset_management_summary(dataset_id: str) -> dict[str, Any]:
    storage_info = _get_storage_info_or_404(dataset_id)
    files = _serialise_files(storage_info["files"])
    if len(files) == 1 and files[0]["rowCount"] == 0:
        files[0]["rowCount"] = int(storage_info["rowCount"])
    last_file = files[0] if files else None

    return {
        "datasetId": dataset_id,
        "datasetType": storage_info["datasetType"],
        "hasHeaders": bool(storage_info.get("hasHeaders", True)),
        "summary": {
            "totalFiles": len(files),
            "totalRows": int(storage_info["rowCount"]),
            "totalColumns": int(storage_info["columnCount"]),
            "datasetSize": int(storage_info["datasetSize"]),
            "lastImportTimestamp": last_file["importedAt"] if last_file else None,
            "lastImportedFile": last_file["name"] if last_file else None,
        },
        "files": files,
        "history": [
            {
                "timestamp": file["importedAt"],
                "fileName": file["name"],
                "rowsAdded": file["rowCount"],
                "status": file["status"],
            }
            for file in files
        ],
        "columns": storage_info["columns"],
    }


async def append_files_to_dataset(
    dataset_id: str,
    files: list[UploadFile],
    import_method: str,
    expected_file_type: str | None,
) -> dict[str, Any]:
    storage_info = _get_storage_info_or_404(dataset_id)
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
    dataset_type = SUPPORTED_EXTENSIONS[next(iter(extensions))]
    if dataset_type != storage_info["datasetType"]:
        raise HTTPException(
            status_code=400,
            detail=f"Dataset type mismatch. Existing dataset is {storage_info['datasetType']}, selected files are {dataset_type}.",
        )

    has_headers = bool(storage_info.get("hasHeaders", True))
    frames = [
        _load_dataframe(file_payload["content"], file_payload["extension"], file_payload["name"], has_headers)
        for file_payload in file_payloads
    ]
    _validate_against_existing_schema(
        storage_info,
        frames,
        [file_payload["name"] for file_payload in file_payloads],
        has_headers,
    )

    imported_files = [
        {
            "name": file_payload["name"],
            "size": file_payload["size"],
            "status": "Schema Match",
        }
        for file_payload in file_payloads
    ]
    append_dataset_files(
        dataset_id=dataset_id,
        frames=frames,
        files=imported_files,
        dataset_size_delta=sum(int(file_payload["size"]) for file_payload in file_payloads),
    )
    _invalidate_dataset(dataset_id)

    logger.info(
        "Dataset extended: dataset_id=%s file_count=%s rows_added=%s",
        dataset_id,
        len(imported_files),
        sum(len(frame.index) for frame in frames),
    )
    return await get_dataset_management_summary(dataset_id)


async def remove_file_from_dataset(dataset_id: str, file_id: str) -> dict[str, Any]:
    _get_storage_info_or_404(dataset_id)

    try:
        delete_dataset_file(dataset_id, file_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _invalidate_dataset(dataset_id)
    logger.info("Dataset file removed: dataset_id=%s file_id=%s", dataset_id, file_id)
    return await get_dataset_management_summary(dataset_id)


def _validate_against_existing_schema(
    storage_info: dict[str, Any],
    frames: list[pd.DataFrame],
    filenames: list[str],
    has_headers: bool,
) -> None:
    existing_columns = [str(column["name"]) for column in storage_info["columns"]]
    existing_types = {str(column["name"]): str(column["type"]) for column in storage_info["columns"]}

    for index, frame in enumerate(frames):
        filename = filenames[index]
        incoming_columns = [str(column) for column in frame.columns]
        if has_headers and incoming_columns != existing_columns:
            raise HTTPException(
                status_code=400,
                detail=_schema_column_mismatch_message(filename, existing_columns, incoming_columns),
            )
        if not has_headers and len(incoming_columns) != len(existing_columns):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{filename} schema mismatch. Expected {len(existing_columns)} columns, "
                    f"got {len(incoming_columns)} columns."
                ),
            )

        mismatched_types = []
        for position, column_name in enumerate(incoming_columns):
            canonical_column_name = column_name if has_headers else existing_columns[position]
            incoming_type = _detect_column_type(frame[column_name])
            existing_type = existing_types[canonical_column_name]
            if not _types_are_compatible(existing_type, incoming_type):
                mismatched_types.append(f"{canonical_column_name}: expected {existing_type}, got {incoming_type}")

        if mismatched_types:
            raise HTTPException(
                status_code=400,
                detail=f"{filename} has incompatible column types. {'; '.join(mismatched_types)}.",
            )

        if not has_headers:
            frame.columns = existing_columns


def _types_are_compatible(existing_type: str, incoming_type: str) -> bool:
    if existing_type == incoming_type:
        return True
    return {existing_type, incoming_type} <= {"Integer", "Decimal"}


def _schema_column_mismatch_message(
    filename: str,
    expected_columns: list[str],
    incoming_columns: list[str],
) -> str:
    missing = [column for column in expected_columns if column not in incoming_columns]
    unexpected = [column for column in incoming_columns if column not in expected_columns]
    if len(expected_columns) != len(incoming_columns):
        return (
            f"{filename} schema mismatch. Expected {len(expected_columns)} columns, "
            f"got {len(incoming_columns)} columns."
        )
    if missing or unexpected:
        return (
            f"{filename} schema mismatch. Missing columns: {', '.join(missing) or '-'}; "
            f"Unexpected columns: {', '.join(unexpected) or '-'}."
        )
    return f"{filename} schema mismatch. Column order differs from the existing dataset."


def _serialise_files(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(file.get("id") or file["name"]),
            "name": str(file["name"]),
            "size": int(file.get("size") or 0),
            "rowCount": int(file.get("rowCount") or 0),
            "importedAt": file.get("importedAt"),
            "status": str(file.get("status") or "Schema Match"),
        }
        for file in files
    ]


def _get_storage_info_or_404(dataset_id: str) -> dict[str, Any]:
    storage_info = get_dataset_storage_info(dataset_id)
    if storage_info is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} was not found.")
    return storage_info


def _invalidate_dataset(dataset_id: str) -> None:
    DATASET_REGISTRY.pop(dataset_id, None)
    invalidate_dataset_profile_cache(dataset_id)
    invalidate_explorer_dataset_cache(dataset_id)
