import logging

from pydantic import BaseModel, Field
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.duckdb import close_connection, get_duckdb_diagnostics, log_duckdb_diagnostics
from app.services.chart_service import build_chart_result
from app.services.application_settings import (
    get_application_settings,
    initialise_application_settings,
    update_application_settings,
)
from app.services.dataset_profile import build_column_profile, build_dataset_overview
from app.services.dataset_management import (
    append_files_to_dataset,
    get_dataset_management_summary,
    remove_file_from_dataset,
)
from app.services.explorer_profile import (
    build_explorer_column_profile,
    build_explorer_dataset,
    build_explorer_filter_result,
)
from app.services.dataset_storage import initialise_dataset_storage
from app.services.import_workflow import build_import_preview
from app.services.project_storage import (
    create_project_record,
    delete_project_record,
    get_project_record,
    initialise_project_storage,
    list_project_records,
    update_project_record,
)
from app.services.pivot_service import estimate_pivot, execute_pivot


class ProjectCreateRequest(BaseModel):
    name: str
    description: str
    dataset_id: str | None = Field(default=None, alias="datasetId")
    has_headers: bool = Field(default=True, alias="hasHeaders")
    schema_columns: list[str] = Field(default_factory=list, alias="schemaColumns")


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class SettingsUpdateRequest(BaseModel):
    settings: dict[str, object] = Field(default_factory=dict)


def create_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(title=settings.app_name)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/diagnostics/duckdb", tags=["system"])
    def duckdb_diagnostics() -> dict:
        return get_duckdb_diagnostics()

    @app.on_event("startup")
    def startup() -> None:
        initialise_dataset_storage()
        initialise_project_storage()
        initialise_application_settings()
        log_duckdb_diagnostics("startup")

    @app.on_event("shutdown")
    def shutdown() -> None:
        log_duckdb_diagnostics("shutdown")
        close_connection()

    @app.get("/settings", tags=["settings"])
    def get_settings() -> dict:
        return get_application_settings()

    @app.patch("/settings", tags=["settings"])
    def update_settings(payload: SettingsUpdateRequest) -> dict:
        return update_application_settings(payload.settings)

    @app.post("/projects/import-preview", tags=["projects"])
    async def import_preview(
        import_method: str = Form(...),
        expected_file_type: str | None = Form(None),
        has_headers: bool = Form(True),
        files: list[UploadFile] = File(...),
    ) -> dict:
        return await build_import_preview(files, import_method, expected_file_type, has_headers)

    @app.post("/projects", tags=["projects"])
    def create_project(payload: ProjectCreateRequest) -> dict:
        return create_project_record(
            payload.name.strip(),
            payload.description.strip(),
            payload.dataset_id,
            payload.has_headers,
            payload.schema_columns,
        )

    @app.get("/projects", tags=["projects"])
    def list_projects() -> list[dict]:
        return list_project_records()

    @app.get("/projects/{project_id}", tags=["projects"])
    def get_project(project_id: str) -> dict:
        return get_project_record(project_id)

    @app.patch("/projects/{project_id}", tags=["projects"])
    def update_project(project_id: str, payload: ProjectUpdateRequest) -> dict:
        return update_project_record(
            project_id,
            payload.name.strip() if payload.name is not None else None,
            payload.description.strip() if payload.description is not None else None,
        )

    @app.delete("/projects/{project_id}", tags=["projects"])
    def delete_project(project_id: str) -> dict[str, str]:
        delete_project_record(project_id)
        return {"status": "deleted"}

    @app.get("/datasets/{dataset_id}/overview", tags=["datasets"])
    def dataset_overview(dataset_id: str) -> dict:
        return build_dataset_overview(dataset_id)

    @app.get("/datasets/{dataset_id}/management", tags=["datasets"])
    async def dataset_management_summary(dataset_id: str) -> dict:
        return await get_dataset_management_summary(dataset_id)

    @app.post("/datasets/{dataset_id}/files", tags=["datasets"])
    async def dataset_add_files(
        dataset_id: str,
        import_method: str = Form(...),
        expected_file_type: str | None = Form(None),
        files: list[UploadFile] = File(...),
    ) -> dict:
        return await append_files_to_dataset(dataset_id, files, import_method, expected_file_type)

    @app.delete("/datasets/{dataset_id}/files/{file_id}", tags=["datasets"])
    async def dataset_delete_file(dataset_id: str, file_id: str) -> dict:
        return await remove_file_from_dataset(dataset_id, file_id)

    @app.get("/datasets/{dataset_id}/columns/profile", tags=["datasets"])
    def dataset_column_profile(dataset_id: str, column_name: str) -> dict:
        return build_column_profile(dataset_id, column_name)

    @app.get("/datasets/{dataset_id}/explorer", tags=["datasets"])
    def dataset_explorer(dataset_id: str) -> dict:
        return build_explorer_dataset(dataset_id)

    @app.get("/datasets/{dataset_id}/explorer/columns/profile", tags=["datasets"])
    def dataset_explorer_column_profile(dataset_id: str, column_name: str) -> dict:
        return build_explorer_column_profile(dataset_id, column_name)

    @app.post("/datasets/{dataset_id}/explorer/filter", tags=["datasets"])
    def dataset_explorer_filter(dataset_id: str, payload: dict) -> dict:
        return build_explorer_filter_result(dataset_id, payload)

    @app.post("/datasets/{dataset_id}/pivot", tags=["datasets"])
    def dataset_pivot(dataset_id: str, payload: dict) -> dict:
        return execute_pivot(dataset_id, payload)

    @app.post("/datasets/{dataset_id}/pivot/estimate", tags=["datasets"])
    def dataset_pivot_estimate(dataset_id: str, payload: dict) -> dict:
        return estimate_pivot(dataset_id, payload)

    @app.post("/datasets/{dataset_id}/charts", tags=["datasets"])
    def dataset_chart(dataset_id: str, payload: dict) -> dict:
        return build_chart_result(dataset_id, payload)

    return app


app = create_app()
